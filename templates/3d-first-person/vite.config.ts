import { ignifx } from "@ignifx/vite-plugin";
import { defineConfig } from "vite";

// The example ships no assets of its own; the plugin is here for `ignifx.config.ts` injection and
// so the file reads the way a real project's does.
export default defineConfig({
  plugins: [ignifx()],
  build: { target: "esnext" },
});
