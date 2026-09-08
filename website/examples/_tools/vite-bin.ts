/**
 * Locates Vite's JavaScript entry for a package, so a tool can run it as `node <entry>` instead of
 * spawning `node_modules/.bin/vite`.
 *
 * The `.bin` shim is a POSIX shell script — pnpm writes `vite.CMD` beside it for Windows shells —
 * and `spawn()`ing the script itself on Windows never starts a process that exits: the CI
 * desktop-build job on `windows-latest` hung on it for five minutes on 2026-09-08. Running
 * `process.execPath` on the entry file behaves the same on every platform. `vite/bin/vite.js` is not
 * in Vite's `exports` map, so the path is read from the `bin` field of its `package.json`, resolved
 * from the package directory that will run it (each workspace package may pin its own Vite).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Resolves the absolute path of Vite's command-line entry for one package.
 *
 * @param packageDirectory - The directory whose `node_modules` holds the Vite to run.
 * @returns The absolute path of `vite.js`.
 * @throws When Vite is not installed for that package, or its manifest declares no `bin`.
 */
export function viteEntry(packageDirectory: string): string {
  const require = createRequire(join(packageDirectory, "package.json"));
  const manifest = require.resolve("vite/package.json");
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  const bin = typeof parsed === "object" && parsed !== null && "bin" in parsed ? parsed.bin : undefined;
  const relative =
    typeof bin === "string"
      ? bin
      : typeof bin === "object" && bin !== null && "vite" in bin && typeof bin.vite === "string"
        ? bin.vite
        : undefined;
  if (relative === undefined) {
    throw new Error(`${manifest} declares no "bin" for vite; cannot run Vite for ${packageDirectory}.`);
  }
  return join(dirname(manifest), relative);
}
