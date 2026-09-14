import { Camera, Terrain, terrain, terrainAssetFromDefinition } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { button, readout, slider, toggle } from "../_kit/panel.ts";
import { createSky, FIELD, LAYERS, SHOT, SKY, SPLAT_RULES } from "./recipe.ts";
import type { App, AssetHandle, TerrainAsset, TerrainDefinitionInput } from "ignifx";

/**
 * The same terrain system with no heightmap at all: seven numbers and a seed.
 *
 * `terrainAssetFromDefinition` builds a `TerrainAsset` in memory — no file, no fetch — so the whole
 * document is the object literal in `recipe.ts` plus whatever the sliders have done to it. The
 * noise is fractional Brownian motion: `octaves` layers of it, each `lacunarity` times finer and
 * `persistence` times quieter. `ridged` folds each layer around its midpoint, which turns rolling
 * dunes into crests, and `terraces` quantises the result into steps.
 *
 * The splat here is **rules**, not a painted map: each rule claims a layer inside a height band, a
 * slope band, or both, and the generator feathers every band's edge by a tenth of its width so the
 * layers blend. That is the half of the terrain that regenerates with the shape, and it is why a
 * new seed is a new island rather than an old paint job on a new hill.
 *
 * ## Why the old asset is released a beat late
 *
 * Assigning `ground.definition` does not rebuild the chunks; `TerrainLodSystem` does, in the next
 * `PreRender`. Releasing the outgoing asset in the same statement would dispose the control-map
 * textures the chunks are still bound to, so the handle is kept until the regeneration **after**
 * the one that replaced it.
 */

/**
 * The knobs the panel writes, which are the noise half of the document.
 *
 * @remarks
 * Plain mutable numbers rather than a component's fields, because there is no terrain component to
 * hold them: the document is rebuilt from scratch on every change.
 */
interface Recipe {
  seed: number;
  octaves: number;
  frequency: number;
  persistence: number;
  ridged: boolean;
  terraces: number;
}

bootExample({
  title: "Procedural terrain",
  extensions: [terrain()],
  settings: {
    rendering: { clearColor: SKY, msaaSamples: 4, features: { shadows: false } },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    const recipe: Recipe = { seed: 7, octaves: 6, frequency: 0.009, persistence: 0.5, ridged: false, terraces: 0 };
    let buildMs = 0;

    /**
     * The whole document for the current recipe.
     *
     * @returns What `terrainAssetFromDefinition` takes.
     */
    function definition(): TerrainDefinitionInput {
      return {
        name: "procedural",
        size: FIELD.size,
        resolution: FIELD.resolution,
        chunks: FIELD.chunks,
        noise: { ...recipe, lacunarity: 2 },
        layers: LAYERS,
        splatRules: SPLAT_RULES,
        material: { roughness: 0.95, metallic: 0 },
      };
    }

    /**
     * Builds one terrain asset and records how long it took.
     *
     * @param host - The app whose asset service registers it.
     * @returns The handle, with one holder — this file.
     */
    async function build(host: App): Promise<AssetHandle<TerrainAsset>> {
      const started = performance.now();
      const asset = await terrainAssetFromDefinition(host, definition());
      buildMs = performance.now() - started;
      return asset;
    }

    const first = await build(app);

    const sky = createSky(app);

    const ground = app.world.createEntity("Terrain").addComponent(Terrain, { definition: first });

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 1, far: 1400, fov: 52 });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      target: SHOT.target,
      minDistance: 40,
      maxDistance: 620,
      idleDegreesPerSecond: 3,
    });

    let held: AssetHandle<TerrainAsset> | null = null;
    let rebuilding = false;
    let again = false;

    /**
     * Replaces the terrain with one built from the current recipe.
     *
     * @remarks
     * One build at a time, with a trailing one: a dragged slider fires on every step, and what has
     * to land is the value the visitor stopped on.
     */
    function regenerate(): void {
      if (rebuilding) {
        again = true;
        return;
      }
      rebuilding = true;
      again = false;
      void build(app)
        .then((next: AssetHandle<TerrainAsset>): void => {
          const previous = ground.definition;
          ground.definition = next;
          held?.release();
          held = previous;
          rebuilding = false;
          if (again) {
            regenerate();
          }
        })
        .catch((error: unknown): void => {
          rebuilding = false;
          app.log.warn("terrain regeneration failed:", error);
        });
    }

    panel({
      title: "Procedural terrain",
      groups: [
        {
          label: "Noise",
          controls: [
            slider(
              "Seed",
              { min: 1, max: 60, step: 1 },
              {
                value: recipe.seed,
                change: (value: number): void => {
                  recipe.seed = Math.round(value);
                  regenerate();
                },
              },
            ),
            slider(
              "Octaves",
              { min: 1, max: 8, step: 1 },
              {
                value: recipe.octaves,
                change: (value: number): void => {
                  recipe.octaves = Math.round(value);
                  regenerate();
                },
              },
            ),
            slider(
              "Frequency",
              { min: 0.002, max: 0.03, step: 0.001, format: (v): string => v.toFixed(3) },
              {
                value: recipe.frequency,
                change: (value: number): void => {
                  recipe.frequency = value;
                  regenerate();
                },
              },
            ),
            slider(
              "Persistence",
              { min: 0.25, max: 0.75, step: 0.01 },
              {
                value: recipe.persistence,
                change: (value: number): void => {
                  recipe.persistence = value;
                  regenerate();
                },
              },
            ),
          ],
        },
        {
          label: "Shape",
          controls: [
            toggle("Ridged", {
              value: recipe.ridged,
              change: (on: boolean): void => {
                recipe.ridged = on;
                regenerate();
              },
            }),
            slider(
              "Terraces",
              { min: 0, max: 24, step: 1, format: (v): string => (v === 0 ? "off" : v.toFixed(0)) },
              {
                value: recipe.terraces,
                change: (value: number): void => {
                  recipe.terraces = Math.round(value);
                  regenerate();
                },
              },
            ),
            button("New island", (): void => {
              recipe.seed = (recipe.seed % 60) + 1;
              regenerate();
            }),
          ],
        },
        {
          label: "Air",
          collapsed: true,
          controls: [
            slider(
              "Fog density",
              { min: 0, max: 0.004, step: 0.0001, format: (v): string => v.toFixed(4) },
              {
                value: sky.fog.density,
                change: (value: number): void => {
                  sky.fog.density = value;
                },
              },
            ),
            readout("Build time", (): string => `${buildMs.toFixed(0)} ms`),
            readout("Chunks drawn", (): string => `${String(ground.visibleChunks)} of ${String(ground.chunkCount)}`),
            // `Terrain.drawCalls`, because a chunk is a renderable and not a component: Lite's own
            // counter includes bindings the terrain never issued.
            readout("Terrain draws", (): string => String(ground.drawCalls)),
          ],
        },
      ],
    });
  },
});
