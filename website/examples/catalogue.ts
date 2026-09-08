// oxlint-disable import/max-dependencies -- one import per gallery category, by design (08-execution.md §5).
/**
 * The examples catalogue: the one manifest the site build, the examples build and the visual suite
 * read (`website/plan/04-examples-platform.md` §2, §7 and §9).
 *
 * Only examples that exist, run and are captured belong here. `status` admits nothing but `"ready"`,
 * so the wishlist rule (`website/plan/07-wishlist.md` §1) is enforced by the type checker rather
 * than remembered, and the site build fails when an entry has no directory, no `main.ts` or no
 * poster. Display order is array order: the gallery, the previous/next links and the sitemap all
 * follow it.
 *
 * Imported by Node at build time (`scripts/site.ts`, `examples/vite.config.ts`, the visual suite),
 * so it and every `entries/*.ts` file must stay free of browser and engine imports.
 */

import { AUDIO } from "./entries/audio.ts";
import { BASICS } from "./entries/basics.ts";
import { GAMEPLAY } from "./entries/gameplay.ts";
import { INPUT } from "./entries/input.ts";
import { LIGHTING } from "./entries/lighting.ts";
import { MODELS } from "./entries/models.ts";
import { PHYSICS_2D } from "./entries/physics-2d.ts";
import { PHYSICS } from "./entries/physics.ts";
import { PLATFORM } from "./entries/platform.ts";
import { POST_PROCESSING } from "./entries/post-processing.ts";
import { RENDERING } from "./entries/rendering.ts";
import { TEMPLATES } from "./entries/templates.ts";
import { TWO_D } from "./entries/two-d.ts";
import { UI } from "./entries/ui.ts";

/** The gallery's filter chips, in display order. "All" is implicit. */
export const CATEGORIES = [
  "Basics",
  "Rendering",
  "Post-processing",
  "Lighting",
  "Models",
  "2D",
  "Physics",
  "Gameplay",
  "Input",
  "Audio",
  "UI",
  "Platform",
  "Templates",
] as const;

/** One of {@link CATEGORIES}. */
export type ExampleCategory = (typeof CATEGORIES)[number];

/** A device an example takes input from; drawn as icons on its card and page. */
export type ExampleControl = "keyboard" | "mouse" | "gamepad" | "touch";

/** One vendored sample asset an example loads (`04-examples-platform.md` §5). */
export interface ExampleAsset {
  /** Display name, e.g. `"Corset"`. */
  readonly name: string;
  /** The licence as `website/examples/assets/ATTRIBUTION.md` records it, e.g. `"CC0 1.0"`. */
  readonly licence: string;
  /** The copyright holder or author, e.g. `"Microsoft"`. */
  readonly author: string;
  /** The upstream URL the asset was downloaded from. */
  readonly source: string;
}

/** One example, as the gallery card, the viewer page and the build read it. */
export interface ExampleEntry {
  /** URL segment: `/examples/<slug>/` is the viewer, `/examples/<slug>/run/` the app. */
  readonly slug: string;
  /** Sentence-case title, e.g. `"Physically based rendering"`. */
  readonly title: string;
  /** The filter chip it sits under. */
  readonly category: ExampleCategory;
  /** Whether the scene is 2D or 3D; shown next to the category on the page. */
  readonly dimension: "2D" | "3D";
  /** Launch priority from the catalogue in `04-examples-platform.md` §7. */
  readonly priority: "P0" | "P1" | "P2";
  /** Always `"ready"`: anything else does not belong in this file (`07-wishlist.md` §1). */
  readonly status: "ready";
  /** One line for the card, under twenty words. */
  readonly line: string;
  /** One paragraph for the page: what you are looking at and what it demonstrates. */
  readonly paragraph: string;
  /** Exactly three "Try" bullets: things to do with the running example. */
  readonly tries: readonly [string, string, string];
  /** Components and APIs the example demonstrates, as written in code, e.g. `"Model"`. */
  readonly uses: readonly string[];
  /** Every sample asset the example loads; empty when everything is generated in code. */
  readonly assets: readonly ExampleAsset[];
  /** Input devices the example responds to; empty when it only animates. */
  readonly controls: readonly ExampleControl[];
  /** Alt text for the poster: what is on screen, as a sentence. */
  readonly posterAlt: string;
  /**
   * Source files shown as tabs in the viewer, `main.ts` first, relative to the example directory
   * (`website/examples/<slug>/`), or to `templates/<name>/` for a template entry.
   */
  readonly sourceFiles: readonly string[];
  /**
   * For the four templates only: the directory name under `templates/`. The run page is the
   * template's own build, not a kit example, and the source pane shows the template's `src/`.
   */
  readonly template?: string;
  /** The recipe name of a guide that covers the same ground, e.g. `"load-a-model"`. */
  readonly guide?: string;
  /** Set when the page should say "This example is deliberately heavy" (`04` §6). */
  readonly heavy?: boolean;
}

/** An {@link ExampleEntry} whose category is fixed by the file it lives in (`entries/*.ts`). */
export type ExampleOf<C extends ExampleCategory> = ExampleEntry & { readonly category: C };

/**
 * Every example on the site, in display order: the categories in {@link CATEGORIES} order, and
 * within a category the order of its `entries/` file.
 *
 * Copy follows `website/plan/04-examples-platform.md` §7 and the tone rules in `01-strategy-and-ia.md`
 * §5: present tense, plain words, `ignifx` lowercase, no hype vocabulary.
 */
export const CATALOGUE: readonly ExampleEntry[] = assertUniqueSlugs([
  ...BASICS,
  ...RENDERING,
  ...POST_PROCESSING,
  ...LIGHTING,
  ...MODELS,
  ...TWO_D,
  ...PHYSICS,
  ...PHYSICS_2D,
  ...GAMEPLAY,
  ...INPUT,
  ...AUDIO,
  ...UI,
  ...PLATFORM,
  ...TEMPLATES,
]);

/**
 * Refuses a catalogue in which two entries share a slug, which would give two examples one URL.
 *
 * @param entries - The concatenated entries.
 * @returns The same array.
 * @throws When a slug appears twice.
 */
function assertUniqueSlugs(entries: readonly ExampleEntry[]): readonly ExampleEntry[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.slug)) {
      throw new Error(`website/examples/catalogue.ts: two examples share the slug "${entry.slug}".`);
    }
    seen.add(entry.slug);
  }
  return entries;
}

/**
 * Finds an entry by slug.
 *
 * @param slug - The example's slug.
 * @returns The entry, or `undefined` when no example has that slug.
 */
export function findExample(slug: string): ExampleEntry | undefined {
  return CATALOGUE.find((entry) => entry.slug === slug);
}
