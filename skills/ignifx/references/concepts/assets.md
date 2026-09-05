# Assets

The asset system — addresses, handles, reference counting, loaders, and the `asset()` schema field's
runtime behaviour — arrives in Phase 2 alongside rendering (`docs/plan/engineering-plan.md`). The
Phase 1 kernel ships the `asset()` field kind and the `AssetRefValue` shape so component schemas can
already declare asset fields, but nothing loads them yet. This page is filled in when the loader,
the manifest, and the `app.assets` service exist; until then see
`docs/architecture/05-assets-and-loading.md` for the design.
