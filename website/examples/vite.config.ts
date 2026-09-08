import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ignifx } from "@ignifx/vite-plugin";
import { defineConfig } from "vite";
import { CATALOGUE } from "./catalogue.ts";
import type { Plugin, ResolvedConfig } from "vite";

/**
 * The examples build: one multi-page Vite build over every kit example
 * (`website/plan/04-examples-platform.md` §2, `08-execution.md` §4.2).
 *
 * Configuration files are the one place a default export is allowed (coding standards §4).
 *
 * ## How it fits into the one site build
 *
 * `website/package.json`'s `build` runs three things in order: the site (which empties `dist/`),
 * then this build, then `_tools/build-templates.ts`. So this build only ever *adds* to
 * `dist/examples/`, and the site's own pages are already there when it runs.
 *
 * ## Why it builds into a staging directory
 *
 * Vite's multi-page input names each page by its HTML file's path, so `hello-cube/index.html` would
 * build straight to `dist/examples/hello-cube/index.html` — **which is the site's viewer page for
 * that slug.** Writing there and renaming afterwards destroys it: Vite has already overwritten the
 * file by the time any plugin hook could move it (reproduced 2026-09-07 — after
 * `vite build && vite build --config examples/vite.config.ts` both viewer pages were gone).
 *
 * So the build writes into `dist/.examples-build/`, which it owns outright and may empty, and
 * {@link publishIntoDist} moves the tree into `dist/examples/` afterwards:
 *
 * | Staged                          | Published                                    |
 * | ------------------------------- | -------------------------------------------- |
 * | `<slug>/index.html`             | `examples/<slug>/run/index.html`             |
 * | `assets/**`                     | `examples/assets/**` (merged, not replaced)  |
 * | `assets.manifest.json`          | `examples/assets.manifest.json`              |
 *
 * Nothing about the output layout or the URLs changes: every URL the build writes is absolute under
 * `base`, and `base` does not depend on `outDir`. The staging directory is removed when the move is
 * done, so `dist/` never carries it.
 *
 * ## Chunking
 *
 * Rollup's default chunking is left alone: it hoists Babylon Lite and `@ignifx/*` into shared
 * chunks under `dist/examples/assets/`, so a visitor who opens a second example downloads only
 * that example's own module. `06-engineering.md` §2.4 caps an example's own chunk at 60 KB gzipped
 * and only *records* the shared vendor chunk.
 */

/** The examples' own root; every path below is relative to it. */
const EXAMPLES_ROOT = import.meta.dirname;

/**
 * The staging directory's name.
 *
 * @remarks
 * A caller that overrides `--outDir` has to name a directory with this basename — the publish step
 * derives its destination as the staging directory's `examples` sibling, and refuses anything else
 * rather than guess. `_tools/capture-posters.ts` is the caller that does so.
 */
const STAGING_DIR_NAME = ".examples-build";

/** Where the build writes before {@link publishIntoDist} moves it into place. */
const STAGING_DIR = path.join(EXAMPLES_ROOT, "..", "dist", STAGING_DIR_NAME);

/** The directory the `ignifx()` plugin scans, relative to the Vite root. */
const ASSET_ROOT = "assets";

/**
 * The build's inputs: every catalogue entry that is a kit example.
 *
 * @remarks
 * An entry with a `template` is built from `templates/<name>` by `_tools/build-templates.ts`
 * instead, because a template is a whole Vite project of its own with its own assets, config and
 * front end. Reading the catalogue here rather than globbing is what makes a directory with no
 * entry — or an entry with no directory — a build failure rather than a silent omission.
 *
 * @returns Slug to HTML path, relative to the Vite root.
 */
function inputs(): Record<string, string> {
  const pages: Record<string, string> = {};
  for (const entry of CATALOGUE) {
    if (entry.template === undefined) {
      pages[entry.slug] = path.join(EXAMPLES_ROOT, entry.slug, "index.html");
    }
  }
  return pages;
}

/**
 * Moves one path into another, merging directories rather than replacing them.
 *
 * @remarks
 * `rename` first, because it is atomic and free; a recursive `cp` is the fallback for the one case
 * that cannot rename, which is a destination directory that already has entries in it. `dist/` and
 * the temporary directory `capture-posters.ts` stages into are both single-filesystem, so `EXDEV`
 * is not expected — the `cp` fallback covers it anyway.
 *
 * @param from - The path to move.
 * @param to - Where it should end up.
 */
async function moveInto(from: string, to: string): Promise<void> {
  const [source, target] = await Promise.all([stat(from), stat(to).catch((): null => null)]);
  if (target === null) {
    await mkdir(path.dirname(to), { recursive: true });
    try {
      await rename(from, to);
      return;
    } catch {
      // Falls through to the copy below: a cross-device rename, or a race with another writer.
    }
    await cp(from, to, { recursive: true, force: true });
    await rm(from, { recursive: true, force: true });
    return;
  }
  if (!source.isDirectory() || !target.isDirectory()) {
    await rm(to, { recursive: true, force: true });
    await rename(from, to);
    return;
  }
  // Both are directories and the destination already exists: merge entry by entry, so a poster the
  // site build copied into `dist/examples/` is never in the way.
  const entries = await readdir(from);
  await Promise.all(entries.map((entry: string) => moveInto(path.join(from, entry), path.join(to, entry))));
  await rm(from, { recursive: true, force: true });
}

/**
 * Publishes the staged build into `dist/examples/`, then removes the staging directory.
 *
 * @remarks
 * `closeBundle` rather than `writeBundle`: the whole tree has to be on disk before any of it moves,
 * and `closeBundle` is the hook that runs after the last file is written.
 *
 * @returns The plugin.
 * @throws An `Error` when `outDir`'s basename is not {@link STAGING_DIR_NAME}, because the
 * destination is derived from it and a wrong guess would write into a directory the site owns.
 */
function publishIntoDist(): Plugin {
  let staging = STAGING_DIR;
  return {
    name: "ignifx-examples:publish-into-dist",
    configResolved(config: ResolvedConfig): void {
      staging = config.build.outDir;
    },
    async closeBundle(): Promise<void> {
      if (path.basename(staging) !== STAGING_DIR_NAME) {
        throw new Error(
          `the examples build stages into a directory named "${STAGING_DIR_NAME}" and publishes it ` +
            `into its "examples" sibling; --outDir was "${staging}".`,
        );
      }
      const destination = path.join(path.dirname(staging), "examples");
      // The slugs, from the same catalogue the inputs came from: a directory named after one holds
      // a run page and moves a level deeper, and anything else — `assets/`, the manifest, whatever
      // an extension emitted — keeps its name.
      const slugs = new Set(Object.keys(inputs()));
      for (const entry of await readdir(staging)) {
        const from = slugs.has(entry) ? path.join(staging, entry, "index.html") : path.join(staging, entry);
        const to = slugs.has(entry)
          ? path.join(destination, entry, "run", "index.html")
          : path.join(destination, entry);
        // A handful of entries, moved in order so a failure names the entry it failed on rather
        // than one of several in flight.
        // oxlint-disable-next-line no-await-in-loop -- see above.
        await moveInto(from, to);
      }
      await rm(staging, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  root: EXAMPLES_ROOT,
  // Every run page is served from `/examples/<slug>/run/`, and `@ignifx/vite-plugin` writes its
  // manifest URLs from `resolvedConfig.base`, so the asset table resolves under the sub-path with
  // no special casing (`08-execution.md` §1). `base` does not depend on `outDir`, which is why
  // staging the build somewhere else changes no URL.
  base: "/examples/",
  appType: "mpa",
  build: {
    outDir: STAGING_DIR,
    // This build owns the staging directory outright, so emptying it is right — and it is the one
    // directory in `dist/` that may be emptied, because the site's own output is already there.
    emptyOutDir: true,
    // A game needs top-level await, `using`, and the rest of what Babylon Lite ships; every browser
    // that has WebGPU has all of it.
    target: "esnext",
    // No inline `<script>` anywhere in the output, so the frames' CSP needs no `unsafe-inline` on
    // `script-src` (`06-engineering.md` §2.2). Vite's module-preload polyfill is an inline script.
    modulePreload: false,
    rolldownOptions: { input: inputs() },
  },
  plugins: [
    // `config: false` because there is no `ignifx.config.ts` here: settings are per example and go
    // through `bootExample({ settings })`, which is also what makes each `main.ts` state its own
    // rendering features where a reader can see them.
    ignifx({ assetRoot: ASSET_ROOT, config: false }),
    publishIntoDist(),
  ],
});
