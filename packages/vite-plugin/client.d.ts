/// <reference types="vite/client" />

/**
 * The ambient environment `@ignifx/vite-plugin` adds to Vite's own. Reference it once per project:
 *
 * ```ts
 * /// <reference types="@ignifx/vite-plugin/client" />
 * ```
 *
 * It declares the injected `import.meta.env.IGNIFX_CONFIG` literal and the two virtual modules the
 * plugin serves, so a game types them without hand-written declarations.
 */

interface ImportMetaEnv {
  /**
   * The resolved `ignifx.config.ts`, injected by `@ignifx/vite-plugin` as a literal; `{}` when the
   * project has no config file.
   */
  readonly IGNIFX_CONFIG: Readonly<Record<string, unknown>>;
}

declare module "virtual:ignifx/manifest" {
  import type { AssetManifest } from "@ignifx/vite-plugin";

  /** The address-to-URL table the plugin built from the asset root. */
  export const manifest: AssetManifest;
}

declare module "virtual:ignifx/scripts" {
  import type { App, ConcreteComponentType } from "@ignifx/core";

  /**
   * Every component class exported by a module under the scripts glob (`src/scripts/**\/*.ts` by
   * default), collected by its `static typeId`; pass it to `app.registerComponents(scripts)`.
   */
  export const scripts: readonly ConcreteComponentType[];

  /**
   * Subscribes the app to script hot reload in development: when a script module changes, the new
   * registry is handed to `app.hotReload.apply(...)`. In a production build this is a no-op.
   *
   * @param app - The running app.
   * @returns A function that unsubscribes.
   */
  export function acceptHotReload(app: App): () => void;
}
