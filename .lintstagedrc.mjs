// Pre-commit formatting and linting of staged files (coding standards §6).
//
// Two rules learned the hard way in Phase 6:
// - lint-staged hands oxfmt explicit paths, which bypasses `.oxfmtignore`, so the generated template
//   documents are filtered out here as well — otherwise the committed file differs from what the
//   generator writes and every regeneration leaves a diff.
// - `oxlint --fix` is NOT run here. An autofix at commit time rewrote code that had passed the full
//   `pnpm check` (merged two `push` calls, replaced a `dirname(fileURLToPath(...))` and left its
//   imports unused), and the breakage surfaced only on the next run. The hook reports; people fix.

/** Files a generator writes; they are formatted by their generator, not by the hook. */
const GENERATED = [
  /templates\/[^/]+\/assets\/[^/]+\.atlas\.json$/u,
  /templates\/[^/]+\/assets\/level\.tilemap\.json$/u,
];

/**
 * Drops the generated files from a staged list.
 * @param files - The staged file paths lint-staged matched.
 * @returns The paths a person edited.
 */
function handEdited(files) {
  return files.filter((file) => !GENERATED.some((pattern) => pattern.test(file)));
}

/**
 * Renders paths as one shell-safe argument list.
 * @param files - The paths.
 * @returns The quoted, space-separated list.
 */
function quoted(files) {
  return files.map((file) => JSON.stringify(file)).join(" ");
}

export default {
  "*.{ts,mts,cts,js,mjs,cjs,json}": (files) => {
    const kept = handEdited(files);
    return kept.length === 0 ? [] : [`oxfmt ${quoted(kept)}`, `oxlint ${quoted(kept)}`];
  },
  "*.md": ["prettier --write"],
};
