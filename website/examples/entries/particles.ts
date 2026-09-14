/**
 * Particles examples: the shipped presets, a blast made of four documents, weather that follows the
 * camera, and the same documents drawn as sprites in a 2D scene.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleAsset, ExampleOf } from "../catalogue.ts";

/** Kenney's Tiny Town pack, which the village in `particles-2d` is built from. */
const TINY_TOWN: ExampleAsset = {
  name: "Tiny Town tileset",
  licence: "CC0 1.0",
  author: "Kenney",
  source: "https://kenney.nl/assets/tiny-town",
};

/** The repository's own generated top-down character sheet. */
const VILLAGER: ExampleAsset = {
  name: "Villager sprite sheet",
  licence: "Apache-2.0",
  author: "Astrum Forge Studios",
  source: "https://github.com/astrum-forge/ignifx/tree/main/tests/fixtures/assets/2d-templates",
};

/** The four particle images, painted by `website/examples/_tools/make-particle-sprites.ts`. */
const FX_SPRITES: ExampleAsset = {
  name: "Particle sprites and the blast ring",
  licence: "Apache-2.0",
  author: "Astrum Forge Studios",
  source: "https://github.com/astrum-forge/ignifx/blob/main/website/examples/_tools/make-particle-sprites.ts",
};

/** The Particles examples, in display order. */
export const PARTICLES: readonly ExampleOf<"Particles">[] = [
  {
    slug: "particles",
    title: "Particles",
    category: "Particles",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "The nine shipped effects on one emitter, and what can be changed while they run.",
    paragraph:
      'An effect is a document. `particleDefinition("fire")` returns a complete `.particles.json` — the emission ' +
      "rate, the shape, the start values, the forces, the curves and the gradients — and `ParticleSystem` plays one, " +
      "so the select below is nine documents handed to one component. The panel is in two halves because the split " +
      "is the design: the app owns the quality scale and the gravity, and both are read fresh every frame, while the " +
      "document owns everything else. A particle is computed from its spawn record by a formula, and drag and noise " +
      "are constants inside the generated WGSL program — so changing one builds a new document and a new program. " +
      "The lower sliders do exactly that, in coarse steps, and a combination already built is remembered.",
    tries: [
      "Run Quality down to a quarter: every rate and burst in the app falls with it, which is what a settings screen does.",
      "Drag Gravity up past zero on `smoke` or `sparks` — the app's gravity is a uniform, so the effect turns immediately.",
      "Add drag to `explosion` and watch the blast stop dead: that slider rebuilt the document and the shader behind it.",
    ],
    uses: ["ParticleSystem", "particleDefinition", "particleAssetFromDefinition", "app.particles", "app.diagnostics"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A tall orange and yellow flame of soft overlapping particles burning on a dark grey grid floor, its light " +
      "fading to deep red at the top against a near-black background.",
    sourceFiles: ["main.ts", "effects.ts"],
  },
  {
    slug: "explosion",
    title: "Explosion",
    category: "Particles",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Click the ground to set off a blast: fireball, sparks, shockwave and lit debris.",
    paragraph:
      "One blast is four documents played together on one entity — `ParticleSystem` is `allowMultiple` — and each " +
      "shows a different renderer. The fireball is a billboard burst; the sparks are `stretched`, so every streak is " +
      "aligned to its own velocity and lengthened by its speed; the shockwave is one `horizontal` particle lying " +
      "flat on the floor, growing from nothing to nine metres; the debris is `mesh`, two dozen lit boxes thrown up " +
      "and pulled back by the app's gravity. Nothing here runs per frame: a seed and a document are all a burst is, " +
      "so the same seed is the same blast, particle for particle, whatever the frame rate. The spent entity destroys " +
      "itself when `onStopped` fires.",
    tries: [
      "Click anywhere on the floor. The blast goes off where the ray met the ground, not where the camera is.",
      "Detonate twice on one seed, then change the seed and do it again — the first two are identical.",
      "Watch the draw calls while three blasts overlap: four systems each, and still four draws.",
    ],
    uses: ["ParticleSystem", "defineParticles", "onStopped", "Camera.screenToRay", "app.particles.systems"],
    assets: [FX_SPRITES],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "An orange fireball of overlapping particles bursting above a dark grid floor, with bright streaks of sparks " +
      "thrown outward, small dark boxes of debris tumbling through them, and a glowing ring spreading across the " +
      "floor beneath.",
    sourceFiles: ["main.ts", "blast.ts", "click-to-detonate.ts"],
  },
  {
    slug: "weather",
    title: "Weather",
    category: "Particles",
    dimension: "3D",
    priority: "P1",
    status: "ready",
    line: "Rain and snow in volumes that follow the camera, with a wind that tilts them.",
    paragraph:
      "A world of weather is a volume of weather over the viewer. Both documents declare " +
      '`simulationSpace: "world"`, which means a drop\'s position is computed from where its emitter stood when it ' +
      "was born rather than from where the emitter is now — so a thirty-metre volume can be dragged along behind " +
      "the camera and every drop already falling stays where it was. Wind is the same fact from the other side: the " +
      "forces in a document are fixed once it is built, but the emitter's transform is live, so tilting the volume " +
      "angles the drops it emits from now on while the ones in the air keep their own. The lit toggle hands the " +
      "component a different document, because `renderer.lit` changes the generated program.",
    tries: [
      "Turn Snow on and push Wind to one side: the rain slants at once, and the flakes that are already falling do not.",
      "Turn on Lit particles and orbit around the lamp-lit side — shaded drops darken as the light goes behind them.",
      "Orbit far out. The storm never runs out, because the volume is small and it is standing over the camera.",
    ],
    uses: ["ParticleSystem", "particleDefinition", "simulationSpace: world", "Environment.fog", "Script.lateUpdate"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A dark yard of wooden posts standing on a grid floor in heavy rain: thousands of pale vertical streaks " +
      "falling through the frame and past the posts, fading into fog towards the back.",
    sourceFiles: ["main.ts", "storm.ts", "volume.ts"],
  },
  {
    slug: "particles-2d",
    title: "2D particles",
    category: "Particles",
    dimension: "2D",
    priority: "P0",
    status: "ready",
    line: "Brazier fire, footstep dust and a sparkle over a pickup, on sorting layers with the sprites.",
    paragraph:
      "`ParticleSystem2D` reads the same `.particles.json` the 3D system reads — the same presets, the same modules, " +
      "the same emitter and the same evaluator — and draws it as sprites: every live particle is written into a " +
      "`SpriteBatch`, a block of entity-less slots in one sorting layer. So a particle blends, sorts and pans " +
      "exactly like the tiles around it, and a flame behind a roof is behind the roof. There is no Z in a 2D scene, " +
      "so where an effect draws is which layer it is on: the dust is under the villager, the flames and the glint " +
      "are over her and under the canopy. The dust has no script at all — `emission.rateOverDistance` spawns per " +
      "metre the emitter's entity moves, so walking makes dust and standing does not.",
    tries: [
      "Walk in a circle and stop: the puffs stay on the road behind you, because the document simulates in world space.",
      "Walk behind a roof. The braziers and the villager go behind the canopy layer together, sprites and particles alike.",
      "Pull Effects quality down: one number turns every rate in the app down, in 2D exactly as in 3D.",
    ],
    uses: ["ParticleSystem2D", "SpriteBatch", "sorting layers", "rateOverDistance", "Tilemap", "Camera2D"],
    assets: [TINY_TOWN, VILLAGER, FX_SPRITES],
    controls: ["keyboard", "gamepad", "touch"],
    posterAlt:
      "A pixel-art village seen from above with a villager in a red tunic on the dirt lane, an orange flame burning " +
      "at a brazier on either side of her, and a small gold pickup glinting with white stars on the road ahead.",
    sourceFiles: ["main.ts", "village-fx.ts", "walker.ts"],
  },
];
