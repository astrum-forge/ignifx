/**
 * The scene dressing every 3D example starts from: a ground plane, a three-point light rig, and
 * the environments an example can light itself with
 * (`website/plan/04-examples-platform.md` §4).
 *
 * Nothing here is engine machinery. It is the handful of entities that would otherwise be copied
 * into every example and would make each one twice as long as its lesson.
 *
 * ## The ground is a tiling texture, not a grid shader
 *
 * ignifx declares `"type": "shader"` in the material format and rejects it at runtime with
 * `IGX-0708` — custom shader materials are wishlist item W-R1 (`website/plan/07-wishlist.md`), not
 * a shipped feature — so the grid is a 128 px tile repeated by `MeshAsset.ground`'s `uvScale`. One
 * tile per metre, so the lines are exactly a metre apart at any ground size, and the tile is the
 * repository's own art (`_tools/make-grid-texture.ts`).
 */

import {
  createMaterialAsset,
  ENVIRONMENT_ASSET_TYPE,
  Light,
  MeshAsset,
  MeshRenderer,
  pbrMaterialDefinition,
  TEXTURE_ASSET_TYPE,
} from "ignifx";
import type { App, AssetHandle, ColorLike, Entity, EnvironmentAsset, ShadowTechniqueName, TextureAsset } from "ignifx";

/**
 * The prefiltered environments the kit vendors, by the name an example asks for them by.
 *
 * @remarks
 * One entry today. An `.env` is installed onto the scene by the asset loader — Lite's
 * `loadEnvironment(scene, url, …)` installs the cube map, its harmonics and the skybox and hands
 * back a receipt (`packages/core/src/render/environment-asset.ts`) — and since 2026-09-08 the
 * `Environment` component re-installs a *different loaded* handle when you assign it, so an example
 * can switch between environments it loaded before `app.start()` (diffuse lighting follows at once,
 * specular reflections on the next rebuild). Two things do not follow a swap: the background (Lite
 * owns the skybox renderable; `skyboxEnabled: false` here, and examples draw their own backdrop) and
 * anything loaded after start, which gets no background at all.
 */
export const ENVIRONMENTS = {
  /** A neutral softbox studio: three broad sources, almost no colour. */
  studio: "environments/studio.environment.json",
} as const;

/** One of {@link ENVIRONMENTS}' keys. */
export type EnvironmentName = keyof typeof ENVIRONMENTS;

/** The names, in display order, for a panel's `select` control. */
export const ENVIRONMENT_NAMES: readonly EnvironmentName[] = Object.freeze(["studio"]);

/** The grid tile the ground is covered with. */
const GRID_TEXTURE_ADDRESS = "textures/grid.png";

/** What {@link createGridGround} takes. */
export interface GridGroundOptions {
  /** The plane's edge length, in metres. One grid cell per metre. */
  readonly size?: number;
  /** The colour the white grid tile is tinted with, in sRGB. */
  readonly color?: ColorLike;
  /** How rough the surface is; 1 is fully diffuse. */
  readonly roughness?: number;
}

/** What {@link createGridGround} answers with. */
export interface GridGround {
  /** The ground entity, so an example can move or hide it. */
  readonly entity: Entity;
  /** Releases the mesh, material and texture handles the ground holds. */
  release(): void;
}

/** What {@link createStudioFloor} takes. */
export interface StudioFloorOptions {
  /** The plane's edge length, in metres. */
  readonly size?: number;
  /** The floor's colour, in sRGB. Defaults to the site's dark `--bg`. */
  readonly color?: ColorLike;
  /** How rough the surface is; 1 is fully diffuse. */
  readonly roughness?: number;
  /**
   * How strongly the environment shows in the floor. Low, so a mirror floor does not compete with
   * the subject, but not zero: a little bounce is what stops it reading as a hole.
   */
  readonly environmentIntensity?: number;
}

/** A three-component point, as the kit's options take one. */
export interface Point3 {
  /** Metres along X. */
  readonly x: number;
  /** Metres along Y. */
  readonly y: number;
  /** Metres along Z. */
  readonly z: number;
}

/** What {@link createLightRig} takes. */
export interface LightRigOptions {
  /** The key light's intensity. */
  readonly keyIntensity?: number;
  /** The fill light's intensity. */
  readonly fillIntensity?: number;
  /** The rim light's intensity. */
  readonly rimIntensity?: number;
  /** Whether the key light casts. Needs `rendering.features.shadows`, or it does nothing. */
  readonly shadows?: boolean;
  /** The point the key and rim lights are aimed at, in metres. */
  readonly focus?: Point3;
  /** Where the key light sits before it is aimed at `focus`, in metres. */
  readonly keyPosition?: Point3;
  /** Where the rim light sits before it is aimed at `focus`, in metres. */
  readonly rimPosition?: Point3;
  /**
   * Where the fill light sits, in metres. Naming it makes the fill a **directional** light aimed at
   * `focus` — a second lamp on the far side from the key, which is what makes a panel line read on
   * a metal surface. Omitted, the fill is hemispheric: ambient sky light, and no shape at all.
   */
  readonly fillPosition?: Point3;
  /** The fill light's sRGB colour. Cooler than the key, by convention and by eye. */
  readonly fillColor?: ColorLike;
  /**
   * Which shadow technique the key light uses. `"esm"` is an exponential map: soft, and cheaper to
   * make soft than a wider PCF kernel. `"pcf"` is sharper and is the default because most scenes
   * want a defined contact shadow.
   */
  readonly shadowTechnique?: ShadowTechniqueName;
  /** The shadow map's edge length, in texels. */
  readonly shadowMapSize?: number;
  /**
   * How light a fully shadowed texel is, `0` to `1`. `0` is a black shadow; a product shot wants
   * about `0.35`, so the shadow reads as contact rather than as a hole in the floor.
   */
  readonly shadowDarkness?: number;
}

/** What {@link createBackdrop} takes. */
export interface BackdropOptions {
  /** The sphere's diameter, in metres. Large enough to sit outside anything the scene draws. */
  readonly diameter?: number;
}

/** The three lights {@link createLightRig} built. */
export interface LightRig {
  /** The directional key light, front left and above; the one that casts. */
  readonly key: Light;
  /** The fill: hemispheric and cool from the sky, or directional when a position was named. */
  readonly fill: Light;
  /** The directional rim, behind the subject, for an edge that burns against a dark backdrop. */
  readonly rim: Light;
}

/** The ground's edge length when the caller names none, in metres. */
const DEFAULT_GROUND_SIZE = 40;

/** The shadow map's edge length when the caller names none, in texels. */
const SHADOW_MAP_SIZE = 1024;

/** The vertical ramp the studio backdrop is painted with. */
const BACKDROP_TEXTURE_ADDRESS = "textures/backdrop.png";

/**
 * The backdrop sphere's diameter when the caller names none, in metres.
 *
 * @remarks
 * Small on purpose. A camera two metres from the origin inside a 200-metre sphere sees a few degrees
 * of the ramp and therefore a flat wall; inside a 20-metre one it sees a real vertical wash. The
 * sphere only has to sit outside whatever the scene draws, not outside the far plane.
 */
const DEFAULT_BACKDROP_DIAMETER = 20;

/** How many segments the backdrop sphere is built from. Enough that no facet edge is visible. */
const BACKDROP_SEGMENTS = 32;

/**
 * Loads one of the vendored environments.
 *
 * @remarks
 * Awaiting the handle **before** `app.start()` is the pattern to copy: a load that completes before
 * the loop runs settles at once, while one awaited afterwards waits for a `PreUpdate`
 * (`skills/ignifx/references/concepts/assets.md` §3). The BRDF lookup table the `.env` needs is
 * vendored at `environments/brdf-lut.png`, which is `DEFAULT_BRDF_LUT_ADDRESS`, so no example has
 * to name it.
 *
 * @param app - The app whose asset service loads it.
 * @param name - Which environment.
 * @returns The handle, with one holder — the caller, which releases it.
 *
 * @example
 * ```ts
 * const studio = loadEnvironment(app, "studio");
 * await studio.promise;
 * ```
 */
export function loadEnvironment(app: App, name: EnvironmentName): AssetHandle<EnvironmentAsset> {
  return app.assets.load<EnvironmentAsset>(ENVIRONMENTS[name], { type: ENVIRONMENT_ASSET_TYPE });
}

/**
 * Builds the ground plane: one metre of grid per metre of world, lit and shadow-receiving.
 *
 * @remarks
 * Asynchronous for one reason, and it is a reason worth reading twice: `createMaterialAsset` binds
 * the texture handles it is given **once**, and `indexTextures` skips any handle whose `state` is
 * not `"loaded"` (`packages/core/src/render/material-asset.ts`). Building the material with a
 * still-loading handle therefore produces an untextured material, silently — which is exactly what
 * happened the first time this ground was written, and the grid simply did not appear. Awaiting the
 * texture before `app.start()` costs nothing: a completed load settles at once until the loop runs.
 *
 * @param app - The app the entity and the assets belong to.
 * @param options - Size, tint and roughness.
 * @returns The entity, and the release for the three handles it holds.
 *
 * @example
 * ```ts
 * const ground = await createGridGround(app, { size: 24 });
 * // …at teardown: ground.release();
 * ```
 */
export async function createGridGround(app: App, options?: GridGroundOptions): Promise<GridGround> {
  const size = options?.size ?? DEFAULT_GROUND_SIZE;
  const texture = app.assets.load<TextureAsset>(GRID_TEXTURE_ADDRESS, { type: TEXTURE_ASSET_TYPE });
  await texture.promise;
  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "kit/grid",
      baseColor: options?.color ?? { r: 0.3, g: 0.32, b: 0.37, a: 1 },
      metallic: 0,
      roughness: options?.roughness ?? 0.92,
      // The environment is what lights an example, and a floor that mirrored it would compete with
      // the subject. A third of the usual contribution keeps it grounded and quiet.
      environmentIntensity: 0.35,
      textures: { baseColorTexture: GRID_TEXTURE_ADDRESS },
    }),
    [texture],
  );
  const mesh = MeshAsset.ground(app, { width: size, height: size, subdivisions: 1, uvScale: [size, size] });
  const entity = app.world.createEntity("Ground");
  entity.addComponent(MeshRenderer, {
    mesh,
    materials: [material],
    castShadows: false,
    receiveShadows: true,
    pickable: false,
  });
  return {
    entity,
    release(): void {
      mesh.release();
      material.release();
      texture.release();
    },
  };
}

/**
 * Builds the three-point rig: a shadow-casting key, a cool hemispheric fill, and a warm rim.
 *
 * @remarks
 * A `Light` is aimed by its entity's transform — a directional light shines along the entity's
 * `+Z`, and a hemispheric light's sky direction is its `+Y` — so each light is positioned and then
 * pointed with `lookAt`. Point and hemispheric lights cast no shadow at all (`IGX-0703`), which is
 * why the key is the directional one.
 *
 * @param app - The app the entities belong to.
 * @param options - Intensities, whether the key casts, and what the rig is aimed at.
 * @returns The three light components.
 *
 * @example
 * ```ts
 * const rig = createLightRig(app, { shadows: true, focus: { x: 0, y: 0.5, z: 0 } });
 * rig.key.shadows.enabled = false; // what a graphics setting toggles
 * ```
 */
export function createLightRig(app: App, options?: LightRigOptions): LightRig {
  const focus = options?.focus ?? { x: 0, y: 0.4, z: 0 };
  const keyAt = options?.keyPosition ?? { x: -3.4, y: 5.2, z: -3.8 };
  const rimAt = options?.rimPosition ?? { x: 3.6, y: 2.4, z: 4.2 };
  const technique = options?.shadowTechnique ?? "pcf";

  const keyEntity = app.world.createEntity("Key Light");
  keyEntity.transform.localPosition.set(keyAt.x, keyAt.y, keyAt.z);
  keyEntity.transform.lookAt(focus);
  const key = keyEntity.addComponent(Light, {
    type: "directional",
    intensity: options?.keyIntensity ?? 2.6,
    color: { r: 1, g: 0.97, b: 0.92, a: 1 },
  });
  key.shadows.enabled = options?.shadows ?? true;
  key.shadows.technique = technique;
  key.shadows.mapSize = options?.shadowMapSize ?? SHADOW_MAP_SIZE;
  key.shadows.darkness = options?.shadowDarkness ?? 0;
  // `normalBias` is a PCF-only offset along the surface normal (`Light.shadows`' own tooltip says
  // so). Without it a PCF map at this resolution stripes a curved surface with its own shadow; with
  // ESM it is ignored, and ESM's own `bias` default is already right for a metre-scale subject.
  key.shadows.normalBias = technique === "pcf" ? 0.02 : 0;

  const fillAt = options?.fillPosition;
  const fillEntity = app.world.createEntity("Fill Light");
  if (fillAt !== undefined) {
    fillEntity.transform.localPosition.set(fillAt.x, fillAt.y, fillAt.z);
    fillEntity.transform.lookAt(focus);
  }
  const fill = fillEntity.addComponent(Light, {
    type: fillAt === undefined ? "hemispheric" : "directional",
    intensity: options?.fillIntensity ?? 0.35,
    color: options?.fillColor ?? { r: 0.74, g: 0.81, b: 1, a: 1 },
  });

  const rimEntity = app.world.createEntity("Rim Light");
  rimEntity.transform.localPosition.set(rimAt.x, rimAt.y, rimAt.z);
  rimEntity.transform.lookAt(focus);
  const rim = rimEntity.addComponent(Light, {
    type: "directional",
    intensity: options?.rimIntensity ?? 1.1,
    color: { r: 1, g: 0.86, b: 0.72, a: 1 },
  });

  return { key, fill, rim };
}

/**
 * Builds the three-point rig with a product shot's settings already applied.
 *
 * @remarks
 * The same rig as {@link createLightRig}, with the numbers a studio frame wants: an **ESM** shadow
 * map — blurred by construction, and cheaper to make soft than a wider PCF kernel — at 2048 texels,
 * `darkness` lifted off black so a fully shadowed texel reads as contact rather than as a hole in
 * the floor, a key close in and high so the shadow is short, a rim low and behind, and a quieter
 * fill. Anything named in `options` still wins, so an example can move one light and keep the rest.
 *
 * @param app - The app the entities belong to.
 * @param options - Overrides; `focus` and the two intensities are the usual ones.
 * @returns The three light components.
 *
 * @example
 * ```ts
 * const rig = createStudioRig(app, { focus, keyIntensity: 3.1, rimIntensity: 2.2 });
 * rig.rim.exclude = [floor.entity];
 * ```
 */
export function createStudioRig(app: App, options?: LightRigOptions): LightRig {
  return createLightRig(app, {
    fillIntensity: 0.22,
    keyPosition: { x: -2, y: 4.6, z: -1.6 },
    rimPosition: { x: 1.1, y: 1.4, z: 3.2 },
    shadowTechnique: "esm",
    shadowMapSize: 2048,
    shadowDarkness: 0.35,
    ...options,
  });
}

/**
 * Builds a plain dark floor: no grid, matte, and there to catch a shadow.
 *
 * @remarks
 * The grid ground says "this is a scene". A product shot wants the opposite — a floor you do not
 * look at, in the page's own dark tones, whose only job is to give the subject a contact shadow.
 * Same asynchrony as {@link createGridGround} would have if it had a texture, except that this one
 * has none, so it is synchronous.
 *
 * @param app - The app the entity and the assets belong to.
 * @param options - Size, colour, roughness and how much environment it shows.
 * @returns The entity, and the release for the two handles it holds.
 *
 * @example
 * ```ts
 * const floor = createStudioFloor(app, { size: 20 });
 * ```
 */
export function createStudioFloor(app: App, options?: StudioFloorOptions): GridGround {
  const size = options?.size ?? DEFAULT_GROUND_SIZE;
  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "kit/studio-floor",
      // `--bg` from the site's dark palette (`02-design-system.md` §2.3), decoded to 0-1 sRGB.
      baseColor: options?.color ?? { r: 0.051, g: 0.063, b: 0.082, a: 1 },
      metallic: 0,
      roughness: options?.roughness ?? 0.78,
      environmentIntensity: options?.environmentIntensity ?? 0.18,
    }),
    [],
  );
  const mesh = MeshAsset.ground(app, { width: size, height: size, subdivisions: 1 });
  const entity = app.world.createEntity("Floor");
  entity.addComponent(MeshRenderer, {
    mesh,
    materials: [material],
    castShadows: false,
    receiveShadows: true,
    pickable: false,
  });
  return {
    entity,
    release(): void {
      mesh.release();
      material.release();
    },
  };
}

/**
 * Builds the studio backdrop: an inverted sphere painted with a vertical ramp, drawn unlit.
 *
 * @remarks
 * See `_tools/make-backdrop-texture.ts` for why this is a sphere and a ramp rather than
 * `Environment.skybox`. The short version: the skybox draws the `.env`'s own cube map, which is a
 * mid-grey softbox room — right as lighting, wrong as a backdrop — and `Environment.blur` would
 * soften the reflections along with it.
 *
 * `unlit` keeps the ramp exactly as painted whatever the lights do, and `doubleSided` is what makes
 * the inside of the sphere visible from the camera inside it. It costs one draw call.
 *
 * @param app - The app the entity and the assets belong to.
 * @param options - The sphere's diameter.
 * @returns The entity, and the release for the three handles it holds.
 *
 * @example
 * ```ts
 * await createBackdrop(app);
 * ```
 */
export async function createBackdrop(app: App, options?: BackdropOptions): Promise<GridGround> {
  const texture = app.assets.load<TextureAsset>(BACKDROP_TEXTURE_ADDRESS, { type: TEXTURE_ASSET_TYPE });
  // Awaited for the reason `createGridGround`'s remarks give at length: a material binds its
  // textures once, and a handle that is still loading binds as no texture at all.
  await texture.promise;
  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({
      name: "kit/backdrop",
      baseColor: { r: 1, g: 1, b: 1, a: 1 },
      metallic: 0,
      roughness: 1,
      unlit: true,
      doubleSided: true,
      textures: { baseColorTexture: BACKDROP_TEXTURE_ADDRESS },
    }),
    [texture],
  );
  const mesh = MeshAsset.sphere(app, {
    diameter: options?.diameter ?? DEFAULT_BACKDROP_DIAMETER,
    segments: BACKDROP_SEGMENTS,
  });
  const entity = app.world.createEntity("Backdrop");
  entity.addComponent(MeshRenderer, {
    mesh,
    materials: [material],
    castShadows: false,
    receiveShadows: false,
    pickable: false,
  });
  return {
    entity,
    release(): void {
      mesh.release();
      material.release();
      texture.release();
    },
  };
}
