## What

<!-- One concern per pull request (CONSTITUTION.md §7.5, standards §11). Say what changed. -->

## Why

<!-- Link the driver: a phase/deliverable in docs/plan/engineering-plan.md, an ADR in docs/adr/,
     or an issue. Cite the constitution or standards clauses the change rests on (standards §15). -->

- Plan item / ADR / issue:
- Clauses cited:

## How tested

<!-- Paste the result of `pnpm check` (standards §15). Name any new tests and say what they pin
     down; for a bug fix, point at the regression test (CONSTITUTION.md §6.1). -->

```
$ pnpm check
```

## Definition of done

<!-- CONSTITUTION.md §6.6 and standards §11. Tick every box or say in one line why it does not
     apply — an unticked box with no explanation blocks review. -->

- [ ] Code follows `docs/standards/coding-standards.md` (no `any`, no enums/namespaces, no
      import-time side effects, no `async` lifecycle callbacks).
- [ ] Tests added or updated, and they pass; coverage floors held (80% per package, 90% for core —
      CONSTITUTION.md §6.2). GPU-touching code has a browser test.
- [ ] TSDoc on every public symbol, with a release tag (`@public`/`@beta`/`@alpha`/`@internal`) and
      an example where usage is not obvious (CONSTITUTION.md §5.4).
- [ ] API report regenerated (`pnpm api-report`) and `api/*.api.md` committed — not hand-edited.
- [ ] `skills/**` updated in this pull request (CONSTITUTION.md §5.2), or `docs-not-needed`
      because: <!-- justification --> .
- [ ] Changeset added (`pnpm changeset`) at the right semver level; breaking changes listed under a
      **Breaking** heading (CONSTITUTION.md §4.2).
- [ ] `@babylonjs/lite` (and other native/WASM backends) imported only from `src/lite/**`
      (CONSTITUTION.md §3.4).
- [ ] Nothing added under `docs/migrations/` — the version is still `0.x` (CONSTITUTION.md §4.2).
- [ ] Any Babylon Lite claim was verified against the pinned version's `index.d.ts`, not from
      memory (AGENTS.md).
- [ ] Waivers, if any, are written out with an issue tracking their removal (CONSTITUTION.md §10.3).
