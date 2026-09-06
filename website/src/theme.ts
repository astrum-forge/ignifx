// Loaded as a classic, synchronous `<script src="/theme.js">` in `<head>`, so the stored theme is
// on `<html>` before the first paint. The usual fix for that is an inline script, and the site's
// Content-Security-Policy (`public/_headers`) allows no inline script at all.
//
// It also stamps `data-js="on"`, which is what reveals the controls that do nothing without
// JavaScript (`.js-only` in `src/styles/shell.css`). Nothing else may be imported here: Rollup
// would emit a shared chunk and turn this file into an ES module, which a classic script cannot be.
//
// The website is an application, so the coding standards' no-import-time-side-effects rule does not
// apply to this entry module (the ESLint config records the same exemption for `website/**`).

/** Where the visitor's theme choice lives. A per-viewer convenience, nothing more. */
const STORAGE_KEY = "ignifx-theme";

const root = document.documentElement;
root.dataset["js"] = "on";

try {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") {
    root.dataset["theme"] = stored;
  }
} catch {
  // A private window, or a browser set to block site data. The OS preference still applies.
}
