---
"@ignifx/vite-plugin": minor
---

API review: the manifest version constant and the format-header query match the vocabulary they
share with the runtime

**Breaking.**

- `ASSET_MANIFEST_FORMAT_VERSION` is renamed to `ASSET_MANIFEST_VERSION`. `@ignifx/core` — the other
  end of the same handshake, which reads the `formatVersion` this constant writes — has always
  called it `ASSET_MANIFEST_VERSION`, and the two packages already agree on `ASSET_MANIFEST_FORMAT`,
  `AssetManifest` and `AssetManifestEntry`. The value is still `1`.
- `requiresFormatHeader` is renamed to `isFormatHeaderRequired`. `docs/standards/coding-standards.md`
  §5.1's booleans row requires an `is`/`has`/`can`/`should` **prefix** on a query method; every other
  boolean query in the package already complies (`isJsonArray`, `isJsonObject`, `isSidecarFileName`,
  `isDevServerEntry`).
