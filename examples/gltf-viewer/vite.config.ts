import { ignifx } from "@ignifx/vite-plugin";
import { defineConfig } from "vite";

// The three fixtures this example loads are the repository's shared samples. Pointing `assetRoot`
// at them keeps one copy of each binary in the tree (`tests/fixtures/assets/ATTRIBUTION.md`); the
// plugin serves them over `@fs` in development and copies them into `dist/assets/` on a build.
export default defineConfig({
  plugins: [ignifx({ assetRoot: "../../tests/fixtures/assets" })],
  build: { target: "esnext" },
});
