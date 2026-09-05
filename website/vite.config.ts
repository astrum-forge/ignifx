import { defineConfig } from "vite";

// Configuration files are the one place a default export is allowed (coding standards §4).
// `server.port` is deliberately unset so the site uses Vite's default development port.
export default defineConfig({
  base: "/",
  build: {
    target: "es2023",
  },
});
