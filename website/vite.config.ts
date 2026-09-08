import path from "node:path";
import { defineConfig } from "vite";
import { ignifxSite } from "./scripts/site.ts";

// Configuration files are the one place a default export is allowed (coding standards §4).
//
// The site has no HTML entry: `scripts/site.ts` writes every page in `generateBundle`, so Vite's
// HTML pipeline — and the inline module-preload polyfill it injects, which `script-src 'self'`
// would refuse — never runs. Two JavaScript entries are built instead:
//
// - `main`  → `assets/main-<hash>.js`, an ES module that enhances an already-complete page. It
//   dynamically imports `src/viewer.ts`, so Rollup emits the example bridge as its own chunk that
//   only the home page and the viewer pages ever fetch.
// - `theme` → `/theme.js`, deliberately unhashed and import-free so it can be loaded as a classic,
//   synchronous script in `<head>` and apply the stored theme before the first paint.
const websiteRoot = import.meta.dirname;
const repositoryRoot = path.resolve(websiteRoot, "..");

export default defineConfig({
  base: "/",
  appType: "mpa",
  build: {
    target: "es2023",
    // No inline `<script>` anywhere in the output except the JSON-LD block, whose hash the build
    // writes into `script-src`; see `headers.txt`.
    modulePreload: false,
    cssCodeSplit: false,
    // Everything is a real file with a real URL, so `img-src 'self'` covers it.
    assetsInlineLimit: 0,
    rolldownOptions: {
      input: {
        main: path.join(websiteRoot, "src", "main.ts"),
        theme: path.join(websiteRoot, "src", "theme.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "theme" ? "theme.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [ignifxSite(repositoryRoot, websiteRoot)],
});
