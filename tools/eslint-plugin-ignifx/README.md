# eslint-plugin-ignifx

The eight repository rules of [`docs/standards/coding-standards.md`](../../docs/standards/coding-standards.md) §6
that Oxlint cannot express. The package is `private`: it is never published, and the repository's
`eslint.config.ts` is its only consumer.

## How it loads

`package.json#exports` points at `src/index.ts`, not at `dist/`. ESLint reads `eslint.config.ts`
before any build has run, so a `dist/`-based entry point would make `pnpm lint` depend on
`pnpm build`. Node ≥ 22.18 strips the types from a `.ts` file on import, which works here because
the sources use only erasable syntax (`erasableSyntaxOnly`, coding standards §3) and spell relative
imports with a `.ts` extension (`rewriteRelativeImportExtensions`). Verified on Node 24.20 and
Node 25.2.

`pnpm --filter eslint-plugin-ignifx build` still produces `dist/index.mjs` so that
`turbo run build` is uniform across the workspace, but nothing imports it.

## Rules

All eight are enabled as errors by the `ignifx/gap-rules` block of the repository's
`eslint.config.ts`, and by this plugin's own `configs.recommended`. Every rule is syntactic — none
of them needs a TypeScript program.

### no-lite-outside-adapter

`CONSTITUTION.md` §3.4, coding standards §4. Reports an `import`, `export … from`, dynamic
`import()`, or `require()` of `@babylonjs/lite`, `@babylonjs/havok`, or `@dimforge/rapier2d-compat`
(prefix-matched, so subpaths count) from a file that is not under a `src/lite/` segment. Type-only
imports count: the Lite types reach the rest of the engine through the adapter's re-exports.

Options: `packages`, `adapterDirectories`, `allow`. The default `allow` covers
`**/test/**/*.test.ts`, `**/test/**/*.browser.test.ts`, and `**/test/**/fixtures/**` — the adapter's
compatibility tests pin the Lite behaviour the adapter relies on, which they can only do by calling
Lite directly, and their fixture modules are part of the same never-published test code.

### no-module-side-effects

`CONSTITUTION.md` §3.5, coding standards §4. In files matching `include` (default `**/src/**`) it
reports top-level expression statements, top-level `if`/`for`/`while`/`switch`/`try`/blocks, top-level
`await`, and calls, `new` expressions or `await`s inside a module-scope variable initialiser.

Allowed at module scope: `Symbol(…)`, `Symbol.for(…)`, `Object.freeze(…)`, the typed-array
constructors, and the callees in `allowCallees` (default `defineExtension`, `defineConfig`,
`defineSchema`, `Component.define`, `Script.define` — `define` calls build a class from a schema and
are declarative, ADR-0004). `new Map()`/`new Set()`/`new WeakMap()`/`new WeakSet()` are **not**
allowed: coding standards §4 says caches are created lazily inside functions.

Default `exclude`: `**/bin.ts`, `**/*.test.ts`, `**/*.browser.test.ts`, `**/tools/**`. The website is
switched off in `eslint.config.ts` instead, because it is an application that renders at import time
on purpose.

Known false negatives: static class property initialisers and static blocks (`class A { static x =
compute(); }`) run at import time but are not reported, so that ordinary class fields are not; and
tagged template expressions are not treated as calls.

### no-async-lifecycle

ADR-0010, coding standards §5.3. In any class body, reports a lifecycle callback — `awake`,
`onEnable`, `start`, `fixedUpdate`, `update`, `lateUpdate`, `onDisable`, `onDestroy`, the
collision/trigger family, `onApplicationPause`/`onApplicationFocus`, `onAttach`, `onDetach`,
`onHotReload` — that is `async` or annotated as returning `Promise<…>`, whether it is written as a
method, an arrow property, or a bodyless signature. Generators are fine: a coroutine is the
prescribed replacement.

The rule is name-based, so it does not check whether the class actually extends `Script`; a method
called `update` on an unrelated class is reported. That is deliberate — the callback names are
reserved vocabulary (`12-entity-component-script-vocabulary`).

### signal-connect-owner

`02-scene-graph.md` §8. Inside a class extending `Script`/`Component` (directly or through
`Script.define(…)`/`Component.define(…)`), reports `<expr>.connect(handler)` with no options, and
`<expr>.connect(handler, { … })` whose options literal has no `owner`. The first form carries an
autofix inserting `, { owner: this }`; the second does not, because the author may have meant to
name a different owner.

Known limits: a connect call inside a nested plain `function` still gets the `this`-based fix, which
would be wrong there; options passed as a variable, or an object literal containing a spread, are
not reported because the rule cannot see what they hold.

### no-entity-find-in-src

`02-scene-graph.md` §4, `03-scripting-and-components.md` §8. Reports `<expr>.find(<string>)` — a
string literal or a template literal — in files matching `include` (default `**/src/**`) and not
matching `exclude` (default tests, `examples/`, `tools/`, `scripts/`). The string-literal argument
is what separates `Entity.find(path)` from `Array.prototype.find(callback)` without type
information; `entity.find(pathVariable)` is therefore a known false negative.

### schema-field-shadowing

ADR-0004, `03-scripting-and-components.md` §3. When a class's `extends` clause is `<X>.define({…})`
or `defineSchema({…})` with an inline object literal, reports every non-static instance field
(including `declare` fields and `accessor` properties) whose name is a key of that literal, at both
locations. Static members are not reported: they live on the constructor and cannot shadow an
instance property. Methods are not reported either, only fields.

### error-code-format

`CONSTITUTION.md` §3.9, `15-devtools-and-diagnostics.md` §1. A string literal or substitution-free
template literal that begins `IGX-` and contains no whitespace must read `IGX-` plus four digits
whose leading pair is a registered range: `01`–`15` for engine subsystems, `9x` for third-party
extensions. Format violations and unregistered ranges get distinct messages, and so does the same
check applied to the first argument of `new IgnifxError(…)` when that argument is a string literal,
so the report says whether the code was found in a constructor call or loose in the source.

The whitespace condition keeps formatted messages and test expectations such as
`"IGX-0303 [layer]"` out of the rule; a malformed code buried in a sentence is the matching false
negative.

### no-console

Coding standards §5.5. Reports `console.<anything>` outside the files listed in `allow`. Oxlint's
own `no-console` reports the same shape; this rule exists because the **allowlist** is a repository
decision (coding standards §6 lists `ignifx/no-console` in the ESLint table): the log sink
(`**/src/log/**`), build scripts, CLI entry points, configuration files, repository tooling, the
website, and tests are all legitimate places to write to stdout, and that list belongs in one rule
option rather than in a growing pile of Oxlint overrides.

## Tests

`test/<rule>.test.ts`, one file per rule, using `@typescript-eslint/rule-tester` wired to Vitest's
`describe`/`it`/`afterAll` in `test/rule-tester.ts`. They run in the repository's `node` Vitest
project (`pnpm test`) and count towards the 80 % coverage floor.
