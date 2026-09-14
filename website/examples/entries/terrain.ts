/**
 * Terrain examples: a heightmap island, a terrain regenerated from a seed, foliage scattered over
 * one, a character walking on one, and a terrain reshaped under the pointer.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here.
 *
 * Every terrain asset under `website/examples/assets/terrain/` is written by
 * `website/examples/_tools/make-terrain-assets.ts`, so nothing here needs a third-party licence and
 * a re-run reproduces the committed bytes.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Terrain examples, in display order. */
export const TERRAIN: readonly ExampleOf<"Terrain">[] = [
  {
    slug: "terrain",
    title: "Heightmap terrain",
    category: "Terrain",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "A 512-metre island from a 16-bit heightmap, four blended ground layers, and chunked LOD.",
    paragraph:
      "`island.terrain.json` names one `.r16` file — raw little-endian `uint16`, no header — and four ground " +
      "layers, and one RGBA image says which layer wins where: its red, green, blue and alpha channels are the " +
      "weights of sand, grass, rock and snow. Sixteen bits is not a detail; eight would put a 31 cm stair on every " +
      "slope of an 80 m range. The ground is sixty-four chunks, each built at four levels with a downward skirt on " +
      "every edge, and `TerrainLodSystem` picks one level per chunk in `PreRender` and then tests each chunk's box " +
      "against the camera's frustum, because Babylon Lite does not cull plain meshes. All four layers are blended " +
      "by one PBR material carrying a generated surface shader, so the ground keeps the engine's own lighting, fog " +
      "and tone mapping.",
    tries: [
      "Turn LOD markers on and fly forward: each marker changes colour as its chunk drops a level.",
      "Pull LOD bias down to 0.25. The chunk count is unchanged and the draw calls are unchanged — the triangles are not.",
      "Turn frustum culling off and watch Chunks drawn jump to all sixty-four.",
    ],
    uses: ["Terrain", "TerrainAsset", "TerrainLodSystem", "InstancedMeshRenderer", "Environment.fog"],
    assets: [],
    controls: ["keyboard", "mouse", "touch", "gamepad"],
    posterAlt:
      "An island seen from the air across dark blue water: a pale sand beach round its edge, rolling green " +
      "grassland inland, and grey rocky ridges with pale snow on the highest crests, fading into a blue haze at " +
      "the far shore.",
    sourceFiles: ["main.ts", "fly.ts", "lod-overlay.ts", "../assets/terrain/island.terrain.json"],
    heavy: true,
  },
  {
    slug: "terrain-procedural",
    title: "Procedural terrain",
    category: "Terrain",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Seven numbers and a seed: noise terrain rebuilt live, painted by rules, faded into fog.",
    paragraph:
      "No heightmap and no file. `terrainAssetFromDefinition` builds the whole asset in memory from the object " +
      "literal in `recipe.ts` plus whatever the sliders have done to it, so every control on the right rebuilds " +
      "the field, the chunks and the splat together. The noise is fractional Brownian motion: `octaves` layers, " +
      "each twice as fine and `persistence` times quieter; `ridged` folds every layer around its midpoint, which " +
      "turns dunes into crests; `terraces` quantises the result into steps. The paint is rules rather than an " +
      "image — a layer claims a height band, a slope band or both, and the generator feathers each edge by a " +
      "tenth of its width — which is why a new seed is a new island and not old paint on a new hill.",
    tries: [
      "Press “New island” a few times. The build time under it is the whole cost: field, chunks and splat.",
      "Turn Ridged on with octaves at 6. The same seed becomes mountains, and the rock rule finds the new slopes.",
      "Pull Terraces up to 12. Every rule still applies — the snow line now follows the steps.",
    ],
    uses: ["terrainAssetFromDefinition", "Terrain", "splatRules", "Environment.fog", "AssetHandle.release"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A square of rolling procedural land seen from above and to one side: pale sand in the hollows, green " +
      "slopes, grey rock on the steep faces and a little white on the high ground, its far edge dissolving into " +
      "pale blue fog.",
    sourceFiles: ["main.ts", "recipe.ts"],
  },
  {
    slug: "terrain-foliage",
    title: "Terrain foliage",
    category: "Terrain",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Grass and conifers scattered by the splat map, GPU-culled, LOD-swapped and blown by the wind.",
    paragraph:
      "Two `TerrainScatter` components, two draw calls and no model file. A scatter walks a jittered grid over the " +
      "field — `density` instances per square metre, capped by `maxInstances` — and keeps a candidate only if its " +
      "slope, its height and the terrain's splat weight for the named layers all accept it, so the grass stops " +
      "where the rock starts without a line of code saying so. Every random number is an integer hash of the cell " +
      "and the seed, so a headless test asserts the same forest a device draws, and placement runs once rather than " +
      "per frame. Each scatter owns an `InstancedMeshRenderer` with GPU culling on and a cheaper mesh past " +
      '`lodDistance`. The material is a `"shader"` material, not PBR: only a vertex stage the author owns can read ' +
      "the clock, which is what the wind sways on — and the stated price is that foliage casts shadows but receives " +
      "none.",
    tries: [
      "Pull Grass density to 3 per square metre and watch the instance counter, not the frame time.",
      "Push Wind to its maximum. Nothing in the frame has an `update` method; the sway is one sine in WGSL.",
      "Drop the grass LOD distance to 6 m: the crossed cards become flat ones and the silhouette barely changes.",
    ],
    uses: ["TerrainScatter", "createFoliageMaterial", "InstancedMeshRenderer", "MeshAsset.fromData", "Terrain"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A grassy hillside seen from just above the grass: thousands of small green blades leaning one way in the " +
      "wind, a scattering of dark conifers standing among them casting long shadows, and bare grey rock on the " +
      "steeper ground behind.",
    sourceFiles: ["main.ts", "meshes.ts"],
  },
  {
    slug: "terrain-walk",
    title: "Walk on terrain",
    category: "Terrain",
    dimension: "3D",
    priority: "P1",
    status: "ready",
    line: "A third-person character on a heightfield collider, kicking up dust with every stride.",
    paragraph:
      "`@ignifx/terrain` does not import `@ignifx/physics`, so a terrain in a game with no physics costs no physics " +
      "code. The join is data: `terrain.colliderInit()` answers the exact fields a `HeightfieldCollider` declares — " +
      "a row-major heights array, its sample counts, the size in metres, and the centre that offsets the shape onto " +
      "the field — so handing it straight to `addComponent` is the entire integration, and re-reading it inside " +
      "`onHeightsChanged` is how a sculpted terrain stays solid. The readouts under it come from the height field " +
      "rather than from the collider, which is why `heightAt` and `slopeAt` answer whether or not physics is " +
      "running. The dust is a `ParticleSystem` that never plays: a script counts stride length and calls `emit()`, " +
      "and emission runs late in `Update` so a burst asked for this frame is drawn this frame.",
    tries: [
      "Walk up the steepest face you can find. The controller gives up at its `slopeLimit`, not at the collider's.",
      "Sprint across the flat: the puffs stay the same distance apart, because the stride is metres and not seconds.",
      "Watch “Collider samples”: the whole 257-square field is one static Havok heightfield, built once.",
    ],
    uses: [
      "Terrain.colliderInit",
      "HeightfieldCollider",
      "ThirdPersonController",
      "ParticleSystem",
      "CharacterController",
    ],
    assets: [
      {
        name: "ignifx rig",
        licence: "Apache-2.0",
        author: "Astrum Forge Studios",
        source: "https://github.com/astrum-forge/ignifx/tree/main/website/examples/assets/models",
      },
    ],
    controls: ["keyboard", "mouse", "gamepad"],
    posterAlt:
      "A small blocky character standing on a green grassy hillside under a blue sky, casting a shadow, with " +
      "browner dirt on the steeper ground behind it and a low ridge on the horizon.",
    sourceFiles: ["main.ts", "controls.ts", "footsteps.ts"],
  },
  {
    slug: "terrain-sculpt",
    title: "Sculpt terrain",
    category: "Terrain",
    dimension: "3D",
    priority: "P2",
    status: "ready",
    line: "Drag to raise, lower and smooth the ground; the collider and the grass follow the edit.",
    paragraph:
      "`setHeights(x, z, width, depth, heights)` is the whole editing API. It rewrites the positions and normals of " +
      "every chunk the rectangle touches — one sample wider on each side, because a normal reads its neighbours — " +
      "and then raises `onHeightsChanged`. Two listeners pick that up and neither knows about the other: the " +
      "`HeightfieldCollider` re-reads `colliderInit()`, so a dropped ball rolls into the dent you just made, and " +
      "the `TerrainScatter` re-places its grass on the new slopes. Finding what is under the pointer needs no " +
      "physics at all: `Camera.screenToRay` answers in the backing-store pixels the pointer already reports, and " +
      "`Terrain.raycast` marches the height field on the CPU.",
    tries: [
      "Drag a ridge across the field, then drop a ball on the near side of it and watch where it stops.",
      "Switch to Smooth and scrub over your own ridge: the same call, with the mean of five samples as the target.",
      "Watch the grass counter while you dig. Every stroke re-places the whole scatter from its seed.",
    ],
    uses: [
      "Terrain.setHeights",
      "Terrain.onHeightsChanged",
      "Terrain.raycast",
      "HeightfieldCollider",
      "TerrainScatter",
    ],
    assets: [],
    controls: ["mouse", "touch"],
    posterAlt:
      "A small green field of rolling ground seen from above and to one side, tufted with grass, with bare grey " +
      "rock showing on the steeper faces and a blue sky behind.",
    sourceFiles: ["main.ts", "sculptor.ts"],
  },
];
