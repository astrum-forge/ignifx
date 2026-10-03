#!/usr/bin/env node
/**
 * `prepublishOnly` of every published package: refuses a publish that is not `pnpm publish`.
 *
 * The manifests name workspace packages as `workspace:*` and shared versions as `catalog:`. Only
 * `pnpm publish` rewrites those into real versions in the tarball; `npm publish` ships them as they
 * are, and the result cannot be installed by anyone. That happened to `@ignifx/particles`,
 * `@ignifx/particles-2d` and `@ignifx/terrain` 0.3.0 on 2026-10-03. Releases come from CI
 * (`release.yml`, `pnpm release`); this only stops the by-hand mistake.
 */
import { logError } from "./lib/log.ts";

const agent = process.env["npm_config_user_agent"] ?? "";
if (!agent.startsWith("pnpm/")) {
  logError(
    "Refusing to publish with " +
      (agent.split(" ")[0] ?? "an unknown client") +
      ": only `pnpm publish` rewrites `workspace:` and `catalog:` dependencies. " +
      "Releases go through release.yml; see .changeset/README.md.",
  );
  process.exitCode = 1;
}
