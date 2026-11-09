/**
 * Assign a lightmap to a static renderer
 *
 * A lightmap is a texture of baked light that a `MeshRenderer` samples through its mesh's second UV
 * set. The `.lightmap.json` beside it names the texture by asset address:
 *
 * ```json
 * { "format": "ignifx-lightmap", "formatVersion": 1, "texture": "lighting/hall-lightmap.png", "entries": {} }
 * ```
 *
 * Only a renderer on a **static** entity with a **PBR** material samples it; anything else draws
 * without it and logs `IGX-0735` once. Set `entity.isStatic` before the renderer's first frame (or
 * in the scene file). The renderer then draws with its own copy of its material, so later edits of
 * the shared `MaterialAsset` do not reach it. `mode: "add"` adds the baked light to the shading;
 * `"shadowmap"` multiplies the shading by it, which suits a baked shadow mask over real-time lights.
 * `gamma: true` decodes an sRGB texture the loader did not already decode.
 *
 * ignifx bakes no lightmaps yet: the texture comes from an external tool, or from a future editor
 * baker. Per-entity atlas `entries` are validated but only the identity is drawn until the atlas
 * transform lands, so give each static renderer its own texture, or one whose UV2 already spans it.
 */
import { Camera, Light, MeshAsset, MeshRenderer, createApp } from "@ignifx/core";
import type { LightmapAsset } from "@ignifx/core";

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx renders into a <canvas> element.");
}

const app = await createApp({ canvas, settings: { assets: { root: "assets" } } });
// The loader loads the texture the file names; the handle is ready once the promise settles.
const lightmap = await app.assets.loadAsync<LightmapAsset>("lighting/hall.lightmap.json");

const eye = app.world.createEntity("Main Camera", { position: { x: 0, y: 3, z: -8 } });
eye.transform.lookAt({ x: 0, y: 0, z: 0 });
eye.addComponent(Camera, { fov: 55 });

// A moving light still lights the floor; the lightmap adds the bounce it baked.
const lamp = app.world.createEntity("Lamp", { position: { x: 0, y: 4, z: 0 } });
lamp.addComponent(Light, { type: "point", intensity: 20, range: 12 });

const floor = app.world.createEntity("Floor");
floor.isStatic = true; // before the first frame: only static entities sample a lightmap
floor.addComponent(MeshRenderer, {
  mesh: MeshAsset.ground(app, { width: 12, height: 12 }),
  // A primitive has no second UV set, so this floor samples with its first one (`uv2: false`).
  lightmap: { asset: lightmap, mode: "add", level: 1, gamma: true, uv2: false },
});

await app.start();
