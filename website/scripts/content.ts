/**
 * The site's editorial content: the subsystem list, the documentation map, and the browser-support
 * table. Every claim here is traceable to a file in the repository — `AGENTS.md` for what exists,
 * `website/public/llms.txt` for what each package's skill says it does, and the architecture
 * documents for the API names. Nothing describes work that has not landed.
 */

/** One subsystem, as the home grid and `/features/` present it. */
export interface Subsystem {
  /** Section id and anchor. */
  readonly id: string;
  /** Display name. */
  readonly title: string;
  /** The package it lives in, shown in the gutter. */
  readonly pkg: string;
  /** One sentence for the home grid. */
  readonly short: string;
  /** The paragraph shown on `/features/`. */
  readonly body: string;
  /** The public API names a reader would search for. */
  readonly api: readonly string[];
  /** The skill page that documents it. */
  readonly skill: string;
}

/** The eleven subsystems, in the order both pages list them. */
export const SUBSYSTEMS: readonly Subsystem[] = [
  {
    id: "kernel",
    title: "Kernel, scripts and scenes",
    pkg: "@ignifx/core",
    short: "An app, a world, entities, and scripts with schema-declared fields — no decorators.",
    body:
      "`createApp` owns the frame loop and the extension host. A `World` holds `SceneInstance`s, which hold " +
      "`Entity`s, which hold a `Transform` and components; a `Script` is a component with lifecycle callbacks. " +
      "Fields are declared with a schema rather than decorators (ADR-0004), which is what makes a component " +
      "serializable, inspectable in devtools, and patchable on hot reload. Scenes and prefabs are the same " +
      "`ignifx.scene` file (ADR-0005): `world.instantiate` stamps one out, overrides survive a round trip.",
    api: ["createApp", "World", "Entity", "Transform", "Component", "Script.define", "Signal", "serializeScene"],
    skill: "/skill/references/concepts/scripting",
  },
  {
    id: "rendering",
    title: "Rendering on Babylon Lite",
    pkg: "@ignifx/core",
    short: "WebGPU only, through a pinned Babylon Lite. No WebGL fallback, by decision.",
    body:
      "ignifx does not rasterise anything: Babylon Lite does, exclusively through WebGPU (ADR-0001). The engine " +
      "owns the loop and hands Lite a scene. `Camera`, `Light`, `MeshRenderer`, `Model`, `Environment` and " +
      "`PostProcessStack` are ignifx components; Lite objects stay behind the adapter boundary and are reachable " +
      "only through documented `.lite` escape hatches (ADR-0002). Device loss is recovered at both layers, and " +
      "material families can be warmed up before a scene is registered (ADR-0014).",
    api: ["Camera", "Light", "MeshRenderer", "Model", "Environment", "PostProcessStack", "app.renderer.warmUp"],
    skill: "/skill/references/concepts/rendering",
  },
  {
    id: "assets",
    title: "Assets",
    pkg: "@ignifx/core",
    short: "Addressed, typed, reference-counted, asynchronous — and delivered at one point in the frame.",
    body:
      "Everything a game loads is reached by address through `app.assets` and comes back as an `AssetHandle<T>` " +
      "you release when you are done. Loads are cancellable (`IGX-0502`), reference counts unload at zero after a " +
      "`gcDelay`, and a hot swap replaces an asset in place. Delivery has one rule worth memorising: before " +
      "`app.start()` a finished load settles immediately; once the loop is running it settles in `PreUpdate`.",
    api: ["app.assets.loadAsync", "AssetHandle", "MeshAsset", "SceneAsset", "ModelAsset"],
    skill: "/skill/references/concepts/assets",
  },
  {
    id: "input",
    title: "Input",
    pkg: "@ignifx/input",
    short: "Devices become actions; actions come from a file, not from `keydown`.",
    body:
      "`@ignifx/input` turns keyboard, mouse, gamepad and touch into named **actions**. Action maps, bindings, " +
      "composites and processors, and control schemes live in an `.input.json` document, so rebinding is data and " +
      "not a code change. Pointer lock, the cursor, and `PlayerInput` are part of the same surface. Positions are " +
      "reported in backing-store pixels, which is the space `Camera.screenToRay` reads.",
    api: ["input()", "app.input.actions", "defineInputActions", "PlayerInput", "<Pointer>/position"],
    skill: "/skill/input/",
  },
  {
    id: "physics-3d",
    title: "3D physics",
    pkg: "@ignifx/physics",
    short: "Havok through Babylon Lite: bodies, colliders, triggers, a character controller, queries.",
    body:
      "Rigid bodies, the collider set, triggers, a kinematic `CharacterController`, raycasts and shape queries, a " +
      "layer matrix, and interpolation between fixed steps. Physics runs inside `FixedUpdate`, so a query answers " +
      "only after one completed fixed step (`IGX-0902`). Collision identity has a documented waiver until Lite " +
      "reports body identities upstream (ADR-0013).",
    api: ["physics()", "Rigidbody", "BoxCollider", "CharacterController", "app.physics.raycast"],
    skill: "/skill/physics/",
  },
  {
    id: "twod",
    title: "2D toolkit and 2D physics",
    pkg: "@ignifx/2d · @ignifx/physics-2d",
    short: "Sprites, atlases, tilemaps and sorting layers; Rapier for the bodies.",
    body:
      "`@ignifx/2d` draws sprites: `SpriteRenderer` and `SpriteAnimator`, atlases, `Tilemap`, sorting layers, " +
      "pixel-perfect rendering, parallax, and 2D picking, all under a `Camera2D` with pixels per unit. " +
      "`@ignifx/physics-2d` simulates them with Rapier 2D (ADR-0006): `Rigidbody2D`, the 2D colliders, triggers, " +
      "`CharacterController2D`, one-way platforms, queries and the same layer matrix.",
    api: ["twoD()", "physics2d()", "Camera2D", "SpriteRenderer", "Tilemap", "Rigidbody2D", "CharacterController2D"],
    skill: "/skill/2d/",
  },
  {
    id: "audio",
    title: "Audio",
    pkg: "@ignifx/audio",
    short: "A mixer tree, positional sources, and a browser that starts locked.",
    body:
      "`app.audio` is a mixer tree described by an `audiobuses` document, with `AudioSource`, `AudioListener` and " +
      "`MusicPlayer` on top of it and two backends underneath. Browsers start audio locked until a user gesture: " +
      "plays made before then are queued rather than lost, and a headless app is never locked.",
    api: ["audio()", "app.audio.unlock", "AudioSource", "AudioListener", "MusicPlayer"],
    skill: "/skill/audio/",
  },
  {
    id: "threed",
    title: "3D toolkit",
    pkg: "@ignifx/3d",
    short: "Character and camera rigs, an animation state machine, navigation.",
    body:
      "The layer that turns core plus physics plus input into a 3D game: character and camera rigs that do not " +
      "clip through walls, an `Animator` state machine driving a rigged model, navigation baked from level " +
      "geometry, and the environment helpers. Navigation is WebAssembly (ADR-0017) and is loaded only when a " +
      "navmesh is actually baked.",
    api: ["threeD()", "ThirdPersonController", "ThirdPersonCamera", "Animator", "NavMeshSurface"],
    skill: "/skill/3d/",
  },
  {
    id: "ui",
    title: "UI",
    pkg: "@ignifx/ui",
    short: "Game UI is HTML: one overlay over the canvas, and your framework inside it.",
    body:
      "`@ignifx/ui` puts one absolutely positioned overlay over the canvas and lets a game mount React, Svelte, " +
      "Vue or plain DOM into named layers inside it (ADR-0008). It owns three scaling modes, input focus routing " +
      "between the page and the game, `WorldAnchor` for markers that track an entity, text components on Lite's " +
      "text renderer, touch and dialog helpers, and `app.i18n`.",
    api: ["ui()", "app.ui.layer", "WorldAnchor", "Dialog", "VirtualJoystick", "app.i18n"],
    skill: "/skill/ui/",
  },
  {
    id: "electron",
    title: "Electron",
    pkg: "@ignifx/electron",
    short: "The same renderer bundle, in a window, with a sandboxed bridge and a file system.",
    body:
      "The desktop half: `createGameWindow` in the main process, a sandboxed CommonJS preload bridge, an " +
      "`ignifx://app` protocol that serves the asset manifest with `Range` support, and a renderer `electron()` " +
      "extension that switches `app.platform.kind` and swaps storage for a file-system backend. The security " +
      "baseline of `CONSTITUTION.md` §9.2 is asserted twice — from the pure option builders and inside a running " +
      "Electron app.",
    api: ["electron()", "createGameWindow", "app.desktop", "app.storage"],
    skill: "/skill/electron/",
  },
  {
    id: "devtools",
    title: "Devtools and hot reload",
    pkg: "@ignifx/devtools",
    short: "Nine panels behind a backtick, and scripts that reload without losing state.",
    body:
      "`app.devtools` opens an overlay with stats, a virtualised scene tree, a schema-driven inspector where every " +
      "field kind is editable, assets, input, audio, physics with Lite's debug viewer, a console, and a per-phase " +
      "timing graph. Closed, it registers no systems and no subscriptions. `app.hotReload` patches a script's " +
      "prototype in place, or recreates the instance with its props when the schema shape changed.",
    api: ["devtools()", "app.devtools.open", "app.hotReload.apply", "onHotReload"],
    skill: "/skill/devtools/",
  },
];

/** One row of the documentation map on `/docs/`. */
export interface DocLink {
  /** Display label. */
  readonly label: string;
  /** Destination — a site route or a GitHub URL. */
  readonly href: string;
  /** One line of what it is for. */
  readonly note: string;
}

/** The repository documents `/docs/` points at, grouped. */
export interface DocGroup {
  /** Group heading. */
  readonly title: string;
  /** The gutter identifier. */
  readonly gutter: string;
  /** What the group is for. */
  readonly lead: string;
  /** The rows. */
  readonly links: readonly DocLink[];
}
