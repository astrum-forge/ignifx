import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Copies the repository's entry Agent Skill into the umbrella package so the published tarball
 * ships `skills/ignifx/` (`docs/architecture/16-docs-harness-and-skill.md` §1). It runs from
 * `prepack`, and the copy is git-ignored because `skills/ignifx/` is the single source of truth.
 *
 * Node runs this file directly through type stripping, so it stays inside erasable syntax
 * (coding standards §3).
 */
const source = fileURLToPath(new URL("../../../skills/ignifx", import.meta.url));
const destination = fileURLToPath(new URL("../skills/ignifx", import.meta.url));

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
