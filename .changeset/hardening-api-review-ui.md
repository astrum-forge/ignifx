---
"@ignifx/ui": minor
---

API review: the overlay's internal plumbing leaves the public barrel

**Breaking.** Six symbols marked `@internal` are no longer exported from `@ignifx/ui` (nor,
therefore, from the `ignifx` umbrella). None was reachable in a way a game could use: `UiHost`,
`I18nService`, `TextRuntime` and `UiSystem` are all built by the `ui()` extension through
constructors that are themselves `@internal`.

- `asDomCanvas`, `resolveDomTarget` — the DOM-target narrowing helpers.
- `UiHostOptions`, `I18nServiceOptions`, `TextRuntimeOptions` — the option bags of those `@internal`
  constructors.
- `TextRuntime` — the Lite text-renderer wrapper the UI system drives.

`UiSystemOptions` is now `@internal` for the same reason: `UiSystem`'s constructor is `@internal`
and the interface carried `TextRuntime` into the public surface. `UiDomTarget` and `UiSystem` stay
`@public`.

**Changed.** `AnchorInput` is `@public`. `computeAnchorPlacement` is `@public` and takes one, which
API Extractor reported as an `ae-incompatible-release-tags` contradiction.
