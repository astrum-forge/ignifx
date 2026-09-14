/**
 * Shaders examples: hand-written WGSL as a material, as a decoration on the engine's own PBR
 * material, as a vertex stage, and as a full-screen pass.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 *
 * The `.wgsl` files live under `website/examples/assets/shaders/<slug>/`, because that is the
 * directory `@ignifx/vite-plugin` scans for assets — it is what builds the address table each
 * example loads them through and what validates every one of them at build time. They are listed in
 * each entry's `sourceFiles` so the viewer's source pane shows the shader beside the TypeScript,
 * which is the half of the lesson that is not in `main.ts`.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The studio probe every lit example in this category is shown under. */
const STUDIO = {
  name: "Studio environment",
  licence: "CC-BY 4.0",
  author: "Babylon.js contributors",
  source: "https://github.com/BabylonJS/Assets/blob/master/environments/studio.env",
} as const;

/** The mascot, which is the subject of two of these examples. */
const SHIP = {
  name: "ignifx mascot ship",
  licence: "© 2026 Astrum Forge Studios Pty Ltd",
  author: "Astrum Forge Studios",
  source: "https://ignifx.com/press/",
} as const;

/** The Shaders examples, in display order. */
export const SHADERS: readonly ExampleOf<"Shaders">[] = [
  {
    slug: "custom-shader",
    title: "Custom shader",
    category: "Shaders",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Four hand-written WGSL materials on one sphere: toon, dissolve, hologram, force field.",
    paragraph:
      "There is no material JSON here and no `uniforms: [...]` array. Each `.wgsl` file declares itself with " +
      "`// @ignifx` comment pragmas — the attributes it reads, the engine values it wants, its own uniforms with a " +
      "type, a default, a range and a tooltip, and the blend and cull state it draws with — so the file stays valid " +
      "WGSL for every other tool and `@ignifx/vite-plugin` parses and checks it at build time: an undeclared name, " +
      "a hand-written binding or a `textureSample` in a vertex path is a build failure with the line it is on. What " +
      "a custom material gives up is everything the engine's PBR material does for free: Babylon Lite hands it " +
      "transforms, the camera position and the screen size, and no lights, no shadows and no probe. Toon and " +
      "dissolve therefore light themselves from ignifx's own `mainLightDirection`.",
    tries: [
      "Drag Progress on the dissolve: the sphere burns away and the surviving edge glows.",
      "Switch to Hologram and watch the scan lines crawl — that is `shaderUniforms.time`, which Lite does not have.",
      "Pull Bands on the toon shader down to one. Cel shading is `floor(lambert * n) / n` and nothing else.",
    ],
    uses: ["shaderMaterialDefinition", "MaterialAsset.setUniform", "SHADER_ASSET_TYPE", "MeshRenderer", "Environment"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A blue-grey sphere on a near-black floor with several rounded holes eaten through it, each hole ringed by a " +
      "band of glowing orange where the surface is burning away, against a faint pool of light behind it.",
    sourceFiles: [
      "main.ts",
      "shot.ts",
      "../assets/shaders/custom-shader/dissolve.wgsl",
      "../assets/shaders/custom-shader/toon.wgsl",
      "../assets/shaders/custom-shader/hologram.wgsl",
      "../assets/shaders/custom-shader/forcefield.wgsl",
    ],
  },
  {
    slug: "surface-shaders",
    title: "Surface shaders",
    category: "Shaders",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "Snow, wetness, a rim light and a hit flash on a PBR hull, with the lighting untouched.",
    paragraph:
      "A surface shader is the other half of the custom-shader story — Unity's `surf()`, Godot's `fragment()`. " +
      "Three named hooks are compiled into the engine's own PBR shader, so a custom look keeps direct lighting, " +
      "shadows, image-based lighting, fog and tone mapping without the author writing a line of any of it. The two " +
      "`surface` hooks here edit the base colour the lighting is then computed from, so the snow is shaded and " +
      "shadowed like paint; the two `composite` hooks add to the lit result, which is why the rim light survives " +
      "shadow and the hit flash reads even on a face the key light never reaches. The Corset beside the ship wears " +
      "none of them: same probe, same lamp, same shadow map.",
    tries: [
      "Press “Hit the ship”. The flash is one uniform driven to 1 and eased back — no material is rebuilt.",
      "Turn Snow off and on. That one costs a pipeline rebuild, because it changes Lite's cache key.",
      "Drag the water line up past the snow line and watch which hook wins: `surface` runs before lighting.",
    ],
    uses: ["pbrMaterialDefinition surfaces", "SurfaceShaderBinding", "features.materialPlugins", "Model", "Script"],
    assets: [
      SHIP,
      { ...STUDIO },
      {
        name: "Corset",
        licence: "CC0 1.0",
        author: "Microsoft",
        source: "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Corset",
      },
    ],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A dark metal spaceship floating above a studio floor and casting a shadow onto it, with pale snow settled " +
      "along its upward-facing plating, a darker damp band beneath, and a cool blue rim along its silhouette; a " +
      "small textured corset stands on the floor to its right, wearing none of it.",
    sourceFiles: [
      "main.ts",
      "shot.ts",
      "flash.ts",
      "../assets/shaders/surface-shaders/snow.surface.wgsl",
      "../assets/shaders/surface-shaders/wetness.surface.wgsl",
      "../assets/shaders/surface-shaders/rim.surface.wgsl",
      "../assets/shaders/surface-shaders/hit-flash.surface.wgsl",
    ],
  },
  {
    slug: "vertex-animation",
    title: "Vertex animation",
    category: "Shaders",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "A flag, a jelly cube and wind-blown grass, beside the one thing a surface shader cannot do.",
    paragraph:
      'Two routes to vertex motion, side by side. The flag, the cube and the grass are full `"shader"` materials ' +
      "that own their vertex stage: they read ignifx's clock and move the vertex wherever they like, with no " +
      "script, no skeleton and no per-frame CPU work at all — and no shadow, because Lite gives a custom material " +
      "no shadow bindings. The sphere on the right is an ordinary PBR material with a `.surface.wgsl` whose " +
      "`displace` hook bulges it: lit, shadow-casting and probe-lit like any PBR surface, but its offset is a fixed " +
      "function of the vertex's own position, because Lite declares a plugin's uniforms fragment-visible only and a " +
      "`displace` that reaches for a uniform or the clock is refused with `IGX-0723`.",
    tries: [
      "Push Strength to its maximum: the flag's normal bends with the wave, so the cloth lights as cloth.",
      "Turn the sphere's bulge off. The shape snaps back and the shadow it casts follows — the hook is in the vertex stage.",
      "Note that nothing here has an `update` method. Every animation in the frame is one sine in WGSL.",
    ],
    uses: ["shaderMaterialDefinition", "MeshAsset.fromData", "pbrMaterialDefinition surfaces", "SurfaceShaderBinding"],
    assets: [],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "Four subjects in a row on a dark floor: a red flag caught mid-swing on a thin metal pole, a bright green cube " +
      "squashed out of shape, a tuft of green grass blades leaning together in the wind, and a brown sphere pushed " +
      "out into rounded lobes, lit and casting a shadow.",
    sourceFiles: [
      "main.ts",
      "stage.ts",
      "meshes.ts",
      "../assets/shaders/vertex-animation/flag.wgsl",
      "../assets/shaders/vertex-animation/jelly.wgsl",
      "../assets/shaders/vertex-animation/grass.wgsl",
      "../assets/shaders/vertex-animation/bulge.surface.wgsl",
    ],
  },
  {
    slug: "custom-post-process",
    title: "Custom post-processing",
    category: "Shaders",
    dimension: "3D",
    priority: "P1",
    status: "ready",
    line: "Vignette, film grain, pixelate, CRT and a baked colour LUT on one `PostProcessStack`.",
    paragraph:
      "Five hand-written full-screen passes over the ship. A `.post.wgsl` declares `// @ignifx post` and provides " +
      "`fn mainFragment(in: PostInput) -> vec4<f32>` — a plain function, because Babylon Lite's fullscreen path " +
      "calls `effectFragment` by name and ignifx generates that entry point and forwards to yours. `inputTexture` " +
      "is the chain's current colour, and `shaderUniforms` always carries `screenSize`, `time`, `unscaledTime` and " +
      "`deltaTime`. Writing a value re-uploads that effect's uniform buffer; changing which effects exist, their " +
      "order or their textures rebuilds the chain — which is why the sliders are free and the toggles are settings. " +
      "The grade is a 16-cubed lookup table baked in code and uploaded with `TextureAsset.fromPixels`.",
    tries: [
      "Turn Pixelate on, then flip the Order select: blocks cut by scan lines, or scan lines over blocks.",
      "Pull the LUT's Amount to zero and back. That is the whole grade, in one lookup per pixel.",
      "Switch Film grain on. It is off in the opening frame because per-pixel noise is incompressible.",
    ],
    uses: ["PostProcessStack.custom", "customEffect", "TextureAsset.fromPixels", "features.postProcessing", "Model"],
    assets: [SHIP, { ...STUDIO }],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "A metal spaceship against a deep teal-black field, seen through a slightly bulged pane of glass: faint " +
      "horizontal scan lines cross the frame, the corners are curved and dark, and the whole picture is graded cool " +
      "in the shadows and warm on the ship's highlights.",
    sourceFiles: [
      "main.ts",
      "shot.ts",
      "lut.ts",
      "../assets/shaders/custom-post-process/vignette.post.wgsl",
      "../assets/shaders/custom-post-process/grain.post.wgsl",
      "../assets/shaders/custom-post-process/pixelate.post.wgsl",
      "../assets/shaders/custom-post-process/crt.post.wgsl",
      "../assets/shaders/custom-post-process/lut.post.wgsl",
    ],
  },
];
