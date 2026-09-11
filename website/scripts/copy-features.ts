/** Feature summaries for visitors. Exact API contracts live in the reference docs. */
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
    title: "Scenes and scripting",
    packages: "@ignifx/core",
    body: "Organise your game into scenes, objects and components. Write behaviour in TypeScript scripts, with editable fields and callbacks for each stage of a frame.",
    bullets: [
      "Typed script fields that can be saved, loaded and edited in the inspector",
      "A fixed timestep for simulation, with separate callbacks for each rendered frame",
      "Signals for events, coroutines for sequences and tweens for smooth transitions",
      "Pause, resume and slow down the game with the shared game clock",
      "Error codes and logging to help track down problems",
    ],
    chips: [{ label: "Getting started", target: "/docs/getting-started/", fallback: "Basics" }],
  },
  {
    id: "rendering",
    title: "Rendering",
    packages: "@ignifx/core on Babylon Lite",
    body: "Create 3D scenes with cameras, lights and materials. ignifx uses Babylon Lite to render through WebGPU.",
    bullets: [
      "Perspective and orthographic cameras",
      "Physically based and unlit materials, with support for glTF and GLB models",
      "Directional, point, spot and hemispheric lights; shadows from directional and spot lights",
      "Environment lighting, skyboxes, fog and tone mapping",
      "Bloom, anti-aliasing and adjustable render resolution",
      "Object picking, screenshots and rendering statistics",
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
    body: "Load models, textures, sound and scenes by path. Create reusable objects as prefabs, then customise each instance. The Vite plugin checks asset files and reloads them as you work.",
    bullets: [
      "Textures, models, environments, fonts, audio, JSON and text",
      "Preload asset groups, cancel requests and release assets when they are no longer needed",
      "Scenes and prefabs stored as versioned JSON",
      "Prefab overrides preserved when saving and loading",
      "Asset and script hot reload during development",
    ],
    chips: [{ label: "Model loading", target: "model-loading", fallback: "Models" }],
  },
  {
    id: "input",
    title: "Input",
    packages: "@ignifx/input",
    body: "Define actions such as jump or move, then bind them to the devices your players use. Change the controls without rewriting gameplay code.",
    bullets: [
      "Keyboard, mouse, gamepad and touch support",
      "Control schemes and combined inputs, such as movement on two axes",
      "Adjustable dead zones, sensitivity and axis direction",
      "Interactive rebinding with saved player preferences",
      "Pointer lock for mouse-look and virtual controls for touch",
      "Simulated input for automated tests",
    ],
    chips: [
      { label: "Input actions", target: "input-actions", fallback: "Input" },
      { label: "Rebinding", target: "rebinding", fallback: "Input" },
    ],
  },
  {
    id: "physics-3d",
    title: "3D physics",
    packages: "@ignifx/physics",
    body: "Use Havok to make objects fall, collide and respond to forces. Character controllers handle movement along floors and slopes. Physics runs at a fixed timestep and can be tested without a GPU.",
    bullets: [
      "Dynamic, kinematic and static rigid bodies",
      "Box, sphere, capsule, cylinder, mesh and heightfield colliders",
      "Adjustable friction and bounce",
      "A character controller with slope limits and body pushing",
      "Collision and trigger events",
      "Raycasts, shape casts and overlap checks, filtered by layer",
    ],
    chips: [
      { label: "Physics playground", target: "physics-playground", fallback: "Physics" },
      { label: "Character controller", target: "character-controller", fallback: "Physics" },
    ],
  },
  {
    id: "twod",
    title: "2D toolkit",
    packages: "@ignifx/2d",
    body: "Build 2D worlds from sprites and tilemaps. Import art from familiar tools, animate characters and keep pixel art crisp as the camera moves.",
    bullets: [
      "Pixel-perfect cameras with zoom and character following",
      "Sprite animation and texture atlases",
      "Atlas imports from TexturePacker, Aseprite and regular grids",
      "Tilemap imports from Tiled and LDtk",
      "Sorting layers, Y-sorting and parallax backgrounds",
      "Object picking in 2D scenes",
    ],
    chips: [
      { label: "Sprite animation", target: "sprite-animation", fallback: "2D" },
      { label: "Tilemap", target: "tilemap", fallback: "2D" },
    ],
  },
  {
    id: "physics-2d",
    title: "2D physics",
    packages: "@ignifx/physics-2d",
    body: "Build platformers and top-down games with Rapier 2D. The component model follows the same approach as 3D physics.",
    bullets: [
      "Rigid bodies and box, circle, capsule, polygon, edge and tilemap colliders",
      "A character controller for slopes, steps and one-way platforms",
      "Collision events, triggers and layer-based filtering",
      "Physics tests that run in Node without a GPU",
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
    body: "Start with ready-made character controls, cameras, animation and pathfinding. Adapt them to the way your game should feel.",
    bullets: [
      "First- and third-person controls for walking, sprinting, crouching and jumping",
      "A smooth orbit camera that adjusts when walls get in the way",
      "Animation state machines and blend trees for transitions such as idle, walk and run",
      "Navigation meshes and agents for characters that find their way around a level",
      "Helpers for moving platforms, projectiles, billboards and levels of detail",
    ],
    chips: [
      { label: "Third-person", target: "third-person", fallback: "Gameplay" },
      { label: "First-person template", target: "3d-first-person", fallback: "Gameplay" },
      { label: "Animator", target: "animator", fallback: "Gameplay" },
    ],
  },
  {
    id: "audio",
    title: "Audio",
    packages: "@ignifx/audio",
    body: "Mix music, effects and interface sounds with separate volume controls. Place sounds in the world so players can hear where they come from.",
    bullets: [
      "Audio groups with their own volume and pause settings",
      "One-shot effects, looping sounds, positional audio and music playback",
      "Sounds queued until the player interacts, as browsers require",
      "Interface sounds that can keep playing while gameplay is paused",
      "Audio timing tests without speakers or a browser",
    ],
    chips: [{ label: "Audio mixer", target: "audio-mixer", fallback: "Audio" }],
  },
  {
    id: "ui",
    title: "User interface",
    packages: "@ignifx/ui",
    body: "Build your game interface with HTML over the game canvas. Menus work with keyboard, gamepad and pointer input, while typing in a text field keeps those keystrokes out of gameplay.",
    bullets: [
      "Menus and a menu stack for moving between screens",
      "Dialogs, notifications and loading screens",
      "On-screen text and labels that follow objects in the world",
      "Virtual joysticks and buttons for touch screens",
      "Layout scaling and safe-area support",
      "Translations with plural forms",
    ],
    chips: [{ label: "UI overlay", target: "ui-overlay", fallback: "UI" }],
  },
  {
    id: "desktop",
    title: "Desktop",
    packages: "@ignifx/electron",
    body: "Package your game for Windows, macOS and Linux with Electron. Start from a desktop template with the build tools already configured.",
    bullets: [
      "An Electron window configured for WebGPU",
      "Sandboxed rendering and a typed interface to desktop features",
      "File-based saves and settings through the same storage API",
      "Window controls for your game",
      "Add `--desktop` when creating any of the four templates",
    ],
    chips: [{ label: "Desktop setup", target: "/docs/getting-started/#desktop", fallback: "Platform" }],
  },
  {
    id: "devtools",
    title: "Developer tools",
    packages: "@ignifx/devtools",
    body: "Inspect your game while it runs. Press backtick to open the overlay and see objects, component values and performance data.",
    bullets: [
      "A scene tree and editable component inspector",
      "Frame statistics and a timeline",
      "Views for assets, input and audio",
      "Physics debugging and a console",
    ],
    chips: [{ label: "Devtools overlay", target: "devtools", fallback: "Platform" }],
  },
  {
    id: "tooling",
    title: "Tooling",
    packages: "@ignifx/vite-plugin and @ignifx/cli",
    body: "Create a project with the CLI, then use Vite for local development and builds. The plugin handles asset setup and checks your game data.",
    bullets: [
      "Four project templates, each with an optional desktop setup",
      "An automatically generated asset manifest",
      "Validation for scene, prefab, material and other engine JSON files",
      "WebAssembly support and hot reload",
      "Helpers to create scripts and check WebGPU availability",
    ],
    chips: [],
  },
  {
    id: "platform",
    title: "Platform and storage",
    packages: "@ignifx/core",
    body: "Use the same API to save progress and settings in the browser, on desktop and in tests. Check platform capabilities when your game needs to adapt.",
    bullets: [
      "Browser storage through IndexedDB and file storage in Electron",
      "Memory or file storage for Node tests and tools",
      "Information about the operating system, input devices and WebGPU adapter",
      "Access to locale and reduced-motion preferences",
    ],
    chips: [{ label: "Save and load", target: "save-load", fallback: "Platform" }],
  },
  {
    id: "headless",
    title: "Testing in Node",
    packages: "",
    body: "Run gameplay tests in Node without opening a browser or using a GPU. Advance the game a frame at a time to check the result.",
    bullets: [
      "Create a test app with `headless: true` and advance it with `app.step()`",
      "Test physics, navigation, input and audio timing",
      "Control the clock and capture logs and errors",
      "Use the repository’s browser and visual tests as examples",
    ],
    chips: [],
  },
];
