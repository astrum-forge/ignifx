import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A fixture tree: `/`-separated paths relative to the tree root, mapped to their contents. */
export type FixtureTree = Readonly<Record<string, string | Uint8Array>>;

/** Roots created by this module, removed together by {@link disposeFixtures}. */
const createdRoots: string[] = [];

/** A handful of bytes that start with the PNG signature — enough to hash and copy. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

/**
 * Writes a tree of files into a fresh temporary directory.
 *
 * @param files - The files to write.
 * @returns The absolute path of the tree root.
 */
export async function createFixtureTree(files: FixtureTree): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ignifx-vite-plugin-"));
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

/**
 * Adds or overwrites one file inside an existing fixture tree.
 *
 * @param root - The tree root.
 * @param path - The `/`-separated path relative to the root.
 * @param contents - What to write.
 * @returns The absolute path written.
 */
export async function writeFixture(root: string, path: string, contents: string | Uint8Array): Promise<string> {
  const target = join(root, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}

/** Removes every tree created so far. */
export async function disposeFixtures(): Promise<void> {
  const roots = createdRoots.splice(0);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}

/** A minimal valid scene file, as `docs/architecture/06-serialization-and-scene-format.md` §2 defines it. */
export const VALID_SCENE = JSON.stringify(
  {
    format: "ignifx.scene",
    formatVersion: 1,
    name: "Level01",
    entities: [],
  },
  null,
  2,
);
