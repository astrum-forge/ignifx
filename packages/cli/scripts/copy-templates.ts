import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the repository's `templates/*` into this package so the published tarball ships
 * `<package>/templates/<name>` next to `<package>/dist/bin.js`
 * (`docs/architecture/00-overview.md` §2). It runs from `prepack`, and the copy is git-ignored
 * because `templates/` at the repository root is the single source of truth — the same arrangement
 * `packages/ignifx/scripts/copy-skill.ts` uses for the Agent Skill.
 *
 * Two rewrites happen here rather than at scaffold time:
 *
 * - **`package.json` becomes `_package.json`.** npm rewrites a nested `package.json` while packing
 *   and would treat the directory as a workspace; the underscore is the convention every
 *   scaffolder uses, and `copyTemplate`'s `DEFAULT_TEMPLATE_RENAMES` restores the name.
 * - **`catalog:` specifiers are resolved from `pnpm-workspace.yaml`.** A catalog reference only has
 *   meaning inside this workspace, so a generated project would fail to install with one. It is
 *   done here and not in `copyTemplate` because only the repository has the catalog to read; the
 *   `workspace:` protocol, by contrast, is resolved at copy time from the package's own version.
 *
 * Node runs this file directly through type stripping, so it stays inside erasable syntax
 * (coding standards §3).
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const source = join(repoRoot, "templates");
const destination = join(packageRoot, "templates");

/** Build and tooling output a template checkout may hold locally but must never be published. */
const IGNORED = new Set(["node_modules", "dist", ".turbo", ".tsbuild", ".tsbuild-test", "coverage"]);

/**
 * Reads the flat `catalog:` block of `pnpm-workspace.yaml`.
 *
 * @remarks
 * The block is a plain map of quoted-or-bare package names to version ranges, so it is read with a
 * line scanner rather than by adding a YAML parser to a package that needs one for nothing else.
 * A named-catalogs (`catalogs:`) block, if one is ever added, is deliberately not read: a template
 * that used one would have to say which catalog, and no template does.
 *
 * @returns The catalog, package name to range.
 */
async function readCatalog(): Promise<Map<string, string>> {
  const text = await readFile(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const catalog = new Map<string, string>();
  let inCatalog = false;
  for (const line of text.split("\n")) {
    if (/^catalog:\s*$/u.test(line)) {
      inCatalog = true;
      continue;
    }
    if (inCatalog && /^\S/u.test(line)) {
      break;
    }
    if (!inCatalog) {
      continue;
    }
    const match = /^\s+"?([^":\s]+)"?:\s*(\S.*?)\s*$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      catalog.set(match[1], match[2]);
    }
  }
  if (catalog.size === 0) {
    throw new Error("pnpm-workspace.yaml has no catalog: block, so catalog: specifiers cannot be resolved.");
  }
  return catalog;
}

/**
 * Narrows an unknown JSON value to something whose keys can be read and written.
 *
 * @param value - The value to test.
 * @returns `true` for any non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The dependency blocks whose specifiers are rewritten. */
const DEPENDENCY_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/**
 * Replaces every `catalog:` specifier in a template's manifest with the range the catalog names.
 *
 * @param manifestPath - The `_package.json` to rewrite in place.
 * @param catalog - The workspace catalog.
 * @returns How many specifiers were rewritten.
 */
async function resolveCatalogSpecifiers(manifestPath: string, catalog: Map<string, string>): Promise<number> {
  const document: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!isRecord(document)) {
    throw new Error(`${manifestPath} is not a JSON object.`);
  }
  let rewritten = 0;
  for (const blockName of DEPENDENCY_BLOCKS) {
    const entries: unknown = document[blockName];
    if (!isRecord(entries)) {
      continue;
    }
    for (const name of Object.keys(entries)) {
      const specifier: unknown = entries[name];
      if (typeof specifier !== "string" || !specifier.startsWith("catalog:")) {
        continue;
      }
      const named = specifier.slice("catalog:".length);
      if (named !== "" && named !== "default") {
        throw new Error(`${manifestPath} uses the named catalog "${named}", which is not supported here.`);
      }
      const range = catalog.get(name);
      if (range === undefined) {
        throw new Error(`${manifestPath} names "${name}" as catalog:, but pnpm-workspace.yaml does not list it.`);
      }
      entries[name] = range;
      rewritten += 1;
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return rewritten;
}

const catalog = await readCatalog();
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

const names = (await readdir(source, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .toSorted();

/**
 * Copies one template and resolves its catalog specifiers.
 *
 * @param name - The template directory name.
 * @returns The line to report.
 */
async function copyOneTemplate(name: string): Promise<string> {
  const target = join(destination, name);
  await cp(join(source, name), target, {
    recursive: true,
    filter: (path) => !path.split(/[/\\]/u).some((segment) => IGNORED.has(segment)),
  });
  const manifest = join(target, "_package.json");
  await rename(join(target, "package.json"), manifest);
  const rewritten = await resolveCatalogSpecifiers(manifest, catalog);
  return `templates/${name}: copied, ${String(rewritten)} catalog: specifiers resolved`;
}

// The templates are independent, so they are copied concurrently; the report is printed in name
// order afterwards, which keeps the output the same on every run.
const reports = await Promise.all(names.map(copyOneTemplate));
for (const report of reports) {
  process.stdout.write(`${report}\n`);
}
