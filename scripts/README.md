# Repository scripts

Node-only tooling for the documentation harness (`docs/architecture/16-docs-harness-and-skill.md`).
Every script is plain TypeScript run by Node ≥ 24 through type stripping — no build step and no
dependencies beyond the Node standard library — which means **erasable syntax only** and
**relative imports must carry the `.ts` extension**. `tsconfig.tools.json` type-checks them for
`pnpm typecheck`; `scripts/tsconfig.json` gives the type-aware linters a real program to use.

| Script            | npm script              | What it does                                                                                                                  |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `docs-schemas.ts` | `pnpm docs:schemas`     | Regenerates `skills/ignifx/references/formats/*.md` and `ignifx.schemas.json` from the component schemas the packages export. |
| `docs-recipes.ts` | `pnpm docs:recipes`     | Regenerates `skills/ignifx/references/recipes/<name>.md` from `examples/recipes/<name>/main.ts`.                              |
| `docs-llms.ts`    | `pnpm docs:llms`        | Regenerates `website/public/llms.txt`, the site's index of the skill for agents.                                              |
| `docs-harness.ts` | `pnpm docs:harness`     | Runs the CI `docs-harness` checks and exits non-zero on the first failure.                                                    |
| `licenses.ts`     | `pnpm licenses:notices` | Regenerates `THIRD_PARTY_NOTICES.md` from `pnpm licenses list --prod` and the workspace manifests.                            |

Shared helpers live in `lib/`; they return results instead of exiting, so only the four entry
scripts decide the exit code, and all output goes through `lib/log.ts`. Their tests live in
`scripts/test/` and run in the Vitest `node` project (`vitest.config.ts` lists that glob).

## Options

- `docs-schemas.ts --root <dir>` and `docs-recipes.ts --root <dir>` — run against a tree other than
  the repository, which is how they are tested without leaving fixtures in the repository.
- `docs-harness.ts --skills-dir <dir>` — lint a different entry-skill directory.
- `docs-harness.ts --no-regenerate` — skip the `regeneration-diff` check (it costs ~6 s, almost all
  of it `pnpm docs:api`). `examples-run` costs another ~11 s, one Node process per tagged block; the
  rest of the harness runs in ~0.2 s.
- `docs-harness.ts --base <ref>` — enable `api-report-gate` and `freshness`, which need a diff base
  and therefore report `SKIPPED` outside a pull request.
- `docs-llms.ts --root <dir>` — the same, for the `llms.txt` generator.
- `licenses.ts --root <dir>` — the same, for the notices generator; `--check` compares the
  committed file against what the generator would write and exits non-zero on a difference
  (`pnpm licenses:check`, which the CI `licenses` job runs).
- `docs-harness.ts --allow-docs-not-needed` — CI passes this when the pull request carries the
  `docs-not-needed` label; it waives the "a file under `skills/` changed" half of `api-report-gate`.

## Third-party notices

`licenses.ts` writes `THIRD_PARTY_NOTICES.md` (`CONSTITUTION.md` §11.2). It unions two sources,
because neither alone is right: `pnpm licenses list --prod --json` gives the resolved production
closure — which catches a transitive dependency nobody declared — and the workspace manifests give
the `dependencies`, `peerDependencies` and `optionalDependencies` of every package under
`packages/` and `templates/`, which is where a **peer** dependency such as `electron` or `vite`
appears; pnpm does not report those under `--prod` because the workspace itself carries them as dev
dependencies. `workspace:` specifiers and the `@ignifx/*` names are dropped: they are this
repository, not a third party.

Per package the file records the version, the SPDX licence, the copyright line lifted from the
package's own licence file (`null` rather than a guess when it has none — the bare Apache-2.0 text
carries no notice), the repository URL, and which ignifx packages require it. A package that ships a
`NOTICE` file has it reproduced verbatim in a fenced block, which is what Apache-2.0 §4(d) asks of a
redistribution; `@babylonjs/lite` is the one that does.

Output is sorted and carries nothing machine-specific, so `pnpm licenses:check` is a byte
comparison and the CI `licenses` job is a `git diff --exit-code`.

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
instruction to split it. A recipe whose first line after the doc comment is `// docs:run` is emitted
as a `ts run` block instead, so `examples-run` executes it; the directive is consumed by the
generator, never reaches the page, and does not count against the cap. It is a line comment rather
than a doc-comment tag because `jsdoc/check-tag-names` rejects tags outside the TSDoc set
`eslint.config.ts` declares. `examples/recipes/` is not a workspace package: it carries its own
`tsconfig.json` mapping `@ignifx/*` at the package sources, so the linters have a program to use,
and the harness compiles the extracted block against the built `dist/` instead. The generator writes
`<name>.md` only, never the hand-written `recipes/README.md` — so it fails when a recipe has no row
in that index, which is the one way the index can go stale.

## Executable examples (`ts run`)

`examples-compile` type-checks every fenced `ts` block in the skills; `examples-run`
(`lib/check-examples-run.ts`) additionally **executes** every block whose info string is `ts run`,
which is how a block that claims to be headless is held to it.

Tag a block `ts run` when it is headless and self-contained. The mechanism:

1. Every `ts run` block is written into one throw-away project outside the repository, with
   `"type": "module"`.
2. That project gets a `node_modules/` of symbolic links — `ignifx` and one `@ignifx/<name>` per
   workspace package — pointing at `packages/<dir>`. Node resolves a link to its real path before
   it looks for `node_modules`, so each package's own dependencies (`@babylonjs/lite`, Havok,
   Rapier) resolve out of `packages/<dir>/node_modules` exactly as they do in the workspace. Links
   rather than an import map or a loader hook: no flags, the same behaviour on macOS and Linux, and
   `package.json` `exports` stays the one resolver. The links are created with the `junction` type
   so a Windows checkout needs no elevated privileges.
3. Each block runs as its own `node blocks/<file>.ts`. Node ≥ 24 strips types from `.ts` without a
   flag (`--experimental-strip-types` has been on by default since Node 23.6), so the block runs
   exactly as documented — no build step, no rewriting.

A block passes when it exits 0 within 30 seconds. A failure names the Markdown file and the line of
the opening fence, like a compile diagnostic, and quotes the tail of the process output. A passing
run prints one `file:line — Nms` line per block, so a block that has become slow is visible.

**Do not** tag a block that needs a DOM, a GPU, or an asset file that only exists in a real project:
`app.assets.load` over `fetch` has nothing to fetch here, and the block would fail. Those stay `ts`
and are type-checked only. The examples project is type-checked with `types: ["@webgpu/types",
"node"]`, so a block may legitimately import `node:*`.

## Skill lint rules

`lib/check-skill-lint.ts` holds one function per rule and `lib/skill-template.ts` holds the two
template rules; the header comment of each file is the list. Two of them have escape hatches:

- a line may keep a time-sensitive word by carrying `<!-- lint-allow: time-phrase -->`, which is for
  prose about runtime behaviour ("the listener enabled last wins"), not for release-timeline prose;
- a block may import something other than `ignifx`, `@ignifx/*`, `vite`, `virtual:ignifx/*` or
  `node:*` only by opting out of checking entirely with `ts ignore-check`.
