/**
 * The fifteen sections of `/features/`, pasted from `website/plan/03-pages-and-copy.md` §3.
 *
 * The order is the plan's order and is also the order of the jump bar. Every "See it" chip names a
 * catalogue slug; `exampleHref` resolves one that is not built yet to its category section rather
 * than to a 404 (`08-execution.md` §3).
 */
import type { ExampleCategory } from "../examples/catalogue.ts";

/** One "See it" chip. */
export interface FeatureChip {
  /** The chip's label. */
  readonly label: string;
  /** A catalogue slug, or a site route when the copy points at a page. */
  readonly target: string;
  /** The category section the link falls back to while the slug is unbuilt. */
  readonly fallback: ExampleCategory;
}

/** One section of `/features/`. */
export interface FeatureSection {
  /** The section `id`, used by the jump bar. */
  readonly id: string;
  /** The `h2` text. */
  readonly title: string;
  /** The packages it lives in, as written in the plan's heading. */
  readonly packages: string;
  /** The lead paragraph. */
  readonly body: string;
  /** The capability list, laid out in two columns. */
  readonly bullets: readonly string[];
  /** The "See it" chips. */
  readonly chips: readonly FeatureChip[];
}

/** The fifteen sections, in display order. */
export const FEATURE_SECTIONS: readonly FeatureSection[] = [
  {
    id: "kernel",
    title: "Kernel and scripting",
    packages: "@ignifx/core",
    body:
      "The engine's core is small and explicit. An `App` owns a `World`; a world holds scenes; scenes " +
      "hold entities; entities hold a transform and components. A `Script` is a component with " +
      "lifecycle callbacks and typed fields you declare with a schema, so every field is serialisable, " +
      "inspectable and hot-reloadable without a decorator in sight.",
    bullets: [
      "`createApp` with extensions, settings, a clock and a log sink",
      "`World`, `SceneInstance`, `Entity`, `Transform`, tags and layers",
      "`Component` for data, `Script` for behaviour; fields from `Script.define({ … })`",
      "A documented frame: `PreUpdate` → `fixedUpdate` × N → `start` → `update` → coroutines → `PostUpdate` → `lateUpdate` → `PreRender` → render",
      "Coroutines as generators; `Signal` with owner-scoped disconnect",
      "`app.time`: fixed step, time scale, pause and resume, clamped deltas",
      "`app.tweens` for numbers, vectors and quaternions on the game clock",
      "Metres, seconds, degrees; left-handed, Y up",
      "Every engine error has an `IGX-####` code and reaches `app.onError`",
      "Diagnostics counters and structured logging",
    ],
    chips: [
      { label: "Lifecycle", target: "lifecycle", fallback: "Basics" },
      { label: "Coroutines and tweens", target: "coroutines-tweens", fallback: "Basics" },
      { label: "Signals", target: "signals", fallback: "Basics" },
    ],
  },
  {
    id: "rendering",
    title: "Rendering",
    packages: "@ignifx/core on Babylon Lite",
    body:
      "ignifx renders exclusively through WebGPU, using Babylon Lite as its rasteriser. You describe a " +
      "frame with six components and the engine keeps Babylon Lite in sync, once per frame, writing " +
      "only what changed.",
    bullets: [
      "`Camera`: perspective and orthographic, priority, viewport, clear colour, screen-to-ray and world-to-screen",
      "`Light`: directional, point, spot and hemispheric; include and exclude lists",
      "Shadows from directional and spot lights: PCF and ESM maps, cascades, bias and map size",
      "`MeshRenderer` with box, ground and custom geometry; `Model` for glTF 2.0 and GLB",
      "PBR materials from `.material.json` or from code; unlit materials; material overrides per model",
      "`Environment`: image-based lighting from `.env`, `.hdr` and `.dds`, skybox, fog, exposure, contrast and Standard, ACES or Neutral tone mapping",
      "`PostProcessStack`: bloom, SMAA anti-aliasing, image processing",
      "MSAA ×4, resolution scale and device-pixel-ratio clamp",
      "GPU picking and CPU raycasts against renderables",
      "Screenshots, per-task GPU timings, draw-call counters",
      "Material warm-up before a scene shows, and WebGPU device-loss recovery",
      "A documented `.lite` escape hatch when you need Babylon Lite itself",
    ],
    chips: [
      { label: "Physically based rendering", target: "pbr-model", fallback: "Rendering" },
      { label: "Shadows", target: "shadows", fallback: "Lighting" },
      { label: "Bloom", target: "bloom", fallback: "Post-processing" },
      { label: "Tone mapping", target: "tone-mapping", fallback: "Lighting" },
      { label: "Picking", target: "picking", fallback: "Rendering" },
    ],
  },
  {
    id: "assets",
    title: "Assets and scenes",
    packages: "@ignifx/core and @ignifx/vite-plugin",
    body:
      "Everything a game loads is addressed by path, typed, reference-counted and asynchronous. The " +
      "Vite plugin generates the manifest, validates every JSON document against the engine's schemas " +
      "at build time, and hot-swaps assets while you work.",
    bullets: [
      "Textures (PNG, JPEG, WebP, KTX2, Basis), models (glTF, GLB), environments (`.env`, `.hdr`, `.dds`), fonts, audio, JSON, text and bytes",
      'Sub-assets by fragment: `"hero.glb#animation:Run"`',
      "Cancellable loads, preload groups, reference counting with delayed unload",
      "One format for scenes and prefabs; `world.instantiate` stamps a prefab out and overrides survive a save and load",
      "`serializeScene` for saves; versioned save documents in the templates",
      "Hot reload of assets and scripts in development",
    ],
    chips: [
      { label: "Model loading", target: "model-loading", fallback: "Models" },
      { label: "Scenes and prefabs", target: "scenes-and-prefabs", fallback: "Gameplay" },
      { label: "Loading screen", target: "loading-screen", fallback: "UI" },
    ],
  },
  {
    id: "input",
    title: "Input",
    packages: "@ignifx/input",
    body:
      'Game code asks for `"jump"`, never for a key code. Actions, bindings, composites and processors ' +
      "live in an `.input.json` document, so rebinding is data and control schemes are a file.",
    bullets: [
      "Keyboard, mouse, pointer, gamepad and touch devices",
      "Action maps, control schemes, composites (2D vectors, axes), processors (dead zone, normalise, clamp, scale, invert)",
      "`wasPressedThisFrame` that is consistent across every fixed step of a frame",
      "Interactive rebinding with save and load of overrides",
      "Pointer lock and cursor control",
      "Virtual joystick and buttons for touch (with `@ignifx/ui`)",
      "`simulate()` for tests: drive input headlessly with no device",
    ],
    chips: [
      { label: "Input actions", target: "input-actions", fallback: "Input" },
      { label: "Rebinding", target: "rebinding", fallback: "Input" },
      { label: "Touch controls", target: "touch-controls", fallback: "Input" },
    ],
  },
  {
    id: "physics-3d",
    title: "3D physics",
    packages: "@ignifx/physics",
    body:
      "Havok, through Babylon Lite, stepped by the engine's fixed loop and interpolated for the screen. " +
      "It runs headlessly too, so a physics test needs no GPU.",
    bullets: [
      "`Rigidbody`: dynamic, kinematic and static; mass, rotation locks, sleep",
      "Box, sphere, capsule, cylinder, mesh and heightfield colliders; triggers",
      "Physics materials (`.physicsmaterial.json`): friction, restitution",
      "`CharacterController`: collide-and-slide, a slope limit, support detection and body pushing",
      "Collision and trigger enter, stay and exit events",
      "Raycasts, shape casts and overlaps with a layer matrix",
      "Deterministic per platform: the same inputs give the same hash across processes",
    ],
    chips: [
      { label: "Physics playground", target: "physics-playground", fallback: "Physics" },
      { label: "Character controller", target: "character-controller", fallback: "Physics" },
      { label: "Raycasts and triggers", target: "raycasts-triggers", fallback: "Physics" },
    ],
  },
  {
    id: "twod",
    title: "2D toolkit",
    packages: "@ignifx/2d",
    body: "Sprites, atlases, tilemaps and cameras in pixels per unit, drawn through Babylon Lite's sprite layers.",
    bullets: [
      "`Camera2D` with pixels per unit, pixel-perfect zoom, follow with a dead zone",
      "`SpriteRenderer`, `SpriteAnimator` and `.spriteanimation.json` clips",
      "Atlas importers for TexturePacker, Aseprite and grids",
      "`Tilemap` and `TilemapRenderer` with Tiled and LDtk importers and chunk culling",
      "Sorting layers with Y-sort; `ParallaxLayer`; per-layer tint and custom shaders",
      "2D picking",
    ],
    chips: [
      { label: "Sprite animation", target: "sprite-animation", fallback: "2D" },
      { label: "Tilemap", target: "tilemap", fallback: "2D" },
      { label: "Parallax", target: "parallax", fallback: "2D" },
      { label: "Pixel-perfect", target: "pixel-perfect", fallback: "2D" },
    ],
  },
  {
    id: "physics-2d",
    title: "2D physics",
    packages: "@ignifx/physics-2d",
    body:
      "Rapier 2D behind the same component vocabulary as 3D, with a platformer controller that handles " +
      "the cases a platformer needs.",
    bullets: [
      "`Rigidbody2D`; box, circle, capsule, polygon, edge and tilemap colliders; triggers",
      "`CharacterController2D`: slopes, auto-step, snap-to-ground, one-way platforms",
      "Queries, events, interpolation, a layer matrix",
      "Runs headlessly; deterministic per platform",
    ],
    chips: [
      { label: "2D physics", target: "physics-2d", fallback: "Physics" },
      { label: "Platformer controller", target: "platformer-controller", fallback: "Physics" },
    ],
  },
  {
    id: "threed",
    title: "3D toolkit",
    packages: "@ignifx/3d",
    body: "The parts of a 3D game that every 3D game rewrites, done once.",
    bullets: [
      "`ThirdPersonController` and `FirstPersonController`: walk, sprint, crouch, jump, head pitch",
      "`ThirdPersonCamera`: an orbit rig with wall collision and damping",
      "`Animator`: a state machine from `.animator.json` with 1D blend trees, masks, additive layers and events, driving glTF skeletons",
      "`NavMeshSurface`, `NavMeshAgent` and `NavMeshObstacle` on Recast, baked headlessly",
      "`RigidbodyMover`, `PlatformMover`, `Projectile`, `LodGroup`, `Billboard`",
    ],
    chips: [
      { label: "Third-person", target: "third-person", fallback: "Gameplay" },
      { label: "First-person", target: "first-person", fallback: "Gameplay" },
      { label: "Animator", target: "animator", fallback: "Gameplay" },
      { label: "Navigation", target: "navigation", fallback: "Gameplay" },
    ],
  },
  {
    id: "audio",
    title: "Audio",
    packages: "@ignifx/audio",
    body:
      "A mixer, not a play function. Buses are declared in a file; every sound plays on one; volumes " +
      "multiply down the tree.",
    bullets: [
      "`.audio.json` bus tree with per-bus volume and pause behaviour",
      "`AudioSource` for one-shots, loops and spatial playback; `AudioListener`; `MusicPlayer`",
      "Browsers start locked: plays are queued, not lost, until the first gesture",
      "Pauses with the app; a `UI` bus that does not",
      "WAV, MP3, OGG, WebM and FLAC; a headless backend with exact timing for tests",
    ],
    chips: [
      { label: "Audio mixer", target: "audio-mixer", fallback: "Audio" },
      { label: "Positional audio", target: "positional-audio", fallback: "Audio" },
    ],
  },
  {
    id: "ui",
    title: "UI",
    packages: "@ignifx/ui",
    body:
      "Game UI is HTML, placed over the canvas by the engine, with focus routing so a text field never " +
      "steals a jump.",
    bullets: [
      "An overlay root with named layers, `css`, `fit` and `dpi` scaling, safe-area variables",
      "`Menu` and `MenuStack` driven by keyboard, gamepad and pointer through one selection model",
      "`Dialog`, `Toast`, `LoadingScreen`",
      "`HudText`, `WorldText`, `WorldText2D` and `WorldAnchor`",
      "`VirtualJoystick` and `VirtualButton` feeding `@ignifx/input`",
      "`app.i18n` with `.i18n.json`, all locales in one file, ICU-style plurals",
    ],
    chips: [
      { label: "UI overlay", target: "ui-overlay", fallback: "UI" },
      { label: "Menus", target: "menus", fallback: "UI" },
      { label: "Translations", target: "i18n", fallback: "UI" },
    ],
  },
  {
    id: "desktop",
    title: "Desktop",
    packages: "@ignifx/electron",
    body: "Ship the same build to Windows, macOS and Linux inside a hardened Electron window.",
    bullets: [
      "`createGameWindow` with the WebGPU flags already set",
      "The `ignifx://` protocol serving your build with range requests",
      "Context isolation, sandboxed renderers, no Node in the renderer, a strict CSP and a typed, versioned preload bridge",
      "File-system `app.storage` for saves and settings; `app.desktop` for window control",
      "`create-ignifx --desktop` scaffolds the Electron variant of any template with electron-vite and electron-builder configured",
    ],
    chips: [{ label: "Getting started → Desktop", target: "/docs/getting-started/#desktop", fallback: "Platform" }],
  },
  {
    id: "devtools",
    title: "Devtools",
    packages: "@ignifx/devtools",
    body:
      "Press backtick. Stats, the scene tree, a schema-driven inspector, assets, input, audio, physics " +
      "debug, a console and a timeline. Zero cost while closed, and every number comes from " +
      "`app.diagnostics`, which your game can read too.",
    bullets: [],
    chips: [{ label: "Devtools overlay", target: "devtools", fallback: "Platform" }],
  },
  {
    id: "tooling",
    title: "Tooling",
    packages: "@ignifx/vite-plugin and create-ignifx",
    body: "",
    bullets: [
      "A Vite plugin that generates the asset manifest, writes `.meta.json` sidecars, validates scene, prefab, material, input, audio, animator and tilemap JSON against the engine schemas, handles WebAssembly, and wires hot module replacement",
      "Typed `virtual:ignifx/*` modules",
      "`create-ignifx` with four templates and a desktop flag",
      "`check-webgpu` and `new-script` helper scripts in every project",
    ],
    chips: [],
  },
  {
    id: "platform",
    title: "Platform and storage",
    packages: "@ignifx/core",
    body: "",
    bullets: [
      "`app.platform`: where the game runs (browser, Electron, headless), OS, mobile, pointer lock, gamepads, the WebGPU adapter, locale and reduced-motion preference",
      "`app.storage`: an async key-value store with namespaces, backed by IndexedDB in the browser, files in Electron, and memory or files in Node",
      "Save games, settings and input overrides use it; so can you",
    ],
    chips: [{ label: "Save and load", target: "save-load", fallback: "Platform" }],
  },
  {
    id: "headless",
    title: "Headless and testing",
    packages: "",
    body:
      "Create an app with `headless: true`, step it with `app.step(1 / 60)`, and assert. Physics, " +
      "navigation, audio timing and input all run without a GPU or a DOM, which is how the engine's own " +
      "thousand-plus tests run.",
    bullets: [
      "Manual clocks for deterministic tests",
      "Memory log sinks and error capture",
      "Playwright browser suites and visual goldens in the repository as worked examples",
    ],
    chips: [],
  },
];
