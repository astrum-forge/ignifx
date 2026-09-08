/**
 * The site's copy, pasted from `website/plan/03-pages-and-copy.md` and `05-press-kit.md` §2.
 *
 * Nothing in this file is rewritten by the build: a page reads a table here and lays it out. Two
 * conventions come from the plan and are load-bearing — `ignifx` is lowercase everywhere
 * (`CONSTITUTION.md` §1.5), and every string is in the inline Markdown subset {@link md} renders,
 * so the copy stays byte-comparable with the plan document.
 */
import type { IconName } from "./icons.ts";
import type { ExampleCategory } from "../examples/catalogue.ts";

/** One of the five messaging pillars (`03` §2, "Why ignifx"). */
export interface Pillar {
  /** The icon that heads the card. */
  readonly icon: IconName;
  /** The heading. */
  readonly title: string;
  /** One paragraph. */
  readonly body: string;
}

/** The five pillars, in display order. */
export const PILLARS: readonly Pillar[] = [
  {
    icon: "code",
    title: "Code first",
    body:
      "Your game is TypeScript, not a project file. Entities, components and scripts with typed, " +
      "schema-declared fields. One obvious way to do each thing, and no decorators, globals or magic.",
  },
  {
    icon: "play",
    title: "WebGPU only, by design",
    body:
      "ignifx renders through Babylon Lite on WebGPU alone. One render path means PBR materials, " +
      "image-based lighting, shadows and post-processing that behave the same everywhere WebGPU runs, " +
      "and nothing to test twice.",
  },
  {
    icon: "gamepad",
    title: "Batteries included",
    body:
      "3D physics on Havok. 2D physics on Rapier. Spatial audio with a real mixer. Action-based input " +
      "with rebinding. A DOM UI layer. Animation state machines, navigation meshes, sprites and " +
      "tilemaps. Each one is a line in `createApp`.",
  },
  {
    icon: "fullscreen",
    title: "Browser, desktop and headless",
    body:
      "The same game runs in a browser tab, in a hardened Electron window, and headlessly in Node for " +
      "your tests and tools. Saves, settings and rebinds persist on all three.",
  },
  {
    icon: "github",
    title: "Open source, from a studio that ships with it",
    body: "Apache-2.0, developed in the open, and used by Astrum Forge Studios for its own games and projects.",
  },
];

/** One of the twelve subsystem cards on the home page (`03` §2, "Features grid"). */
export interface FeatureCard {
  /** The package chip. */
  readonly chip: string;
  /** The heading. */
  readonly title: string;
  /** One line. */
  readonly line: string;
  /** A catalogue slug, or a site route when the copy points at a page. */
  readonly seeIt: string;
  /** The category section the "See it" link falls back to while the slug is unbuilt. */
  readonly fallback: ExampleCategory;
}

/** The twelve cards, in display order. */
export const FEATURE_CARDS: readonly FeatureCard[] = [
  {
    chip: "@ignifx/core",
    title: "Rendering",
    line: "PBR materials, image-based lighting, shadows, bloom and SMAA through Babylon Lite.",
    seeIt: "pbr-model",
    fallback: "Rendering",
  },
  {
    chip: "@ignifx/core",
    title: "Scenes and prefabs",
    line: "One JSON format for scenes and prefabs; instances keep their overrides.",
    seeIt: "scenes-and-prefabs",
    fallback: "Gameplay",
  },
  {
    chip: "@ignifx/core",
    title: "Assets",
    line: "Addressed, typed, reference-counted, cancellable, and hot-swappable in development.",
    seeIt: "model-loading",
    fallback: "Models",
  },
  {
    chip: "@ignifx/physics",
    title: "3D physics",
    line: "Rigid bodies, colliders, triggers, a character controller and queries, on Havok.",
    seeIt: "physics-playground",
    fallback: "Physics",
  },
  {
    chip: "@ignifx/physics-2d",
    title: "2D physics",
    line: "Bodies, colliders, one-way platforms and a platformer controller, on Rapier.",
    seeIt: "physics-2d",
    fallback: "Physics",
  },
  {
    chip: "@ignifx/2d",
    title: "Sprites and tilemaps",
    line: "Atlases from TexturePacker and Aseprite, tilemaps from Tiled and LDtk, pixel-perfect.",
    seeIt: "tilemap",
    fallback: "2D",
  },
  {
    chip: "@ignifx/3d",
    title: "Characters and cameras",
    line: "Third- and first-person rigs, an orbit camera that stays out of walls.",
    seeIt: "third-person",
    fallback: "Gameplay",
  },
  {
    chip: "@ignifx/3d",
    title: "Animation and navigation",
    line: "State machines with blend trees on glTF skeletons; navmesh agents on Recast.",
    seeIt: "animator",
    fallback: "Gameplay",
  },
  {
    chip: "@ignifx/input",
    title: "Input",
    line: "Keyboard, mouse, gamepad and touch become named actions you can rebind at runtime.",
    seeIt: "input-actions",
    fallback: "Input",
  },
  {
    chip: "@ignifx/audio",
    title: "Audio",
    line: "A bus tree, positional one-shots, music, and browsers that start locked, handled.",
    seeIt: "audio-mixer",
    fallback: "Audio",
  },
  {
    chip: "@ignifx/ui",
    title: "UI",
    line: "Menus, dialogs, toasts, HUD and world-space text, virtual gamepad, translations.",
    seeIt: "ui-overlay",
    fallback: "UI",
  },
  {
    chip: "@ignifx/electron",
    title: "Desktop",
    line: "A hardened Electron window, a typed bridge, and file-system saves. One flag to build.",
    seeIt: "/docs/getting-started/#desktop",
    fallback: "Platform",
  },
];

/** One of the four templates (`03` §2, "Templates"). */
export interface TemplateCard {
  /** The directory name under `templates/`, which is also its catalogue slug. */
  readonly name: string;
  /** The display title. */
  readonly title: string;
  /** One line. */
  readonly line: string;
}

/** The four templates, in display order. */
export const TEMPLATE_CARDS: readonly TemplateCard[] = [
  {
    name: "2d-topdown",
    title: "2D top-down",
    line: "A tilemap with collision, Y-sorted props, a dead-zoned camera and shrines to light.",
  },
  {
    name: "2d-sidescroller",
    title: "2D side-scroller",
    line: "Parallax bands, slopes and one-way platforms, coins, and a pixel-perfect camera.",
  },
  {
    name: "3d-third-person",
    title: "3D third-person",
    line: "A character on a capsule, an orbit camera that avoids walls, an animated rig, a companion.",
  },
  {
    name: "3d-first-person",
    title: "3D first-person",
    line: "Walk, sprint, crouch and jump with pointer lock, a view model, and things to push.",
  },
];

/**
 * The six examples the home page teases (`03` §2, "Examples teaser"). Slugs that are not in the
 * catalogue yet are dropped and the row is topped up from the catalogue in order, so the section
 * shows real, playable cards from the first wave onwards.
 */
export const HOME_EXAMPLE_SLUGS: readonly string[] = [
  "pbr-model",
  "shadows",
  "bloom",
  "tilemap",
  "physics-playground",
  "third-person",
];

/** The three bullets beside the home page's code block (`03` §2, "The code"). */
export const CODE_BULLETS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: "Typed fields, no decorators.",
    body: "`Script.define({ speed: f32(90) })` is a serialisable, inspectable field.",
  },
  {
    title: "One frame, six phases.",
    body: "A fixed step for simulation, `update` for the rest, and every callback in a documented order.",
  },
  {
    title: "Extensions in one line.",
    body: "`createApp({ extensions: [input(), physics(), audio()] })`.",
  },
];

/** One row of the browser-support table (`03` §7, Android row worded as `08` §1). */
export const BROWSER_SUPPORT: readonly (readonly [string, string])[] = [
  ["Chrome, Edge (desktop)", "113"],
  ["Chrome (Android)", "121, Android 12 and later on Qualcomm and ARM GPUs"],
  ["Safari (macOS, iOS, iPadOS)", "26"],
  ["Firefox (Windows)", "141"],
  ["Firefox (macOS, Apple Silicon)", "145"],
  ["Electron", "Any current release; `@ignifx/electron` sets the flag"],
];

/** The support line under the hero buttons and in the install block (`03` §2). */
export const SUPPORT_LINE =
  "Runs wherever WebGPU does: Chrome and Edge 113+, Safari 26+, Firefox 141+ on Windows and 145+ on Apple Silicon. Desktop through Electron.";

/** One card on the docs hub (`03` §5). */
export interface DocsCard {
  /** The heading. */
  readonly title: string;
  /** One line. */
  readonly line: string;
  /** Destination. */
  readonly href: string;
  /** Whether the destination leaves the site. */
  readonly external?: boolean;
}

/** The three boilerplate paragraphs on the press page (`05-press-kit.md` §2). */
export const BOILERPLATE: readonly { readonly label: string; readonly text: string }[] = [
  {
    label: "Short (25 words)",
    text:
      "ignifx is an open-source TypeScript game engine built on WebGPU, for 2D and 3D games that run " +
      "in the browser and on the desktop.",
  },
  {
    label: "Medium (60 words)",
    text:
      "ignifx is an open-source TypeScript game engine built on WebGPU. Developers write their game as " +
      "code, with entities, components and scripts, and ship it to any modern browser or, through " +
      "Electron, to Windows, macOS and Linux. Physics, audio, input, UI, animation and navigation are " +
      "included. ignifx is developed by Astrum Forge Studios and released under the Apache-2.0 licence.",
  },
  {
    label: "Long (120 words)",
    text:
      "ignifx is an open-source game engine for the modern web. It is written in TypeScript and renders " +
      "exclusively through WebGPU, using Babylon Lite as its rasteriser, which gives every game one " +
      "render path with physically based materials, image-based lighting, shadows and post-processing. " +
      "Developers write their game as code: entities, components and scripts with typed, " +
      "schema-declared fields, and one obvious way to do each thing. The engine ships with 3D physics " +
      "on Havok, 2D physics on Rapier, spatial audio with a bus mixer, action-based input with runtime " +
      "rebinding, a DOM UI layer, animation state machines, navigation meshes, sprites and tilemaps, " +
      "and a devtools overlay. The same game runs in a browser tab, in a hardened Electron window, and " +
      "headlessly in Node for testing. ignifx is developed by Astrum Forge Studios, an independent " +
      "game studio, and is released under the Apache-2.0 licence.",
  },
];

/** The press page's "Do" and "Do not" lists (`05` §2, "Usage"). */
export const USAGE_DO: readonly string[] = [
  "Use the badges to show your game or project runs on ignifx.",
  "Use the mark or lockup when writing about ignifx, in a talk, or in a list of engines.",
  "Use the light lockup on dark grounds and the dark lockup on light grounds.",
  "Keep the clear space: at least the height of the mark on every side.",
];

/** The press page's "Do not" list. */
export const USAGE_DONT: readonly string[] = [
  "Change the colours, add effects, rotate, stretch, outline or recolour the mark.",
  "Use the mark or name as part of your own product's name or logo, or in a way that suggests Astrum Forge Studios made or endorses your product.",
  "Capitalise it: it is `ignifx`, not “Ignifx” or “IgniFX”.",
  "Set the wordmark in another typeface.",
];

/** The five brand colours the press page swatches (`05` §2, "Colours"). */
export const BRAND_COLOURS: readonly { readonly name: string; readonly hex: string; readonly note: string }[] = [
  { name: "Flame (light)", hex: "#A63D07", note: "Accent on light grounds" },
  { name: "Flame (dark)", hex: "#FF9E4A", note: "Accent on dark grounds" },
  { name: "Ink", hex: "#14181F", note: "Text" },
  { name: "Paper", hex: "#FAFBFC", note: "Light ground" },
  { name: "Dark ground", hex: "#0D1015", note: "Dark ground" },
];
