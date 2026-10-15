import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A fixture tree: `/`-separated paths relative to the tree root, mapped to their contents. */
export type FixtureTree = Readonly<Record<string, string>>;

/** Roots created by this module, removed together by {@link disposeFixtures}. */
const createdRoots: string[] = [];

/**
 * Writes a tree of files into a fresh temporary directory.
 *
 * @param files - The files to write.
 * @returns The absolute path of the tree root.
 */
export async function createFixtureTree(files: FixtureTree): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ignifx-editor-host-"));
  createdRoots.push(root);
  await Promise.all(
    Object.entries(files).map(async ([path, contents]) => {
      const target = join(root, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    }),
  );
  return root;
}

/** Removes every tree created so far. */
export async function disposeFixtures(): Promise<void> {
  const roots = createdRoots.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}

/**
 * A project as the editor opens it: a game page, an extensions module, and stand-ins for the two
 * packages the scene view imports, so Vite can resolve every import without the real builds.
 */
export const PROJECT: FixtureTree = {
  "package.json": JSON.stringify({ name: "game", private: true, type: "module" }),
  "index.html": '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>',
  "src/main.ts":
    'import { attachEditorPlayControls } from "virtual:ignifx/editor";\nexport { attachEditorPlayControls };\n',
  "src/extensions.ts": "export function extensions() {\n  return [];\n}\n",
  "src/scripts/mover.ts": 'export class Mover {\n  static typeId = "game/Mover";\n}\n',
  "node_modules/@ignifx/core/package.json": JSON.stringify({ name: "@ignifx/core", version: "1.2.3", type: "module" }),
  "node_modules/@ignifx/editor-host/package.json": JSON.stringify({
    name: "@ignifx/editor-host",
    version: "1.2.3",
    type: "module",
    exports: { ".": "./index.js" },
  }),
  "node_modules/@ignifx/editor-host/index.js":
    "export async function startEditorHost() {\n  return { app: null };\n}\nexport function startEditorPlayControls() {\n  return { dispose() {} };\n}\n",
};
