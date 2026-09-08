// Builds every catalogue entry that is a template into `website/dist/examples/<name>/run/`, which
// is step 3 of the one site build (`website/plan/08-execution.md` §4.1). It runs after the site
// build and after the examples build, and it is the last thing `pnpm --filter @ignifx/website
// build` does.
//
//   pnpm --filter @ignifx/website exec node examples/_tools/build-templates.ts
//   pnpm --filter @ignifx/website exec node examples/_tools/build-templates.ts 2d-topdown
//
// ## Why a template is not a kit example
//
// A template is a whole Vite project: its own `ignifx.config.ts`, its own `assets/`, its own front
// end, its own physics and audio packages. Rebuilding it as an entry of the examples
// build would mean merging four asset roots and four settings documents into one, and the templates
// would stop being the thing `create-ignifx` copies. So each one is built exactly as it builds for
// a game developer, with two arguments changed:
//
// - `--base /examples/<name>/run/`, so every URL it writes — including the ones
//   `@ignifx/vite-plugin` puts in its asset manifest, which come from `resolvedConfig.base` — is
//   correct under the sub-path;
// - `--outDir <repo>/website/dist/examples/<name>/run`, with `--emptyOutDir` because the directory
//   is outside the template's own root and Vite refuses to empty such a directory otherwise.
//
// Nothing in `templates/**` changes. The run page a template produces is a complete game with its
// own title screen, and it carries **no kit and no bridge**: the viewer's Play/Pause and its live
// figures are inert for a template, which the viewer page has to know (`08-execution.md` §4.3
// applies to kit examples only).
//
// Two arguments are all it takes because every address a template loads goes through the asset
// manifest, which `@ignifx/vite-plugin` writes from `resolvedConfig.base`. A 2D template's sprite
// sheets used to be the exception: they sat in the template's unhashed `public/` directory and its
// atlas documents named them root-relatively (`"image": "/hero.png"`), which resolves only at a
// site's root — so a run page under `/examples/<name>/run/` asked the origin's root for a sheet
// that was not there and its `window.__ignifxReady` resolved `"unsupported"` (measured 2026-09-07
// with `2d-topdown`: three 404s and a dead run page). The sheets now sit beside their documents
// under the asset root and are named relatively, which `@ignifx/2d` resolves through the manifest
// (`packages/2d/src/atlas/loader.ts`, `resolveAtlasImageUrl`), so this script rebases nothing.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { CATALOGUE } from "../catalogue.ts";
import { viteEntry } from "./vite-bin.ts";
import type { ExampleEntry } from "../catalogue.ts";

/** The repository root, three levels above this file. */
const REPO = resolve(import.meta.dirname, "..", "..", "..");

/** Where the site build puts everything. */
const DIST = join(REPO, "website", "dist");

/** How long one template build is given, in milliseconds. A 3D template takes about 20 seconds. */
const BUILD_TIMEOUT_MS = 300_000;

/**
 * Runs one command to completion, inheriting stdio so a build failure is readable.
 *
 * @param command - The executable.
 * @param args - Its arguments.
 * @param cwd - The working directory.
 * @returns A promise that settles when the command exits zero, and rejects otherwise.
 */
function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise<void>((settle, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args.join(" ")} timed out`));
    }, BUILD_TIMEOUT_MS);
    child.on("exit", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        settle();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${String(code)}`));
      }
    });
  });
}

/**
 * Builds one template into its run directory.
 *
 * @param name - The directory name under `templates/`.
 * @returns A promise that settles when the build has written its output.
 */
async function buildTemplate(name: string): Promise<void> {
  const directory = join(REPO, "templates", name);
  const outDir = join(DIST, "examples", name, "run");
  const base = `/examples/${name}/run/`;
  await mkdir(outDir, { recursive: true });
  process.stdout.write(`building templates/${name} → website/dist/examples/${name}/run/\n`);
  // Node on Vite's entry file, not the `.bin` shim: see `vite-bin.ts`.
  await run(
    process.execPath,
    [viteEntry(directory), "build", "--base", base, "--outDir", outDir, "--emptyOutDir"],
    directory,
  );
}

const wanted = process.argv.slice(2);
const templates: readonly string[] = CATALOGUE.filter(
  (entry: ExampleEntry) => entry.template !== undefined && (wanted.length === 0 || wanted.includes(entry.slug)),
).map((entry: ExampleEntry) => entry.template ?? "");

if (templates.length === 0) {
  process.stdout.write(
    wanted.length === 0
      ? "no catalogue entry names a template; nothing to build.\n"
      : `no catalogue entry with a template matches: ${wanted.join(", ")}\n`,
  );
} else {
  for (const name of templates) {
    // One at a time: four concurrent Vite builds measure the machine rather than the templates,
    // and a failure in the middle of a parallel run is much harder to read.
    // oxlint-disable-next-line no-await-in-loop -- see above.
    await buildTemplate(name);
  }
}
