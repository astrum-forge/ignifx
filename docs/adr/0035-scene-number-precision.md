# ADR-0035 · Scene numbers keep six decimals

**Status:** Proposed · **Date:** 2026-10-20 · **Deciders:** Astrum Forge Studios (owner)

## Context

The serializer rounds every number to six decimals before writing it (`canonicalizeNumber` in `packages/core/src/schema/encode.ts`, `06-serialization-and-scene-format.md` §3), so that save, load and save give the same bytes. A level that code used to build can therefore look slightly different once it is a file. In `templates/3d-third-person` the crate scatter (seeded `cos`/`sin`) and the sun's `lookAt` quaternion moved by at most 5e-7. The visual golden then differed from `main`'s build in 21 of 147,456 pixels, each by 1/255; putting the exact poses back after the load gave a 0-pixel diff (engine PR #46, gap 11). `3d-first-person` showed the same effect in 6 pixels (PR #52).

Constraints: byte-stable saves (`06` §1), readable diffs, and correctness (`CONSTITUTION.md` §2.1). Changing the rule rewrites numbers in every saved file; before 1.0 that is allowed in a minor release (§4.2).

## Options considered

1. **Keep six decimals and document the effect.** 5e-7 is half a micrometre in position and a few microradians in rotation: about 0.2 mm at 100 m. No file changes. A level converted from code may move goldens by single 1/255 steps once.
2. **Write the shortest text that reads back as the same 32-bit float.** Closer to what Lite uploads to the GPU. But numbers grow to about nine significant digits (`0.70710677`), JavaScript has no built-in printer for this, and every computed value already saved changes once.
3. **No rounding: JavaScript's shortest text for the 64-bit value.** Exact and still byte-stable. But files fill with noise such as `0.30000000000000004`, and every gizmo drag in the editor writes 17-digit numbers into diffs.

## Decision

Recommended: option 1. Scene numbers keep six decimals; the difference is documented, not removed.

## Consequences

- Nothing changes in code or in any file. Goldens that move after a level is converted to a file are regenerated once, with the reason in the pull request.
- Editor: values typed or dragged in the inspector show at most six decimals, which matches what is saved.
- Revisit if a game needs sub-micrometre placement, or very large worlds where a few microradians become visible. Both would want a per-field precision rather than a new global rule.
- If accepted: one paragraph in doc 06 §3 on converting code-built levels (rounding moves computed poses by at most 5e-7, which can shift single pixels), and the same note in the skill's `references/formats/scene.md`. No changeset is needed for contributor docs; the skill note is a patch changeset to `ignifx`.
