import { exposeIgnifxHost } from "@ignifx/electron/preload";

/**
 * The Electron **preload** script: it runs in the renderer's isolated world before the page loads
 * and hands the page `window.ignifxHost`, the only channel a sandboxed renderer has to the main
 * process (`docs/architecture/14-platform-electron.md` §3).
 *
 * Like `desktop/main.ts`, this is an application entry point, so the call at the bottom runs at
 * import time by design.
 *
 * **This file is built to CommonJS.** A sandboxed preload script cannot be an ES module — with
 * `sandbox: true` an `.mjs` preload leaves `window.ignifxHost` undefined and logs nothing at all —
 * and `CONSTITUTION.md` §9.2 fixes `sandbox: true`. `electron.vite.config.ts` therefore builds this
 * entry with `format: "cjs"` and the file name `index.cjs`.
 */

exposeIgnifxHost();
