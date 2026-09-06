/**
 * dependency-cruiser rules for ignifx.
 *
 * Enforces two structural rules that are otherwise only prose:
 *
 * - The package layering of `docs/architecture/00-overview.md` §2.1 — a package imports only
 *   from the layers below it, never sideways and never upwards. Circular package dependencies
 *   are forbidden (same section) and so are circular module dependencies.
 * - The Babylon Lite adapter boundary of `CONSTITUTION.md` §3.4 / coding standards §4 —
 *   `@babylonjs/lite` (and the other native/WASM backends) may be imported only from
 *   `src/lite/**`. The custom ESLint rule `ignifx/no-lite-outside-adapter` (standards §6.5,
 *   Phase 1) covers the same ground from the linter side; this is the belt-and-braces copy that
 *   also sees files ESLint is not asked to lint.
 *
 * Run with `pnpm deps` (coding standards §12, job 6).
 *
 * CommonJS on purpose: dependency-cruiser auto-discovers `.dependency-cruiser.{js,cjs,mjs}` and
 * this repository is `"type": "module"`, so the config has to carry the `.cjs` extension.
 * The exported shape is dependency-cruiser's `IConfiguration`; it is not annotated with a JSDoc
 * type because `jsdoc/no-types` (coding standards §9) forbids types in JSDoc.
 */

/* global module */

/**
 * The layering of `docs/architecture/00-overview.md` §2.1, as data: for each workspace package,
 * the `@ignifx/*` packages it is allowed to import. Anything not listed is a violation.
 *
 * `templates/*` and `examples/*` may use anything and are not cruised here.
 */
const ALLOWED_IMPORTS = {
  // Layer 1 — the kernel. Imports no ignifx package; only @babylonjs/lite (from src/lite/).
  core: [],

  // Layer 2 — the standard extensions. Built on core, plus the one peer each declares in its
  // `ignifx` manifest.
  input: ["core"],
  physics: ["core"],
  audio: ["core"],
  "2d": ["core"],
  ui: ["core", "input"],
  "physics-2d": ["core", "2d"],
  "3d": ["core", "physics", "input"],

  // Layer 3 — platform, tooling and the umbrella.
  electron: ["core"],
  devtools: ["core"],
  ignifx: ["core", "input", "physics", "physics-2d", "audio", "2d", "3d", "ui", "electron"],

  // Build-time tooling: no runtime coupling to the engine at all.
  "vite-plugin": [],
  cli: [],
};

/** Directory names under `packages/` that are not published engine packages. */
const PACKAGE_NAMES = Object.keys(ALLOWED_IMPORTS);

/**
 * Escapes a package directory name so it can be spliced into a regular expression source string.
 * @param name - A package directory name under `packages/`, e.g. `physics-2d`.
 * @returns The same name with every regular-expression metacharacter backslash-escaped.
 */
function escapeForRegExp(name) {
  return name.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/**
 * Every shape a dependency on `@ignifx/<name>` can take in a cruise result: the workspace source
 * it resolves to through the pnpm symlink, the symlinked copy if symlinks are ever preserved, and
 * the bare specifier, which is what shows up when the target package has not been built yet and
 * so does not resolve at all.
 * @param name - A package directory name under `packages/`.
 * @returns Regular expression sources matching any reference to that package.
 */
function referencesTo(name) {
  const escaped = escapeForRegExp(name);
  return [
    `^packages/${escaped}/`,
    `^node_modules/@ignifx/${escaped}(/|$)`,
    `^packages/[^/]+/node_modules/@ignifx/${escaped}(/|$)`,
    `^@ignifx/${escaped}(/|$)`,
  ];
}

/**
 * The authored code of a package — the only place the layering rule applies. Build output is
 * generated and is a rule target, never a rule subject.
 * @param name - A package directory name under `packages/`.
 * @returns A regular expression source matching that package's `src/` and `test/` files.
 */
function sourcesOf(name) {
  return `^packages/${escapeForRegExp(name)}/(src|test)/`;
}

/** One layering rule per package, generated from ALLOWED_IMPORTS. */
const layeringRules = PACKAGE_NAMES.map((name) => {
  const allowed = ALLOWED_IMPORTS[name];
  const selfAndAllowed = [name, ...allowed].flatMap((dependency) => referencesTo(dependency));

  return {
    name: `layering-${name}`,
    comment:
      allowed.length > 0
        ? `@ignifx/${name} may import only ${allowed.map((dependency) => `@ignifx/${dependency}`).join(", ")} ` +
          `(docs/architecture/00-overview.md §2.1). Move the shared code down a layer instead.`
        : `@ignifx/${name} sits at the bottom of its stack and may not import any @ignifx/* package ` +
          `(docs/architecture/00-overview.md §2.1).`,
    severity: "error",
    from: { path: sourcesOf(name) },
    to: {
      path: ["^packages/", String.raw`^@ignifx/`, "node_modules/@ignifx/"],
      pathNot: selfAndAllowed,
    },
  };
});

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "Circular dependencies make module initialisation order undefined and package dependencies " +
        "unresolvable. Forbidden between modules and between packages " +
        "(docs/architecture/00-overview.md §2.1). Cycles that exist only through `import type` edges " +
        "are erased by the compiler and carry no initialisation order, so they are allowed: the " +
        "scene graph's mutually-referential types (Entity ↔ Component ↔ World ↔ App) need them.",
      severity: "error",
      from: { path: "^packages/[^/]+/(src|test)/" },
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "no-lite-outside-adapter",
      comment:
        "Only `src/lite/**` may import @babylonjs/lite (CONSTITUTION.md §3.4, coding standards §4). " +
        "Expose what you need through the adapter with TSDoc and a test instead.",
      severity: "error",
      from: {
        path: "^packages/[^/]+/(src|test)/",
        // The adapter's own compatibility tests verify Lite directly (coding standards §10).
        pathNot: ["^packages/[^/]+/src/lite/", "^packages/[^/]+/test/lite/"],
      },
      to: { path: "@babylonjs/lite" },
    },
    {
      name: "no-native-backend-outside-adapter",
      comment:
        "@babylonjs/havok, @dimforge/rapier2d-compat and the other native/WASM backends follow the " +
        "same adapter rule as Babylon Lite (coding standards §4).",
      severity: "error",
      from: {
        path: "^packages/[^/]+/(src|test)/",
        pathNot: ["^packages/[^/]+/src/lite/", "^packages/[^/]+/test/lite/"],
      },
      to: { path: ["@babylonjs/havok", "@dimforge/rapier"] },
    },
    ...layeringRules,
  ],
  options: {
    // Third-party packages and build output are endpoints in the graph, not territory to crawl.
    // They stay *in* the graph on purpose: `@babylonjs/lite` has to be visible for the adapter
    // rules above, and a workspace import of `@ignifx/<pkg>` resolves through the pnpm symlink to
    // that package's `dist/index.js`, which the layering rules have to be able to see.
    doNotFollow: { path: "(^|/)(node_modules|dist)/" },

    // Coverage output and task caches are generated (coding standards §15) and are never the
    // subject of a rule.
    exclude: {
      path: "(^|/)(coverage|[.]turbo|[.]tsbuild|[.]tsbuild-test)/",
    },

    // Read `compilerOptions` (paths/baseUrl) from the root project. dependency-cruiser only
    // resolves this through the TypeScript compiler API, which it accepts at ">=2.0.0 <7.0.0" —
    // satisfied by the `typescript` → @typescript/typescript6 alias of ADR-0007, not by the
    // TS 7 native compiler that `typescript-native` provides.
    tsConfig: { fileName: "tsconfig.json" },

    // Standards §4 requires `import type`; without this, type-only edges are invisible and a
    // layering violation expressed as a type import would slip through. "specify" additionally
    // labels each edge `type-only` when it is, which `no-circular` uses to ignore erased cycles.
    tsPreCompilationDeps: "specify",

    enhancedResolveOptions: {
      // Every package is ESM with an `exports` map (standards §4), so resolution has to honour it.
      exportsFields: ["exports"],
      conditionNames: ["import", "module", "types", "default"],
      // Standards §4: relative imports are written with a `.js` extension that the compiler
      // rewrites from `.ts`. `.ts`/`.mts` come first so `./errors.js` finds `./errors.ts`.
      extensions: [".ts", ".mts", ".cts", ".d.ts", ".js", ".mjs", ".cjs", ".json"],
      mainFields: ["module", "main", "types"],
    },

    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
