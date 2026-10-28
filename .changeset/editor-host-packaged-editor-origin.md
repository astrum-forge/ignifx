---
"@ignifx/editor-host": patch
---

The editor host's skill, examples and error hints now name the packaged ignifx editor's origin, `ignifx-editor://app`, instead of a packaged game's `ignifx://app`; a `vite.config.ts` copied from the skill falls back to an origin the editor can frame.
