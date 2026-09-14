---
"@ignifx/vite-plugin": minor
---

- List every `.wgsl` file under the asset root in the manifest as a `shader` asset, and `.particles.json`, `.terrain.json` and `.r16` files as `particles`, `terrain` and `heightmap` assets.
- Validate shaders at build time and in the dev server: WGSL syntax errors report `IGX-0654` with the parser's line, and contract errors report `IGX-0655` (missing or repeated `// @ignifx` form line, an undeclared `shaderUniforms`, `shaderSystem`, `surfaceUniforms` or texture, a missing entry point, a hand-written `@group`/`@binding`, or `textureSample` reachable from a vertex stage). Set `validate: false` to turn the checks off.
- Editing a `.wgsl` file announces `ignifx:asset-changed`, which the engine's shader hot reload listens for.
