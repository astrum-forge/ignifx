# ADR-0036 · Canonical scene text that formatters and releases leave alone

**Status:** Proposed · **Date:** 2026-10-20 · **Deciders:** Astrum Forge Studios (owner)

This ADR covers two gaps from engine PR #46, gap 12 (output style) and gap 13 (`engineVersion`), because both decide the bytes `serializeScene` and `stringifySceneFile` write, and accepting either rewrites every saved scene once. Doing them together costs one rewrite instead of two.

## Context

- **Style (gap 12).** `stringifySceneFile` is `JSON.stringify(file, null, 2)` (`packages/core/src/serialization/scene-file.ts`): one value per line, so a `vec3` takes five lines; every schema prop is written, defaults included; there is no final newline. `templates/3d-third-person/assets/scenes/main.scene.json` is 3,204 lines for 49 entities. oxfmt and `.editorconfig` would rewrite it, so the repository exempts `templates/*/assets/scenes/*.scene.json` in `.oxfmtignore`, `.lintstagedrc.mjs` and `.editorconfig`. A scaffolded project has no such exemptions: its formatter rewrites the file, and the next save rewrites it back.
- **Version (gap 13).** `serializeScene` writes core's `VERSION` as `engineVersion` unless told otherwise (`serialize.ts`). That is `"0.0.0"` in unreleased builds, and it changes a line of every saved file at every release. Nothing reads it on load. The templates, their tests and the editor host (`packages/editor-host/src/scene/document.ts`) all pass `engineVersion: null`.

Constraints: byte-stable saves (`06-serialization-and-scene-format.md` §1), short reviewable diffs, and format changes ship in a minor release before 1.0 (`CONSTITUTION.md` §4.2).

## Options considered

1. **Formatter-friendly text, no version by default.** A final newline; arrays of numbers or strings (vectors, quaternions, colours, layer lists) on one line; everything else as today; `engineVersion` written only when the caller passes it. Every prop is still written. Rewriting the four template scenes this way with a script gives text that `oxfmt --check` accepts both at its defaults and with the repository's `.oxfmtrc.json` (checked 2026-10-20).
2. **Option 1, and omit props equal to their schema default.** Files shrink further, and adding a field to a schema no longer changes every file on its next save. But changing a default then silently changes every level that relied on it. The editor's document model (`ignifx-editor` `packages/editor-core/src/canonical.ts`) keeps props verbatim because it has no schemas, so it would need them to stay canonical.
3. **Keep the text and ship the exemptions.** The scaffolder writes `.oxfmtignore`, `.prettierignore` and `.editorconfig` entries into new projects, and `engineVersion` stays on by default. No file churn, but every project carries ignore rules, every release still touches every scene, and diffs stay long.

## Decision

Recommended: option 1. Scene files end with a newline, keep arrays of numbers and strings on one line, and carry `engineVersion` only on request. Omitting defaults (option 2) is not part of this decision.

## Consequences

- Each template scene shrinks by about 30% (`3d-third-person`: 3,204 to 2,273 lines), and a diff that moves an entity is one line per vector, not five.
- Every scene file in the repository is rewritten once, in the same pull request as the change. The four template round-trip tests prove the new text is stable.
- A scalar array too long for one line (rare in scenes) keeps one value per line, which a formatter may refill differently; the oxfmt test below catches that.
- `engineVersion: null` disappears from tests, templates and the editor host; the field stays readable for files that have it.
- Editor: `editor-core` re-implements the writer (`ignifx-editor` `packages/editor-core/src/serialize.ts`, byte-identical by test against the pinned engine), so it changes in the editor release that adopts the engine version. Files written in the old style still load; the first save converts them.
- If accepted: `stringifySceneFile` becomes a small writer with these rules, plus a test that oxfmt leaves the four template scenes unchanged; once it passes, the three repository exemptions go. The `serializeScene` default for `engineVersion` changes. Doc 06 §1, §2 and §5, the skill's `references/formats/scene.md`, the API report (TSDoc), and a minor changeset with a **Breaking** note for the changed text.
