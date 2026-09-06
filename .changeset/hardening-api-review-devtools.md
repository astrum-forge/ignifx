---
"@ignifx/devtools": minor
---

API review: the overlay's internal plumbing leaves the public barrel

**Breaking.** Three symbols marked `@internal` are no longer exported from `@ignifx/devtools`:
`asDomCanvas`, `resolveDevtoolsTarget` and `DevtoolsServiceOptions`. Nothing outside the package
used them, and the `ignifx` umbrella had to drop `asDomCanvas` by hand because `@ignifx/ui` exported
a byte-identical copy of the same `@internal` helper. `DevtoolsDomTarget` stays `@public`.
