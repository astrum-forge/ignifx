# ADR-0021 · Clear development guidance

**Status:** Proposed · **Date:** 2026-09-11 · **Decider:** Astrum Forge Studios (owner)

## Context

The constitution and coding standards repeat rules, mix daily steps with tool history, and contain stale commands.
The owner requested simpler guidance for humans and agents, shorter comments, and clearer release notes.
The constitution requires an ADR for this amendment (§10.2).

## Options considered

1. Add a writing checklist to the existing docs. This leaves the duplication and workflow errors in place.
2. Rewrite the development guides, keep clause numbers, and link to one source for each rule. This makes daily work easier without breaking numbered references.

## Decision

Use option 2. Keep the engine boundaries, compatibility rules, quality budgets, and human merge approval.

The amendment makes these clarifications explicit:

- Constitution §2.2 and standards §5.4 favour clear code over narration and speculative abstractions.
- Constitution §5.4 describes concise API contracts; §5.8 adds plain-language rules for comments, docs, and release notes.
- Constitution §6.6 makes deliverables depend on what changed. Contributor-only prose needs no artificial runtime test or package release.
- Constitution §3.5 matches the standards' existing allowance for declarations and immutable constants at module scope.
- Constitution §6.5 matches the standards' existing ban on `any`, non-null assertions, and `@ts-ignore`; waivers still use §10.3.
- Constitution §9.4 records the private-repository provenance exception already documented in ADR-0009.
- Constitution §7.2 recognises the amendment PR title required by §10.2.

The standards and contributor guide point to configuration for exact tool versions and settings.
They distinguish API report generation from validation, and local checks from the full CI suite.
They correct the pre-1.0 bump instructions: the installed Changesets release planner increments by the selected SemVer level, so a breaking `0.x` release needs a minor changeset.
The PR template and changeset guide use the same concise writing rules.

## Consequences

Contributors have one daily workflow and concrete examples of useful comments and release notes.
Required API details, invariant comments, and test evidence remain; brevity must not hide behaviour or risks.
Generated prose is fixed at its source. This change does not rewrite published changelogs, generated API docs, or existing source comments.

The amendment remains proposed until the owner approves its constitution PR. No runtime, lint configuration, or release automation changes are required.
