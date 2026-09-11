## Change

<!-- State the problem and resulting behaviour in a few sentences. Link an issue, plan item, or ADR if relevant. -->

## Validation

<!-- Paste the pnpm check result. Add relevant browser or benchmark results and name any checks not run. -->

```text
$ pnpm check
```

## Checklist

<!-- Mark each item done or explain briefly why it does not apply. Standards §15 has the full requirements. -->

- [ ] Code follows the standards; comments are short and explain only non-obvious reasons or constraints.
- [ ] Relevant tests pass, including regression and GPU tests where needed; coverage and budgets hold.
- [ ] Public API changes include TSDoc, regenerated reports/references, and affected skill pages. `pnpm api-report` passes after regeneration.
- [ ] User-visible changes have a concise changeset; breaking changes state the required action under **Breaking**.
- [ ] No generated files were hand-edited; no pre-1.0 migration documents were added.
- [ ] Any Lite API claims were checked against the pinned `index.d.ts`; backend imports stay inside adapters.
- [ ] Any waiver has a written reason and an issue tracking its removal (constitution §10.3).
