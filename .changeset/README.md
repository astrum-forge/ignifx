# Writing a changeset

Run `pnpm changeset` for a user-visible package, template, or shipped skill change.
Select the affected packages and the correct bump. Contributor-only docs and internal changes with no user impact do not need a release.

| Change                                     | Bump                                                      |
| ------------------------------------------ | --------------------------------------------------------- |
| Compatible fix or documentation correction | Patch                                                     |
| Compatible feature                         | Minor                                                     |
| Breaking change before 1.0                 | Minor, with a **Breaking** heading                        |
| Breaking change from 1.0 onward            | Major, with a **Breaking** heading and migration document |

The workspace releases packages on one fixed version line. Review the generated Version Packages PR for the final versions.
Choosing `major` does not automatically produce a pre-1.0 minor release.

## Write the result users will notice

Use one short sentence per change. Add a second only for an action or limitation.
Name the affected feature and the result. Keep file lists, test logs, and implementation steps in the PR.
See [standards §9.4](../docs/standards/coding-standards.md#94-changesets-and-release-notes) for the full writing rules.

Example file (illustrative only):

```md
---
"@ignifx/core": patch
---

Fix scene loading after a cancelled asset request.
```

For a breaking change, use the appropriate bump and a body like:

```md
### Breaking

Rename `oldMethod()` to `newMethod()`. Update calls to use `newMethod()`.
```

Before 1.0, keep upgrade instructions in the note; do not create a migration document.
Edit unreleased changesets before generation. Keep generated version headings and links; do not rewrite published changelogs.
The release workflow uses `pnpm version-packages` to generate the release and sync skill versions and schemas.
