import { describeSchema } from "@ignifx/core";
import { describeAudioBusesFormat } from "./assets/bus-file.js";
import { AudioListener } from "./components/audio-listener.js";
import { AudioSource } from "./components/audio-source.js";
import { MusicPlayer } from "./components/music-player.js";
import type { SchemaDescription } from "@ignifx/core";

/**
 * The documentation harness's view of everything `@ignifx/audio` declares
 * (`docs/architecture/16-docs-harness-and-skill.md` §3, `scripts/README.md`).
 *
 * `pnpm docs:schemas` imports the built entry point, calls {@link describeSchemas}, and renders
 * `skills/ignifx/references/formats/<format>.md` plus `ignifx.schemas.json` from the result. The
 * **function** form is what a package exports rather than a `schemas` object: building the record
 * means calling `describeSchema` for every component, and module scope holds declarations only
 * (`CONSTITUTION.md` §3.5).
 *
 * The bus file is keyed `ignifx/audiobuses-file` rather than `ignifx.audiobuses`: the harness
 * rejects a key with no `/` (`scripts/lib/schema-source.ts`), and it is the entry's `format` — not
 * its key — that decides which page it lands on. `@ignifx/core` keys its three file formats the
 * same way.
 */

/**
 * Describes every component and file format this package declares, for the documentation harness.
 *
 * @returns The records, keyed by namespaced type id.
 *
 * @example
 * ```ts
 * describeSchemas()["ignifx/AudioSource"].fields["maxInstances"].default; // 8
 * ```
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return {
    "ignifx/AudioSource": describeSchema("ignifx/AudioSource", AudioSource.schema, {
      description:
        "A sound attached to an entity: which clip, which bus, how loud, how many at once, and how it behaves in 3D.",
    }),
    "ignifx/AudioListener": describeSchema("ignifx/AudioListener", AudioListener.schema, {
      description: "The ears spatial audio is heard from; usually on the main camera entity.",
    }),
    "ignifx/MusicPlayer": describeSchema("ignifx/MusicPlayer", MusicPlayer.schema, {
      description: "A playlist of music tracks with crossfading, routed to the Music bus.",
    }),
    "ignifx/audiobuses-file": describeAudioBusesFormat(),
  };
}
