import { createMaterialAsset, MeshAsset, shaderMaterialDefinition, TextureAsset } from "@ignifx/core";
import { LOOKUP_SAMPLES } from "../definition/types.js";
import { ParticlesErrorCode } from "../errors.js";
import { generateParticleWgsl, particleShaderAddress } from "../gpu/wgsl.js";
import type { ParticleAsset } from "../assets/particle-asset.js";
import type { ParticleMeshName } from "../definition/types.js";
import type { ParticleSystem } from "../gpu/particle-system.js";
import type { ParticlesSettings } from "../settings.js";
import type {
  App,
  AssetHandle,
  DiagnosticsGroup,
  MaterialAsset,
  ShaderAsset,
  ShaderMaterialDefinition,
  Vec3Like,
} from "@ignifx/core";

// `app.particles` (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3): the budget, the quality
// multiplier, the gravity, the counters, and the resources every system playing one definition
// shares. The storage buffer and the material are per system; everything else is per definition.

/**
 * The diagnostics group name.
 *
 * @public
 */
export const PARTICLES_DIAGNOSTICS_GROUP = "particles";

/**
 * The counters the group carries, in index order.
 *
 * @public
 */
export const PARTICLES_DIAGNOSTICS_COUNTERS: readonly string[] = Object.freeze([
  "systems",
  "alive",
  "emitted",
  "uploadBytes",
  "drawCalls",
]);

/** Floats in one instance matrix. */
const MATRIX_FLOATS = 16;

/**
 * The GPU-facing resources one definition's systems share.
 *
 * @public
 */
export interface ParticleDefinitionResources {
  /** The generated program. */
  readonly source: string;
  /** The program's asset, loading until the shader adapter is in place. */
  readonly shader: AssetHandle<ShaderAsset>;
  /** The baked lookup texture. */
  readonly lut: AssetHandle<TextureAsset>;
  /** The renderer's texture, or `null` for the procedural disc. */
  readonly sheet: AssetHandle<TextureAsset> | null;
  /** The quad, or the primitive a `"mesh"` renderer draws. */
  readonly mesh: AssetHandle<MeshAsset>;
  /** The material every system builds its own copy from. */
  readonly materialDefinition: ShaderMaterialDefinition;
  /** The texture handles in the order `materialDefinition.textures` names them. */
  readonly textures: readonly AssetHandle<TextureAsset>[];
}

/** A shared resource set plus the count of systems holding it. */
interface ResourceEntry {
  readonly resources: ParticleDefinitionResources;
  holders: number;
  hasReportedFailure: boolean;
}

/**
 * The particles service, reached as `app.particles`.
 *
 * @example
 * ```ts
 * app.particles.qualityScale = 0.5; // half the emission everywhere, for a low setting
 * app.particles.systems.length; // how many ParticleSystem components are attached
 * ```
 *
 * @public
 */
export class ParticlesService {
  /**
   * The budget every attached system's capacity is counted against. Raising it takes effect for
   * systems attached afterwards.
   */
  maxParticles: number;

  /** A `0`–`1` multiplier on every rate and burst count, read each frame. */
  qualityScale: number;

  readonly #app: App;

  readonly #gravity: { x: number; y: number; z: number };

  readonly #systems: ParticleSystem[] = [];

  readonly #resources = new Map<string, ResourceEntry>();

  readonly #meshes = new Map<string, AssetHandle<MeshAsset>>();

  #counters: DiagnosticsGroup | null = null;

  #identitySlab: Float32Array | null = null;

  #capacityInUse = 0;

  #isDisposed = false;

  /**
   * Creates the service.
   *
   * @param app - The app it belongs to.
   * @param settings - The resolved `particles` section, options already merged.
   */
  constructor(app: App, settings: ParticlesSettings) {
    this.#app = app;
    this.maxParticles = settings.maxParticles;
    this.qualityScale = settings.qualityScale;
    this.#gravity = { x: settings.gravity.x, y: settings.gravity.y, z: settings.gravity.z };
  }

  /**
   * The world gravity a definition's `gravityMultiplier` scales, in metres per second squared.
   *
   * @returns The service's own vector; assign to replace it.
   */
  get gravity(): Vec3Like {
    return this.#gravity;
  }

  /**
   * Copies a new world gravity in, so the caller's object is not retained.
   *
   * @param value - The gravity to copy.
   */
  set gravity(value: Vec3Like) {
    this.#gravity.x = value.x;
    this.#gravity.y = value.y;
    this.#gravity.z = value.z;
  }

  /**
   * Every attached `ParticleSystem`, in attach order.
   *
   * @returns The live list; iterate it without copying.
   */
  get systems(): readonly ParticleSystem[] {
    return this.#systems;
  }

  /**
   * How much of the budget attached systems hold.
   *
   * @returns The sum of every attached system's capacity.
   */
  get capacityInUse(): number {
    return this.#capacityInUse;
  }

  /**
   * The `particles` diagnostics group, once the extension registered it.
   *
   * @returns The group, or `null` before registration.
   */
  get counters(): DiagnosticsGroup | null {
    return this.#counters;
  }

  /**
   * Installs the counters group the extension registered.
   *
   * @param group - The group.
   *
   * @internal
   */
  setCounters(group: DiagnosticsGroup): void {
    this.#counters = group;
  }

  /**
   * Adds a system to the live list.
   *
   * @param system - The system.
   *
   * @internal
   */
  attach(system: ParticleSystem): void {
    if (!this.#systems.includes(system)) {
      this.#systems.push(system);
    }
  }

  /**
   * Removes a system from the live list.
   *
   * @param system - The system.
   *
   * @internal
   */
  detach(system: ParticleSystem): void {
    const index = this.#systems.indexOf(system);
    if (index >= 0) {
      this.#systems.splice(index, 1);
    }
  }

  /**
   * Takes capacity out of the budget, clamping to what is left and logging `IGX-1702` when it had
   * to. Every renderer that spends the particle budget goes through here, `@ignifx/particles-2d`
   * included; pair each call with {@link ParticlesService.release}.
   *
   * @param entity - The entity's name, for the warning.
   * @param requested - The definition's capacity, in records.
   * @returns The capacity granted, at least one record.
   *
   * @beta
   */
  reserve(entity: string, requested: number): number {
    const available = Math.max(0, this.maxParticles - this.#capacityInUse);
    let granted = requested;
    if (requested > available) {
      granted = Math.max(1, available);
      this.#app.log.warn(
        `${ParticlesErrorCode.budgetExceeded}: {entity} asked for {capacity} particles, but only {available} of the {budget} particle budget remain; the system was clamped.`,
        entity,
        requested,
        available,
        this.maxParticles,
      );
    }
    this.#capacityInUse += granted;
    return granted;
  }

  /**
   * Gives capacity back to the budget.
   *
   * @param granted - What {@link ParticlesService.reserve} returned.
   *
   * @beta
   */
  release(granted: number): void {
    this.#capacityInUse = Math.max(0, this.#capacityInUse - granted);
  }

  /**
   * The shared resources of a definition, built on first use.
   *
   * @param asset - The particle asset.
   * @returns The resources; pair every call with {@link ParticlesService.releaseResources}.
   *
   * @internal
   */
  acquireResources(asset: ParticleAsset): ParticleDefinitionResources {
    const existing = this.#resources.get(asset.address);
    if (existing !== undefined) {
      existing.holders += 1;
      return existing.resources;
    }
    const resources = this.#buildResources(asset);
    this.#resources.set(asset.address, { resources, holders: 1, hasReportedFailure: false });
    return resources;
  }

  /**
   * Lets go of a definition's resources, disposing them with the last holder.
   *
   * @param asset - The particle asset.
   *
   * @internal
   */
  releaseResources(asset: ParticleAsset): void {
    const entry = this.#resources.get(asset.address);
    if (entry === undefined) {
      return;
    }
    entry.holders -= 1;
    if (entry.holders <= 0) {
      this.#resources.delete(asset.address);
      disposeResources(entry.resources);
    }
  }

  /**
   * Reports, once per definition, that its shader failed to load.
   *
   * @param asset - The particle asset.
   * @param message - The failure.
   *
   * @internal
   */
  reportShaderFailure(asset: ParticleAsset, message: string): void {
    const entry = this.#resources.get(asset.address);
    if (entry === undefined || entry.hasReportedFailure) {
      return;
    }
    entry.hasReportedFailure = true;
    this.#app.log.error(
      `${ParticlesErrorCode.shaderFailed}: The particle shader for {definition} could not be built: {message}.`,
      asset.address,
      message,
    );
  }

  /**
   * An identity matrix slab at least `capacity` instances long, shared by every renderer: the
   * particle shader never reads the instance matrices, so one read-only slab serves all.
   *
   * @param capacity - How many instances the caller needs.
   * @returns The slab.
   *
   * @internal
   */
  identitySlab(capacity: number): Float32Array {
    const needed = capacity * MATRIX_FLOATS;
    let slab = this.#identitySlab;
    if (slab === null || slab.length < needed) {
      slab = new Float32Array(needed);
      for (let index = 0; index < capacity; index += 1) {
        const base = index * MATRIX_FLOATS;
        slab[base] = 1;
        slab[base + 5] = 1;
        slab[base + 10] = 1;
        slab[base + 15] = 1;
      }
      this.#identitySlab = slab;
    }
    return slab;
  }

  /**
   * Builds a system's own material from a definition's shared resources.
   *
   * @param resources - The shared resources.
   * @returns The material handle, with one holder — the caller.
   *
   * @internal
   */
  createMaterial(resources: ParticleDefinitionResources): AssetHandle<MaterialAsset> {
    return createMaterialAsset(this.#app, resources.materialDefinition, resources.textures);
  }

  /** Releases every shared resource. The extension calls it on dispose. */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    for (const entry of this.#resources.values()) {
      disposeResources(entry.resources);
    }
    this.#resources.clear();
    for (const mesh of this.#meshes.values()) {
      mesh.release();
    }
    this.#meshes.clear();
    this.#systems.length = 0;
  }

  /**
   * Generates and loads everything a definition's systems share.
   *
   * @param asset - The particle asset.
   * @returns The resources.
   */
  #buildResources(asset: ParticleAsset): ParticleDefinitionResources {
    const app = this.#app;
    const definition = asset.definition;
    const source = generateParticleWgsl(definition);
    const address = particleShaderAddress(source);
    const shader = app.assets.load<ShaderAsset>(address, { type: "shader" });
    const lut = TextureAsset.fromPixels(
      app,
      `particles:lut:${asset.address}`,
      definition.lookup.pixels,
      LOOKUP_SAMPLES,
      definition.lookup.rows,
      {
        filter: "linear",
        wrap: "clamp",
      },
    );
    const sheet = asset.texture === null ? null : asset.texture.retain();
    const mesh = this.#mesh(definition.renderer.mode === "mesh" ? definition.renderer.mesh : null);
    const textureAddresses: Record<string, string> = {};
    const textures: AssetHandle<TextureAsset>[] = [];
    if (sheet !== null) {
      textureAddresses["sheet"] = sheet.address;
      textures.push(sheet);
    }
    textureAddresses["lut"] = lut.address;
    textures.push(lut);
    const materialDefinition = shaderMaterialDefinition({
      shader: address,
      name: `particles:${asset.address}`,
      textures: textureAddresses,
    });
    return { source, shader, lut, sheet, mesh, materialDefinition, textures };
  }

  /**
   * The quad every billboard mode draws, or a unit primitive, built once per app.
   *
   * @param name - The primitive, or `null` for the quad.
   * @returns The mesh handle, retained for the caller.
   */
  #mesh(name: ParticleMeshName | null): AssetHandle<MeshAsset> {
    const key = name ?? "quad";
    const cached = this.#meshes.get(key);
    if (cached !== undefined) {
      return cached.retain();
    }
    const app = this.#app;
    let handle: AssetHandle<MeshAsset>;
    switch (name) {
      case null:
        handle = MeshAsset.fromData(app, "particles:quad", quadGeometry());
        break;
      case "box":
        handle = MeshAsset.box(app, { size: 1 });
        break;
      case "sphere":
        handle = MeshAsset.sphere(app, { diameter: 1, segments: 12 });
        break;
      case "plane":
        handle = MeshAsset.plane(app, { size: 1 });
        break;
      case "cylinder":
        handle = MeshAsset.cylinder(app, { height: 1, diameter: 1, tessellation: 12 });
        break;
      case "capsule":
        handle = MeshAsset.capsule(app, { height: 1, radius: 0.25, tessellation: 8 });
        break;
      case "torus":
        handle = MeshAsset.torus(app, { diameter: 1, thickness: 0.3, tessellation: 12 });
        break;
    }
    this.#meshes.set(key, handle);
    return handle.retain();
  }
}

/**
 * Releases a resource set's handles.
 *
 * @param resources - The set.
 */
function disposeResources(resources: ParticleDefinitionResources): void {
  resources.shader.release();
  resources.lut.release();
  resources.sheet?.release();
  resources.mesh.release();
}

/**
 * The unit quad billboards are drawn from: corners at `±0.5` in XY, `uv` `(0, 0)` at the bottom
 * left, facing `-Z`.
 *
 * @returns The geometry.
 */
function quadGeometry(): {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly uvs: Float32Array;
} {
  return {
    positions: Float32Array.from([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
  };
}
