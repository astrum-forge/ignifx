/** Shared visitor-facing copy. Page renderers own their headings and introductions. */
import type { IconName } from "./icons.ts";
import type { ExampleCategory } from "../examples/catalogue.ts";

/** One reason to choose ignifx. */
export interface Pillar {
  /** The icon that heads the card. */
  readonly icon: IconName;
  /** The heading. */
  readonly title: string;
  /** One paragraph. */
  readonly body: string;
}

/** The three reasons, in display order. */
export const PILLARS: readonly Pillar[] = [
  {
    icon: "code",
    title: "Work in TypeScript",
    body: "Build scenes and write gameplay in your code editor. Typed components and scripts help you find mistakes as you work.",
  },
  {
    icon: "gamepad",
    title: "Start with the essentials",
    body: "Physics, controls, audio, menus and animation are ready to use. Add the extensions your game needs.",
  },
  {
    icon: "fullscreen",
    title: "Take your game further",
    body: "Run your game in a WebGPU browser or package it for desktop with Electron. Test gameplay in Node without opening a window.",
  },
];

/** One feature highlighted on the home page. */
export interface FeatureCard {
  /** The heading. */
  readonly title: string;
  /** One line. */
  readonly line: string;
  /** A catalogue slug, or a site route when the copy points at a page. */
  readonly seeIt: string;
  /** The category section the "See it" link falls back to while the slug is unbuilt. */
  readonly fallback: ExampleCategory;
}

/** The six highlights, in display order. */
export const FEATURE_CARDS: readonly FeatureCard[] = [
  {
    title: "Light your worlds",
    line: "Give 3D scenes realistic materials, reflections, shadows and a finishing touch of bloom.",
    seeIt: "pbr-model",
    fallback: "Rendering",
  },
  {
    title: "Build in 2D",
    line: "Bring sprites and tilemaps to life with animation, layered backgrounds and pixel-perfect cameras.",
    seeIt: "tilemap",
    fallback: "2D",
  },
  {
    title: "Put physics to work",
    line: "Add collisions, moving bodies and character controllers with Havok for 3D and Rapier for 2D.",
    seeIt: "physics-playground",
    fallback: "Physics",
  },
  {
    title: "Let players choose their controls",
    line: "Support keyboard, mouse, gamepad and touch, with controls players can rebind.",
    seeIt: "input-actions",
    fallback: "Input",
  },
  {
    title: "Shape the sound",
    line: "Play music and positional sound effects. Give players separate volume controls for each.",
    seeIt: "audio-mixer",
    fallback: "Audio",
  },
  {
    title: "Make room for menus",
    line: "Build menus, health displays and dialogs with HTML, plus touch controls and translations.",
    seeIt: "ui-overlay",
    fallback: "UI",
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
    line: "Explore a pixel-art courtyard, light shrines and save your progress.",
  },
  {
    name: "2d-sidescroller",
    title: "2D side-scroller",
    line: "Run, jump and collect coins across a scrolling pixel-art level.",
  },
  {
    name: "3d-third-person",
    title: "3D third-person",
    line: "Explore with an animated character, a following camera and an AI companion.",
  },
  {
    name: "3d-first-person",
    title: "3D first-person",
    line: "Explore in first person, push crates and interact with objects.",
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
    title: "Declare editable fields.",
    body: "Set values such as speed in your script and adjust them in the inspector.",
  },
  {
    title: "Choose when your code runs.",
    body: "Use `fixedUpdate` for physics and `update` for changes each frame.",
  },
  {
    title: "Add features as you need them.",
    body: "Register input, physics or audio when you create your app.",
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
export const SUPPORT_LINE = "Requires a browser with WebGPU. Desktop builds use Electron.";

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
    label: "Short description",
    text: "ignifx is an open-source TypeScript engine for 2D and 3D games. Build for WebGPU browsers and desktop with playable templates and tools for everyday game development.",
  },
  {
    label: "Overview",
    text: "ignifx is an open-source game engine for developers who want to build in TypeScript. It supports 2D and 3D games in WebGPU browsers, with desktop packaging through Electron. Physics, input, audio, menus and animation are available as extensions. Four playable templates provide a starting point. ignifx is developed by Astrum Forge Studios and released under Apache-2.0.",
  },
  {
    label: "Detailed description",
    text: "ignifx is an open-source TypeScript game engine developed by Astrum Forge Studios. Developers build scenes and gameplay in code, using typed components and scripts. The engine supports 2D and 3D games, with WebGPU rendering through Babylon Lite and desktop packaging through Electron. Extensions provide physics, keyboard and gamepad input, touch controls, audio, menus, animation and navigation. Sprite and tilemap tools support 2D games. Four playable templates include menus, settings and saves, so developers can begin with a working game. Interactive examples show individual features alongside their source code. Gameplay tests can run in Node without a browser or GPU. ignifx is released under Apache-2.0.",
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
