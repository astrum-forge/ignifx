import { describeSchema } from "@ignifx/core";
import { describeLocaleFileFormat } from "./i18n/locale-file.js";
import { HudText } from "./text/hud-text.js";
import { WorldText2D } from "./text/world-text-2d.js";
import { WorldText } from "./text/world-text.js";
import { WorldAnchor } from "./world/world-anchor.js";
import type { SchemaDescription } from "@ignifx/core";

/**
 * The documentation harness's view of everything `@ignifx/ui` declares
 * (`docs/architecture/16-docs-harness-and-skill.md` §3, `scripts/README.md`).
 *
 * `pnpm docs:schemas` imports the built entry point, calls {@link describeSchemas}, and renders
 * `skills/ignifx/references/formats/<format>.md` plus `ignifx.schemas.json` from the result. The
 * **function** form is what a package exports rather than a `schemas` object: building the record
 * means calling `describeSchema` for every component, and module scope holds declarations only
 * (`CONSTITUTION.md` §3.5).
 *
 * The translation document is keyed `ignifx/i18n-file` rather than `ignifx.i18n`: the harness
 * rejects a key with no `/` (`scripts/lib/schema-source.ts`), and it is the entry's `format` — not
 * its key — that decides which page it lands on. `@ignifx/core` and `@ignifx/audio` key their file
 * formats the same way.
 */

/**
 * Describes every component and file format this package declares, for the documentation harness.
 *
 * @returns The records, keyed by namespaced type id.
 *
 * @example
 * ```ts
 * describeSchemas()["ignifx/HudText"].fields["fontSize"].default; // 32
 * ```
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return {
    "ignifx/WorldAnchor": describeSchema("ignifx/WorldAnchor", WorldAnchor.schema, {
      description: "Keeps a DOM element at an entity's screen position, with clamping and distance scaling.",
    }),
    "ignifx/HudText": describeSchema("ignifx/HudText", HudText.schema, {
      description: "Pixel-space text drawn by Babylon Lite, anchored to a corner of the render target.",
    }),
    "ignifx/WorldText": describeSchema("ignifx/WorldText", WorldText.schema, {
      description: "3D text in the render scene: signs and banners, optionally billboarded.",
    }),
    "ignifx/WorldText2D": describeSchema("ignifx/WorldText2D", WorldText2D.schema, {
      description: "Pixel-space text placed at an entity's projected position: damage numbers and name tags.",
    }),
    "ignifx/i18n-file": describeLocaleFileFormat(),
  };
}
