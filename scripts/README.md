# Repository scripts

Node-only tooling for the documentation harness (`docs/architecture/16-docs-harness-and-skill.md`).
Every script is plain TypeScript run by Node ≥ 24 through type stripping — no build step and no
dependencies beyond the Node standard library — which means **erasable syntax only** and
**relative imports must carry the `.ts` extension**. `tsconfig.tools.json` type-checks them for
`pnpm typecheck`; `scripts/tsconfig.json` gives the type-aware linters a real program to use.

| Script            | npm script          | What it does                                                                                                                  |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `docs-schemas.ts` | `pnpm docs:schemas` | Regenerates `skills/ignifx/references/formats/*.md` and `ignifx.schemas.json` from the component schemas the packages export. |
| `docs-recipes.ts` | `pnpm docs:recipes` | Regenerates `skills/ignifx/references/recipes/<name>.md` from `examples/recipes/<name>/main.ts`.                              |
| `docs-harness.ts` | `pnpm docs:harness` | Runs the CI `docs-harness` checks and exits non-zero on the first failure.                                                    |

Shared helpers live in `lib/`; they return results instead of exiting, so only the three entry
scripts decide the exit code, and all output goes through `lib/log.ts`.

## Options

- `docs-schemas.ts --root <dir>` and `docs-recipes.ts --root <dir>` — run against a tree other than
  the repository, which is how they are tested without leaving fixtures in the repository.
- `docs-harness.ts --skills-dir <dir>` — lint a different entry-skill directory.
- `docs-harness.ts --no-regenerate` — skip the `regeneration-diff` check (it costs ~6 s, almost all
  of it `pnpm docs:api`; the rest of the harness runs in ~0.2 s).
- `docs-harness.ts --base <ref>` — enable `api-report-gate` and `freshness`, which need a diff base
  and therefore report `SKIPPED` outside a pull request.
- `docs-harness.ts --allow-docs-not-needed` — CI passes this when the pull request carries the
  `docs-not-needed` label; it waives the "a file under `skills/` changed" half of `api-report-gate`.

## Schema discovery convention

A package contributes component schemas to the documentation by exporting a `describeSchemas()`
function (preferred: it keeps module scope free of calls, `CONSTITUTION.md` §3.5) or a `schemas`
object from its built entry point, `packages/<dir>/dist/index.js`. The function returns the same
record shape. The binding is a record keyed by component
`typeId`; each entry may carry `title`, `format`, `description`, and must carry `fields`, a record
of field name to `{ kind, default?, description? }`:

```js
export const schemas = {
  "ignifx/MeshRenderer": {
    title: "MeshRenderer",
    format: "components",
    description: "Draws a mesh asset with a material.",
    fields: { mesh: { kind: "asset", default: null, description: "The mesh to draw." } },
  },
};
```

Discovery is by convention: every built package is imported and one without a `schemas` export
contributes nothing. One `typeId` is documented once — the `ignifx` umbrella re-exports
`describeSchemas` from `@ignifx/core`, so the first package to declare a type id wins and the
umbrella's copy is dropped. Entries are grouped onto `references/formats/<format>.md` by their
`format` (default `components`) and bundled into `references/formats/ignifx.schemas.json`. The
generator only writes those files, so `formats/README.md` and the hand-written prose pages survive
regeneration. Today `@ignifx/core` contributes nine records: six components on `components.md` and
the three file formats on `ignifx.scene.md`, `ignifx.material.md`, and `ignifx.environment.md`.

## Recipe extraction convention

One recipe is one directory, `examples/recipes/<name>/`, with `main.ts` as its entry point. The
first block comment in `main.ts` is the prose — its first line is the title — and everything after
it is the code, emitted as a fenced `ts` block that the harness then type-checks. The code is capped
at 80 lines (`16-docs-harness-and-skill.md` §5); a longer recipe fails with the line count and the
instruction to split it. `examples/recipes/` is not a workspace package: it carries its own
`tsconfig.json` mapping `@ignifx/*` at the package sources, so the linters have a program to use,
and the harness compiles the extracted block against the built `dist/` instead.
