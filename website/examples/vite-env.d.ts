/// <reference types="vite/client" />
/// <reference types="@ignifx/vite-plugin/client" />

// The ambient environment the examples build runs in: Vite's `import.meta.env` and the two
// `virtual:ignifx/*` modules `@ignifx/vite-plugin` serves. `website/tsconfig.json` includes this
// directory, so one reference here types every example.
//
// The site shell does not need either declaration — it renders DOM and reads no manifest — which
// is why the reference lives here rather than in `website/src/`.
