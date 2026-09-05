import type { UserConfig } from "@commitlint/types";

/**
 * Conventional Commits with package-name scopes (coding standards §11).
 */
const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "core",
        "input",
        "physics",
        "physics-2d",
        "audio",
        "2d",
        "3d",
        "ui",
        "electron",
        "devtools",
        "vite-plugin",
        "cli",
        "ignifx",
        "templates",
        "examples",
        "benchmarks",
        "website",
        "docs",
        "skills",
        "repo",
      ],
    ],
  },
};

export default config;
