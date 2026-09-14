import { Component } from "../component/component.js";
import { entityInternals } from "../entity/internals.js";
import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { array, asset, bool, f32, i32, optional, record, u32 } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { instancedMeshSupport, loadInstancedMeshSupport } from "./instanced-mesh-support.js";
import { MaterialAsset } from "./material-asset.js";
import { MeshAsset } from "./mesh-asset.js";
import { rendererInternals } from "./renderer.js";
import type { InstancedMeshInstance, InstancedUploadState } from "./gpu/instanced-mesh-instance.js";
import type { RendererImpl } from "./renderer.js";
import type { AssetHandle } from "../assets/types.js";
import type { ComponentHooks } from "../component/component.js";
import type { LiteMesh } from "../lite/gpu/mesh.js";
import type { LiteMaterial } from "../lite/material.js";
import type { Schema } from "../schema/types.js";

/**
 * One mesh, one draw call, thousands of world matrices
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.5).
 *
 * The matrix slab stays the caller's: Babylon Lite keeps the reference and never copies
 * (`lib/mesh/thin-instance.js`), so it has to stay alive and at least `count * 16` floats long, and
 * a scatterer or particle system moves instances by writing into it.
 *
 * `capacity`, `gpuCulling` and the LOD partner's identity are fixed once the scene is registered,
 * because Lite bakes all three into the renderable `registerScene` compiles. A later change is
 * refused with `IGX-0717` and the applied value is written back onto the field, at warning level
 * rather than as a throw: `sync()` runs inside the one `PreRender` system, and a throw there would
 * abort every other renderable's reconciliation. The LOD pairing's `distance` and `band` are not in
 * that set and are reconciled every frame.
 *
 * `pickable` defaults to `false`, the opposite of `MeshRenderer`: Lite's picker reports
 * `thinInstanceIndex` (`index.d.ts` 8720) but `RenderPick` does not carry it, so a hit would name
 * the entity without saying which instance. Headless, the component keeps its slab, count, colours
 * and flags and touches no scene (`docs/architecture/07-rendering.md` §6).
 */

/** How many floats one instance matrix occupies. */
const FLOATS_PER_MATRIX = 16;

/** How many floats one instance colour occupies. */
const FLOATS_PER_COLOR = 4;

/**
 * The matrix slab a renderer that has been given none hands to Lite.
 *
 * @remarks
 * A zero-length array is enough, and no identity slab of `capacity` matrices is needed: Lite sizes
 * the GPU buffer from the capacity it is told, and clamps every upload range to the **active**
 * count, which is zero until a caller sets one (`lib/mesh/thin-instance-gpu.js`,
 * `syncThinInstanceGpuData`). Allocating `capacity * 64` bytes of identity matrices nothing reads
 * would be a megabyte of waste on a 20,000-instance renderer.
 *
 * Built on first use rather than at module scope, because a typed array allocates and
 * `CONSTITUTION.md` §3.5 keeps allocation out of import time.
 */
let emptySlab: Float32Array | null = null;

/**
 * The shared empty matrix slab.
 *
 * @returns An array of length zero; every caller sees the same instance.
 */
function noMatrices(): Float32Array {
  emptySlab ??= new Float32Array(0);
  return emptySlab;
}

/**
 * The `lod` field of an {@link InstancedMeshRenderer}: a coarser mesh for far instances.
 *
 * @remarks
 * Mutable, because a schema `record()` field is a plain object a script edits in place — and
 * `distance` and `band` are meant to be edited, which Lite re-applies live. Replacing `mesh` after
 * the scene is registered is refused with `IGX-0717`.
 *
 * @public
 */
export interface InstancedMeshLod {
  /** The coarse mesh drawn beyond `distance`. */
  mesh: AssetHandle<MeshAsset> | null;
  /** The camera distance, in world units, at which an instance switches to the coarse mesh. */
  distance: number;
  /** The width of the per-instance dither window centred on `distance`. */
  band: number;
}

/**
 * The Babylon Lite meshes an {@link InstancedMeshRenderer} draws. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface InstancedMeshRendererLiteHandles {
  /** The instanced mesh, or `null` when there is nothing to draw. */
  readonly mesh: LiteMesh | null;
  /** The LOD partner, or `null` when the renderer declares none. */
  readonly lodMesh: LiteMesh | null;
}

/**
 * The instance range {@link InstancedMeshRenderer.markDirty} is told about.
 *
 * @public
 */
export interface InstanceRange {
  /** The first instance index that moved. */
  readonly start: number;
  /** How many instances moved. */
  readonly count: number;
}

/**
 * Draws one mesh many times from a caller-owned matrix slab, in a single draw call (the plan's
 * §3.5).
 *
 * @example
 * ```ts
 * using box = MeshAsset.box(app, { size: 0.5 });
 * const field = world.createEntity("Asteroids");
 * const renderer = field.addComponent(InstancedMeshRenderer, { mesh: box.retain(), capacity: 20_000 });
 *
 * const slab = new Float32Array(20_000 * 16);
 * // ... write 16 column-major floats per instance ...
 * renderer.setMatrices(slab, 20_000);
 * ```
 *
 * @public
 */
export class InstancedMeshRenderer extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/InstancedMeshRenderer";

  /** Several instanced renderers on one entity draw several clouds from one transform. */
  static allowMultiple = true;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = instancedMeshRendererSchema();

  declare mesh: AssetHandle<MeshAsset> | null;

  declare materials: (AssetHandle<MaterialAsset> | null)[];

  declare capacity: number;

  declare gpuCulling: boolean;

  declare castShadows: boolean;

  declare receiveShadows: boolean;

  declare renderOrder: number;

  declare pickable: boolean;

  declare lod: InstancedMeshLod | null;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(InstancedMeshRenderer.schema));
  }

  #instance: InstancedMeshInstance | null = null;

  #matrices: Float32Array | null = null;

  #colors: Float32Array | null = null;

  #count = 0;

  /** Everything the adapter needs between uploads; it mutates this in place (`./gpu/`). */
  readonly #upload: InstancedUploadState = {
    isSlabDirty: false,
    isRangeDirty: false,
    appliedCount: -1,
    appliedCapacity: 0,
    hasAppliedBounds: false,
    hadColors: false,
  };

  #appliedMesh: MeshAsset | null = null;

  #appliedLodMesh: MeshAsset | null = null;

  #appliedLodHandle: AssetHandle<MeshAsset> | null = null;

  #appliedLod: InstancedMeshLod | null = null;

  #appliedGpuCulling = true;

  #appliedCastShadows = false;

  #hasAppliedSettings = false;

  #hasWarnedAboutLateSetting = false;

  /**
   * The Babylon Lite meshes this renderer draws. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The instanced mesh and its LOD partner, either of which may be `null`.
   */
  get lite(): InstancedMeshRendererLiteHandles {
    const instance = this.#instance;
    return { mesh: instance?.mesh ?? null, lodMesh: instance?.lodMesh ?? null };
  }

  /**
   * How many instances are drawn.
   *
   * @returns The active count; `0` until {@link InstancedMeshRenderer.setMatrices} has run.
   */
  get count(): number {
    return this.#count;
  }

  /**
   * Whether the instanced mesh is currently drawn: its own `enabled` flag and its entity's
   * `activeInHierarchy`, materialised onto Lite's `visible`.
   *
   * @returns `true` when the meshes are visible.
   */
  get isVisible(): boolean {
    return this.#instance?.isVisible === true;
  }

  /**
   * Points the renderer at a matrix slab.
   *
   * @remarks
   * The array is **not copied**: Lite reads the caller's memory for the life of the renderer, so it
   * has to stay alive, and mutating it afterwards is the intended way to move instances — followed
   * by {@link InstancedMeshRenderer.markDirty}. Sixteen floats per instance, column-major, the
   * layout Lite's `Mat4` and `Transform.worldMatrix` already use.
   *
   * The upload happens in the next `PreRender`, not here.
   *
   * @param matrices - The slab; at least `count * 16` floats.
   * @param count - How many instances to draw, at most `capacity`.
   * @throws IgnifxError with code `IGX-0721` when `count` is not an integer in `[0, capacity]`, or
   * when the slab (or the colour slab set earlier) is too short to hold that many instances.
   */
  setMatrices(matrices: Float32Array, count: number): void {
    this.#assertCount(count, matrices, this.#colors);
    this.#matrices = matrices;
    this.#count = count;
    this.#upload.isSlabDirty = true;
  }

  /**
   * Installs, replaces, or removes the per-instance colours.
   *
   * @remarks
   * Four floats per instance, **linear** RGBA in `0..1` — the same space a material's `baseColor`
   * is uploaded in, not sRGB. The material has to be one that reads `instanceColor`; a stock PBR
   * material ignores them.
   *
   * Adding or removing colours changes the compiled pipeline, so it costs the frame's one
   * `rebuildSceneRenderables`. Editing them in place does not: mutate the slab and call
   * {@link InstancedMeshRenderer.markDirty}.
   *
   * @param colors - The slab; at least `count * 4` floats, or `null` to stop reading colours.
   * @throws IgnifxError with code `IGX-0721` when the slab is too short for the current count.
   */
  setColors(colors: Float32Array | null): void {
    this.#assertCount(this.#count, this.#matrices ?? noMatrices(), colors);
    this.#colors = colors;
    this.#upload.isSlabDirty = true;
  }

  /**
   * Changes how many instances are drawn, without re-uploading the slab.
   *
   * @param count - The new count, at most `capacity` and at most what the slab holds.
   * @throws IgnifxError with code `IGX-0721` when `count` is not an integer in `[0, capacity]`, or
   * when the matrix or colour slab is too short to hold that many instances.
   */
  setCount(count: number): void {
    const matrices = this.#matrices ?? noMatrices();
    this.#assertCount(count, matrices, this.#colors);
    this.#count = count;
  }

  /**
   * Says that the caller mutated the slab in place, so the next `PreRender` re-uploads it.
   *
   * @param range - Which instances moved. **Advisory in this version**: Lite 1.27.0 exposes no
   * sub-range flush, so the whole active range `[0, count)` is re-uploaded either way. Pass it
   * anyway; the day Lite grows one, callers that already declared their range get it for free.
   */
  markDirty(range?: InstanceRange): void {
    void range;
    this.#upload.isRangeDirty = true;
  }

  /**
   * Declares the thin-instance adapter chunk, so `app.start()` waits for it before the first
   * reconciliation. The meshes themselves are built on the first sync, once `mesh` has decoded.
   */
  onAttach(): void {
    this.#appliedMesh = null;
    if (!this.app.isHeadless && instancedMeshSupport() === null) {
      rendererInternals(this.app.renderer).requireGpuAdapter(loadInstancedMeshSupport());
    }
  }

  /** Removes both meshes from the scene, releasing their share of the templates' buffers. */
  onDetach(): void {
    this.#release(rendererInternals(this.app.renderer));
  }

  /**
   * Reconciles the component with Lite once per frame. The `PreRender` system calls it.
   *
   * @param renderer - The rendering service, for the scene and the default material.
   * @returns `true` when the scene's renderable set changed, which the system coalesces into one
   * `rebuildSceneRenderables`.
   *
   * @internal
   */
  sync(renderer: RendererImpl): boolean {
    this.#refuseLateSettings(renderer);
    const changed = this.#ensureInstance(renderer);
    // From the second reconciliation onwards the baked settings are the ones in use, whether or not
    // there was a Lite mesh to apply them to — which is what makes the refusal above testable
    // headlessly, where there never is one.
    this.#hasAppliedSettings = true;
    const instance = this.#instance;
    if (instance === null) {
      // Headless, or the mesh has not decoded yet: keep the flags so that the first real sync
      // uploads whatever the caller set in the meantime.
      return changed;
    }
    const uploaded = instance.sync(
      this.#upload,
      this.#material(renderer),
      this.receiveShadows,
      this.renderOrder,
      this.pickable,
      this.lod,
      this.#matrices ?? noMatrices(),
      this.#count,
      this.#colors,
      this.castShadows,
      this.isEnabledInHierarchy,
    );
    return changed || uploaded;
  }

  /**
   * Whether the material this renderer draws with is a `"shader"` material; see
   * `MeshRenderer.usesShaderMaterial` for why the render sync system asks.
   *
   * @returns `true` when the first declared material is loaded and is a shader material.
   *
   * @internal
   */
  get usesShaderMaterial(): boolean {
    const declared = this.materials[0];
    return declared?.state === "loaded" && declared.value.kind === "shader";
  }

  /**
   * Appends the instanced mesh and its LOD partner to a shadow caster list, when they cast.
   *
   * @param out - The caster list being built.
   *
   * @internal
   */
  collectCasters(out: LiteMesh[]): void {
    this.#instance?.collectCasters(this.castShadows, out);
  }

  /**
   * Whether this renderer's caster contribution changed since the last frame.
   *
   * @returns `true` when `castShadows` or visibility moved.
   *
   * @internal
   */
  consumeCasterChange(): boolean {
    const casting = this.castShadows && this.isVisible;
    if (casting === this.#appliedCastShadows) {
      return false;
    }
    this.#appliedCastShadows = casting;
    return true;
  }

  /**
   * Refuses a change to a setting Lite fixed before the scene was registered: writes the applied
   * value back onto the field and logs `IGX-0717` once.
   *
   * @param renderer - The rendering service, for `isSceneRegistered` and the log.
   */
  #refuseLateSettings(renderer: RendererImpl): void {
    if (!this.#hasAppliedSettings || !renderer.isSceneRegistered) {
      return;
    }
    const capacity = normalisedCapacity(this.capacity);
    if (capacity !== this.#upload.appliedCapacity) {
      this.capacity = this.#upload.appliedCapacity;
      this.#warnAboutLateSetting("capacity");
    }
    if (this.gpuCulling !== this.#appliedGpuCulling) {
      this.gpuCulling = this.#appliedGpuCulling;
      this.#warnAboutLateSetting("gpuCulling");
    }
    const lod = this.lod;
    if ((lod?.mesh ?? null) !== this.#appliedLodHandle) {
      // A script edits the record in place, so restoring the field would be a self-assignment.
      if (lod !== null && lod === this.#appliedLod) {
        lod.mesh = this.#appliedLodHandle;
      } else {
        this.lod = this.#appliedLod;
      }
      this.#warnAboutLateSetting("lod.mesh");
    }
  }

  /**
   * Says once, at warning level, that a baked setting was changed too late.
   *
   * @param field - Which field was refused.
   */
  #warnAboutLateSetting(field: string): void {
    if (this.#hasWarnedAboutLateSetting) {
      return;
    }
    this.#hasWarnedAboutLateSetting = true;
    this.app.log.warn(
      `${CoreErrorCode.instancingSettingTooLate}: {entity} changed {field} on an InstancedMeshRenderer after ` +
        `the scene was registered; ` +
        "the value in use was kept. Set capacity, gpuCulling and lod.mesh before app.start().",
      this.entity.name,
      field,
    );
  }

  /**
   * Builds or rebuilds the meshes when the template or a baked setting changed.
   *
   * @param renderer - The rendering service, for the scene.
   * @returns `true` when a mesh was added to or removed from the scene.
   */
  #ensureInstance(renderer: RendererImpl): boolean {
    const loaded = loadedMesh(this.mesh);
    const lodField = this.lod;
    const lodLoaded = loadedMesh(lodField?.mesh ?? null);
    const capacity = normalisedCapacity(this.capacity);
    const unchanged =
      loaded === this.#appliedMesh &&
      lodLoaded === this.#appliedLodMesh &&
      capacity === this.#upload.appliedCapacity &&
      this.gpuCulling === this.#appliedGpuCulling;
    if (unchanged) {
      this.#appliedLod = lodField;
      this.#appliedLodHandle = lodField?.mesh ?? null;
      return false;
    }
    const removed = this.#release(renderer);
    this.#appliedMesh = loaded;
    this.#appliedLodMesh = lodLoaded;
    this.#appliedLod = lodField;
    this.#appliedLodHandle = lodField?.mesh ?? null;
    this.#upload.appliedCapacity = capacity;
    this.#appliedGpuCulling = this.gpuCulling;
    const template = loaded?.lite.mesh ?? null;
    if (template === null) {
      return removed;
    }
    const support = instancedMeshSupport();
    if (support === null) {
      // The adapter chunk is still in flight. Forget what was applied so the next sync rebuilds.
      this.#appliedMesh = null;
      return removed;
    }
    this.#instance = support.createInstancedMesh(
      renderer.scene,
      template,
      lodLoaded?.lite.mesh ?? null,
      lodField,
      entityInternals(this.entity).node,
      { entity: this.entity.handle, component: this.handle },
      this.entity.uid,
      this.#material(renderer),
      capacity,
      this.gpuCulling,
      this.#matrices ?? noMatrices(),
      this.#count,
      this.#colors,
    );
    this.#upload.appliedCount = this.#count;
    this.#upload.hadColors = this.#colors !== null;
    this.#upload.hasAppliedBounds = false;
    this.#upload.isSlabDirty = false;
    this.#upload.isRangeDirty = false;
    return true;
  }

  /**
   * The material this renderer draws with: the first it declares, or the app's default.
   *
   * @remarks
   * `materials` beyond the first is accepted and ignored, exactly as on a `MeshRenderer`: Lite's
   * `Mesh.material` is a single value in 1.27.0. The LOD partner draws with the same material —
   * `lod` names a mesh, not a material.
   *
   * @param renderer - The rendering service, for the default material.
   * @returns The Lite material.
   */
  #material(renderer: RendererImpl): LiteMaterial {
    const declared = this.materials[0];
    return declared?.state === "loaded" ? declared.value.lite.material : renderer.defaultMaterial().lite.material;
  }

  /**
   * Removes the meshes from the scene, when there are any.
   *
   * @param renderer - The rendering service, for the scene.
   * @returns `true` when something left the scene.
   */
  #release(renderer: RendererImpl): boolean {
    const instance = this.#instance;
    this.#instance = null;
    this.#appliedMesh = null;
    this.#appliedLodMesh = null;
    return instancedMeshSupport()?.releaseInstancedMesh(instance, renderer.scene) ?? false;
  }

  /**
   * Checks a count against the capacity and against what the slabs can hold.
   *
   * @param count - The count being set.
   * @param matrices - The matrix slab the count will be read against.
   * @param colors - The colour slab, or `null`.
   * @throws IgnifxError with code `IGX-0721` when the count does not fit.
   */
  #assertCount(count: number, matrices: Float32Array, colors: Float32Array | null): void {
    const capacity = normalisedCapacity(this.capacity);
    if (!Number.isInteger(count) || count < 0 || count > capacity) {
      throw this.#capacityError(
        count,
        capacity,
        `${String(count)} is not an integer instance count in 0..${String(capacity)}`,
      );
    }
    if (matrices.length < count * FLOATS_PER_MATRIX) {
      throw this.#capacityError(
        count,
        capacity,
        `the matrix slab holds ${String(Math.floor(matrices.length / FLOATS_PER_MATRIX))} instances, not ${String(count)}`,
      );
    }
    if (colors !== null && colors.length < count * FLOATS_PER_COLOR) {
      throw this.#capacityError(
        count,
        capacity,
        `the colour slab holds ${String(Math.floor(colors.length / FLOATS_PER_COLOR))} instances, not ${String(count)}`,
      );
    }
  }

  /**
   * Builds the `IGX-0721` misuse error.
   *
   * @param count - The count that was refused.
   * @param capacity - The renderer's capacity.
   * @param reason - What exactly did not fit.
   * @returns The error to throw.
   */
  #capacityError(count: number, capacity: number, reason: string): IgnifxError {
    return new IgnifxError(
      CoreErrorCode.instancedCapacityExceeded,
      `${this.entity.name}: ${String(count)} instances exceed the capacity of ${String(capacity)} — ${reason}.`,
      {
        context: { entity: this.entity.uid, count, capacity },
        hint: "Raise capacity before app.start(), or size the slab to hold capacity * 16 floats.",
      },
    );
  }
}

/**
 * Clamps a declared capacity to something Lite can size a buffer with.
 *
 * @remarks
 * The schema's `min: 1` is inspector metadata, not a runtime guard, and Lite would happily create a
 * four-byte buffer for a capacity of zero and then refuse every draw-count change against it.
 *
 * @param capacity - The declared value.
 * @returns At least one whole instance.
 */
function normalisedCapacity(capacity: number): number {
  return Number.isFinite(capacity) ? Math.max(1, Math.trunc(capacity)) : 1;
}

/**
 * The loaded value behind a mesh handle.
 *
 * @param handle - The handle, or `null`.
 * @returns The asset once the handle is loaded, else `null`.
 */
function loadedMesh(handle: AssetHandle<MeshAsset> | null): MeshAsset | null {
  return handle?.state === "loaded" ? handle.value : null;
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema. Built inside a function, not at module scope: a schema field is a function
 * call, and module scope holds declarations and immutable constants only
 * (`CONSTITUTION.md` §3.5, coding standards §4).
 */
function instancedMeshRendererSchema(): Schema {
  return defineSchema({
    mesh: asset(MeshAsset, { tooltip: "The geometry template every instance draws." }),
    materials: array(asset(MaterialAsset), [], { tooltip: "Index 0 draws; empty uses the default material." }),
    capacity: u32(1024, { min: 1, tooltip: "The largest instance count; fixed once the scene is registered." }),
    gpuCulling: bool(true, { tooltip: "Cull instances on the GPU; fixed once the scene is registered." }),
    castShadows: bool(true, { tooltip: "Whether the instances are rendered into shadow maps." }),
    receiveShadows: bool(true, { tooltip: "Whether shadow maps darken the instances." }),
    renderOrder: i32(0, { tooltip: "Sort key within the opaque or transparent phase; lower draws first." }),
    pickable: bool(false, { tooltip: "Whether picking considers the instances; a hit names no instance index." }),
    lod: optional(
      record({
        mesh: asset(MeshAsset, { tooltip: "The coarse mesh drawn beyond the switch distance." }),
        distance: f32(40, { min: 0, tooltip: "Camera distance, in metres, at which an instance switches." }),
        band: f32(6, { min: 0, tooltip: "Width of the per-instance dither window centred on the distance." }),
      }),
      { tooltip: "An optional coarse mesh for far instances; needs gpuCulling." },
    ),
  });
}
