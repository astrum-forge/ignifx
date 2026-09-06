---
"@ignifx/cli": minor
---

`create-ignifx` now ships real templates. `2d-topdown` and `2d-sidescroller` are copied into the
package at pack time (`scripts/copy-templates.ts`) and land in a generated project ready to build.

- `copyTemplate` rewrites `workspace:` dependency specifiers to a published range — `DEFAULT_DEPENDENCY_RANGE`,
  which is `^` plus the package's own version — so a scaffolded `package.json` installs from the
  registry. Pass `dependencyRange: null` to copy it byte for byte.
- `resolveTemplatesRoot` finds the templates in either layout: `<package>/templates` in a published
  tarball, the repository's own `templates/` in a checkout. `TEMPLATE_ROOT_CANDIDATES` names both,
  and `src/bin.ts` uses it, so `node packages/cli/dist/bin.js my-game` works without a pack.
- `VERSION` is exported, matching every other first-party package.

The catalog half of the same problem — `"vite": "catalog:"` — is resolved at pack time instead,
because only the repository has a catalog to read; a project scaffolded from a checkout therefore
still carries `catalog:` and is meant for testing the copy rather than for installing.

The scaffolded project is named after its target directory; `copyTemplate({ projectName })` overrides it and `null` keeps the template's name.
