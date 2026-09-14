/**
 * Draw particles in 2D
 *
 * `ParticleSystem2D` plays the same `.particles.json` a 3D `ParticleSystem` plays, but draws it as
 * sprites in a `@ignifx/2d` sorting layer, so torch fire sorts, blends and pans with the rest of
 * the scene. Both components run the same emitter and the same evaluator, so one document behaves
 * identically in either.
 *
 * Three packages register together: `twoD()` supplies the layers, `particles()` the document and
 * the shared budget (`app.particles`), and `particles2D()` the component. There is no settings
 * section of its own.
 *
 * Two rules the 3D system does not have. The **atlas** is the texture: `renderer.texture`, `mode`,
 * `lit` and `pivot` are ignored, a sheet tile index is used as the atlas **frame index** unchanged,
 * and a system whose atlas handle is not loaded reports `IGX-1754` once and draws nothing. And only
 * X and Y are drawn — records are still simulated in three dimensions, so an effect written for a
 * 2D scene should emit in the XY plane.
 */
import { Camera2D, twoD } from "@ignifx/2d";
import { Vec2, createApp } from "@ignifx/core";
import { particleAssetFromDefinition, particleDefinition, particles } from "@ignifx/particles";
import { ParticleSystem2D, particles2D } from "@ignifx/particles-2d";
import type { SpriteAtlasAsset } from "@ignifx/2d";

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("ignifx renders into a <canvas> element.");
}

const app = await createApp({
  canvas,
  settings: {
    assets: { root: "assets" },
    sortingLayers: { sortingLayers: ["Background", "Default", "Effects"] },
  },
  extensions: [twoD({ pixelsPerUnit: 16 }), particles(), particles2D()],
});

app.world.createEntity("Camera").addComponent(Camera2D, { orthographicSize: 6 });

// Awaited before `start()`, so the handle is loaded the first frame the system looks at it.
const atlas = await app.assets.loadAsync<SpriteAtlasAsset>("2d/fx.atlas.json");

// Sizes are metres: 0.4 is 0.4 world units, which is 6 pixels at `pixelsPerUnit: 16`.
const flame = particleAssetFromDefinition(
  app,
  particleDefinition("fire", {
    main: { capacity: 200, prewarm: true },
    emission: { rateOverTime: 40 },
    shape: { kind: "cone", angle: 12, radius: 0.1 },
    start: { size: { min: 0.2, max: 0.4 }, speed: { min: 1, max: 1.6 } },
    renderer: { sheet: { tiles: { x: 2, y: 2 }, frameOverTime: "random" }, blend: "additive" },
  }),
  "fx/torch",
);

const torch = app.world.createEntity("Torch");
torch.transform.position2D = new Vec2(-3, 1);
const fire = torch.addComponent(ParticleSystem2D, {
  definition: flame,
  atlas,
  // A moving effect belongs on a layer that does not Y-sort: any move marks such a layer unsorted.
  sortingLayer: "Effects",
});

await app.start();
app.log.info("torch sprites:", fire.spriteCount, "of", fire.capacity);

// One document, two renderers: swapping `ParticleSystem2D` for `ParticleSystem` is the only change.
const dust = app.world.createEntity("Footstep");
dust.transform.position2D = new Vec2(0, 0);
const puff = dust.addComponent(ParticleSystem2D, {
  definition: particleAssetFromDefinition(app, particleDefinition("dust"), "fx/footstep"),
  atlas,
  playOnAwake: false,
  sortingLayer: "Effects",
});
puff.emit(8);
