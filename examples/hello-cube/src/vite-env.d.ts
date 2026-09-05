/// <reference types="vite/client" />

/** The environment `@ignifx/vite-plugin` adds to Vite's own. */
interface ImportMetaEnv {
  /**
   * The resolved `ignifx.config.ts`, injected by `@ignifx/vite-plugin` as a literal
   * (`packages/vite-plugin/README.md`, "Project config"). It is `{}` when there is no config file.
   */
  readonly IGNIFX_CONFIG: Readonly<Record<string, unknown>>;
}
