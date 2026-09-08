/**
 * The plugin itself: manifest generation, project-config injection, validation, extension public
 * assets, the virtual modules, and the HMR channel
 * (`docs/architecture/05-assets-and-loading.md` §7, `04-extensions.md` §4–§5,
 * `15-devtools-and-diagnostics.md` §5).
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { assetTypeForAddress, hashedAddress, isSidecarFileName, META_SUFFIX } from "./asset-types.js";
import { VitePluginError, VitePluginErrorCode } from "./errors.js";
import { collectExtensionPublicAssets } from "./extension-assets.js";
import { findIgnifxConfigFile, IGNIFX_CONFIG_DEFINE_KEY, loadIgnifxConfig } from "./ignifx-config.js";
import { addressFromRelativePath, buildManifest, scanAssetRoot, serializeManifest } from "./manifest.js";
import { resolvePluginOptions } from "./options.js";
import { formatValidationProblem, validateJsonAssets } from "./validate.js";
import {
  ASSET_CHANGED_EVENT,
  manifestModuleSource,
  RESOLVED_MANIFEST_MODULE_ID,
  RESOLVED_SCRIPTS_MODULE_ID,
  resolveVirtualModuleId,
  scriptsModuleSource,
} from "./virtual-modules.js";
import type { ExtensionPublicAsset } from "./extension-assets.js";
import type { JsonObject } from "./json.js";
import type { AssetManifest, AssetManifestEntry, ScannedAsset } from "./manifest.js";
import type { IgnifxPluginOptions } from "./options.js";
import type { ValidationProblem } from "./validate.js";
import type { AssetChangedPayload } from "./virtual-modules.js";
import type { ConfigEnv, Plugin, Rollup, ViteDevServer } from "vite";

/**
 * The plugin's name, as it appears in Vite logs and in `PLUGIN_ERROR` diagnostics.
 *
 * @public
 */
export const PLUGIN_NAME = "ignifx";

/** Content types for the file kinds an extension may publish; anything else is served as bytes. */
const CONTENT_TYPES = {
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".js": "text/javascript",
  ".data": "application/octet-stream",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
} as const;

/** What an extension file of an unrecognised kind is served as. */
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Picks the content type for a served extension asset.
 *
 * @param fileName - The file's name.
 * @returns The content type header value.
 */
function contentTypeFor(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  const extension = lastDot === -1 ? "" : fileName.slice(lastDot).toLowerCase();
  for (const [suffix, contentType] of Object.entries(CONTENT_TYPES)) {
    if (suffix === extension) {
      return contentType;
    }
  }
  return DEFAULT_CONTENT_TYPE;
}

/** One file a build writes into the public path. */
interface OutputFile {
  /** The path inside `build.outDir`. */
  readonly fileName: string;
  /** The source file it was read from, recorded so watch mode re-runs on a change. */
  readonly filePath: string;
  /** The bytes to write. */
  readonly source: Uint8Array;
}

/** One extension public asset, with the two manifest fields that need the file read. */
interface DescribedExtensionAsset {
  /** The discovered file. */
  readonly file: ExtensionPublicAsset;
  /** Its size in bytes. */
  readonly bytes: number;
  /** Its last-modified time, so an unchanged file is not read and hashed twice. */
  readonly modifiedMs: number;
  /** The truncated lowercase hex sha256 of its contents. */
  readonly hash: string;
  /** Its contents, kept so the emit does not read the file a second time. */
  readonly source: Uint8Array;
}

/**
 * Whether two byte sequences are identical.
 *
 * @param left - One sequence.
 * @param right - The other.
 * @returns `true` when they have the same length and the same bytes.
 */
function isSameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Renders a caught value for a log line, keeping the `IGX-####` code when there is one.
 *
 * @param error - The caught value.
 * @returns A one-line description.
 */
function describeError(error: unknown): string {
  if (error instanceof VitePluginError) {
    return `${error.code} ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Marks the generated manifest module stale so that importers pick the new one up.
 *
 * @param server - The dev server.
 */
function invalidateManifestModule(server: ViteDevServer): void {
  const module = server.moduleGraph.getModuleById(RESOLVED_MANIFEST_MODULE_ID);
  if (module !== undefined) {
    server.moduleGraph.invalidateModule(module);
  }
}

/**
 * Renders every validation problem as one multi-line build error.
 *
 * @param problems - The problems to report.
 * @returns The message.
 */
function validationFailureMessage(problems: readonly ValidationProblem[]): string {
  const heading = `${String(problems.length)} ignifx asset file${problems.length === 1 ? "" : "s"} failed validation:`;
  return [heading, ...problems.map((problem) => `  ${formatValidationProblem(problem)}`)].join("\n");
}

/**
 * The plugin's own API object, reachable through Vite's `plugin.api`.
 *
 * @remarks
 * Watcher callbacks are synchronous, so the rescan a file change triggers runs detached. Anything
 * that needs to observe the result — a test, or another plugin that reads the served manifest —
 * waits for it here instead of guessing at a delay.
 *
 * @public
 */
export interface IgnifxPluginApi {
  /**
   * Waits until the plugin has finished reacting to every file-system event seen so far.
   *
   * @returns A promise that settles once the queue of watcher work is empty.
   */
  whenIdle(): Promise<void>;
}

/**
 * The ignifx Vite plugin.
 *
 * @remarks
 * What it does, in the order the hooks run:
 *
 * - `config` resolves `ignifx.config.ts` and injects it as `import.meta.env.IGNIFX_CONFIG`
 *   (`docs/architecture/04-extensions.md` §5).
 * - `buildStart` scans the asset root, hashes every file, reads `.meta.json` sidecars, and
 *   validates every format-headed JSON file. A validation failure fails the build.
 * - `virtual:ignifx/manifest` and `virtual:ignifx/scripts` are served from `resolveId`/`load`.
 * - In development the manifest is also served from `/<manifestFileName>`, the asset root is
 *   watched, and every change is announced on the `ignifx:asset-changed` HMR channel; editing the
 *   project config triggers a full reload.
 * - `generateBundle` emits every asset under `<outDir>/<publicPath>` with a content-hashed,
 *   immutable-cacheable name, copies each extension's `ignifx.assets.public` files unhashed next to
 *   them, and writes the manifest with the hashed URLs.
 *
 * @param options - Plugin options and their documented defaults; see {@link IgnifxPluginOptions}.
 * @returns The Vite plugin, to be listed in `vite.config.ts`.
 * @throws A {@link VitePluginError} with code `IGX-0555` when an option is outside its domain.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { ignifx } from "@ignifx/vite-plugin";
 *
 * export default defineConfig({
 *   plugins: [ignifx({ assetRoot: "assets" })],
 * });
 * ```
 *
 * @public
 */
export function ignifx(options: IgnifxPluginOptions = {}): Plugin<IgnifxPluginApi> {
  const settings = resolvePluginOptions(options);

  let root = process.cwd();
  let base = "/";
  let command: ConfigEnv["command"] = "serve";
  let configFilePath: string | null = null;
  let configDependencies: readonly string[] = [];
  let assets: readonly ScannedAsset[] = [];
  let problems: readonly ValidationProblem[] = [];
  let extensionAssets: readonly DescribedExtensionAsset[] = [];
  let scanned = false;
  let pendingWork: Promise<void> = Promise.resolve();
  /**
   * Files already read, keyed by absolute path, so that a dev-server rescan — one per saved asset —
   * does not re-read and re-hash a 2 MB WebAssembly binary that has not changed.
   */
  const describedByPath = new Map<string, DescribedExtensionAsset>();

  /**
   * Rediscovers every extension public asset and reads it.
   *
   * @remarks
   * The bytes are needed twice — once for the manifest entry's `bytes`/`hash`, once for the file
   * the build emits — so they are read here and kept, rather than read once per use.
   *
   * @returns Nothing; the result lands in `extensionAssets`.
   */
  async function refreshExtensionAssets(): Promise<void> {
    const files = await collectExtensionPublicAssets(root);
    extensionAssets = await Promise.all(
      files.map(async (file): Promise<DescribedExtensionAsset> => {
        const info = await stat(file.filePath);
        const cached = describedByPath.get(file.filePath);
        if (cached !== undefined && cached.bytes === info.size && cached.modifiedMs === info.mtimeMs) {
          return cached;
        }
        const source = await readFile(file.filePath);
        const described: DescribedExtensionAsset = {
          file,
          bytes: source.byteLength,
          modifiedMs: info.mtimeMs,
          hash: createHash("sha256").update(source).digest("hex").slice(0, settings.hashLength),
          source,
        };
        describedByPath.set(file.filePath, described);
        return described;
      }),
    );
  }

  /**
   * The absolute asset root.
   *
   * @returns The configured asset root resolved against the Vite root.
   */
  function assetRootPath(): string {
    return resolve(root, settings.assetRoot);
  }

  /**
   * The base URL with a guaranteed trailing slash, so URLs concatenate cleanly.
   *
   * @returns The normalized base.
   */
  function normalizedBase(): string {
    if (base === "") {
      return "/";
    }
    return base.endsWith("/") ? base : `${base}/`;
  }

  /**
   * The development URL of an address.
   *
   * @remarks
   * An asset root inside the Vite root is served by Vite's static handler at its root-relative
   * path. An asset root outside it is served through Vite's `/@fs/` prefix, which is the documented
   * way to reach a file the root does not contain.
   *
   * @param address - The asset address.
   * @returns The URL the dev server serves it from.
   */
  function developmentUrl(address: string): string {
    const relativePath = relative(root, assetRootPath());
    if (relativePath === "") {
      return `${normalizedBase()}${address}`;
    }
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return `${normalizedBase()}@fs${assetRootPath().replaceAll("\\", "/")}/${address}`;
    }
    return `${normalizedBase()}${addressFromRelativePath(relativePath)}/${address}`;
  }

  /**
   * The production URL of an asset, which carries its content hash.
   *
   * @param asset - The scanned asset.
   * @returns The immutable-cacheable URL.
   */
  function productionUrl(asset: ScannedAsset): string {
    return `${normalizedBase()}${settings.publicPath}${hashedAddress(asset.address, asset.hash)}`;
  }

  /**
   * The manifest entry of one extension public asset.
   *
   * @remarks
   * `docs/architecture/05-assets-and-loading.md` §7: the runtime reaches these files through
   * `app.assets.resolveUrl(<file name>)`, and a `resolveUrl` that misses falls back to a
   * **page-relative** `<assetRoot>/<address>` — right at `/`, wrong under any sub-path, and
   * `IGX-0903` when `@ignifx/physics` then fetches it (found by the website's
   * `/examples/<slug>/run/` pages on 2026-09-07). Listing the file makes `resolveUrl` answer with
   * the served URL instead, `resolvedConfig.base` included, exactly as it does for a hashed asset.
   *
   * The address is the bare file name because the copy is unhashed and lands directly in the public
   * path: a WASM loader asks for its companion by name, not by a hashed URL.
   *
   * @param described - The discovered file and its content hash.
   * @returns The entry.
   */
  function extensionEntry(described: DescribedExtensionAsset): AssetManifestEntry {
    const { fileName } = described.file;
    return {
      address: fileName,
      url: `${normalizedBase()}${settings.publicPath}${fileName}`,
      bytes: described.bytes,
      hash: described.hash,
      type: assetTypeForAddress(fileName),
      groups: [],
    };
  }

  /**
   * The manifest for the assets scanned so far plus every extension public asset, with URLs for the
   * current command.
   *
   * @returns The manifest.
   * @throws A {@link VitePluginError} with code `IGX-0552` when a project asset and an extension
   * public asset claim the same manifest address, which would make `resolveUrl` answer arbitrarily.
   */
  function currentManifest(): AssetManifest {
    const scannedManifest = buildManifest(assets, settings.assetRoot, (asset) =>
      command === "build" ? productionUrl(asset) : developmentUrl(asset.address),
    );
    if (extensionAssets.length === 0) {
      return scannedManifest;
    }
    const addresses = new Set(scannedManifest.entries.map((entry) => entry.address));
    for (const described of extensionAssets) {
      if (addresses.has(described.file.fileName)) {
        throw new VitePluginError(
          VitePluginErrorCode.duplicateOutputFile,
          `"${described.file.packageName}" publishes "${described.file.fileName}" and the asset root holds a file ` +
            "with the same address; rename one of them.",
        );
      }
    }
    // `Array.prototype.sort`'s own code-unit order, which is what `scanAssetRoot` sorts addresses
    // with; `localeCompare` would order the merged list by a collation that is a property of the
    // machine, and the manifest has to be byte-identical between two builds of the same tree.
    const entries = [
      ...scannedManifest.entries,
      ...extensionAssets.map((described) => extensionEntry(described)),
    ].toSorted((left, right) => (left.address < right.address ? -1 : left.address > right.address ? 1 : 0));
    return { ...scannedManifest, entries };
  }

  /**
   * Rescans the asset root and revalidates it.
   *
   * @remarks
   * A missing asset root is a warning rather than a failure: a project that has not created
   * `assets/` yet still builds, with an empty manifest.
   *
   * @param warn - Where to send the "no asset root" warning.
   */
  async function refresh(warn: (message: string) => void): Promise<void> {
    // Before the scan, because `currentManifest()` merges the two lists and `load()` bakes the
    // result into `virtual:ignifx/manifest` — the manifest the *bundle* carries — long before
    // `generateBundle` writes `assets.manifest.json`. Populating these only at emit time gave a
    // build whose two manifests disagreed, and the one game code reads was the incomplete one.
    await refreshExtensionAssets();
    try {
      assets = await scanAssetRoot({ assetRoot: assetRootPath(), hashLength: settings.hashLength });
    } catch (error) {
      if (!(error instanceof VitePluginError) || error.code !== VitePluginErrorCode.assetRootMissing) {
        throw error;
      }
      assets = [];
      warn(`${error.code} ${error.message}`);
    }
    problems = settings.validate ? await validateJsonAssets(assets, settings.schemas) : [];
    scanned = true;
  }

  /**
   * Scans once, lazily, for hooks that may run before `buildStart` in some Vite modes.
   *
   * @param warn - Where to send the "no asset root" warning.
   */
  async function ensureScanned(warn: (message: string) => void): Promise<void> {
    if (!scanned) {
      await refresh(warn);
    }
  }

  /**
   * Reports validation problems to a running dev server: once in the terminal, once as the browser
   * error overlay.
   *
   * @param server - The dev server.
   */
  function reportToDevServer(server: ViteDevServer): void {
    if (problems.length === 0) {
      return;
    }
    const message = validationFailureMessage(problems);
    server.config.logger.error(`[${PLUGIN_NAME}] ${message}`, { timestamp: true });
    server.ws.send({ type: "error", err: { message, stack: "", plugin: PLUGIN_NAME } });
  }

  /**
   * Reports whether a changed file is the project config or something it imported.
   *
   * @param file - The absolute path of the changed file.
   * @returns `true` when the change must trigger a full reload.
   */
  function isProjectConfigFile(file: string): boolean {
    if (configFilePath !== null && file === configFilePath) {
      return true;
    }
    return configDependencies.some((dependency) => resolve(root, dependency) === file);
  }

  /**
   * Handles one watcher event under the asset root or on the project config.
   *
   * @param server - The dev server.
   * @param file - The path the watcher reported.
   * @param kind - What happened to the file.
   */
  async function handleWatchEvent(
    server: ViteDevServer,
    file: string,
    kind: AssetChangedPayload["kind"],
  ): Promise<void> {
    const absolute = resolve(file);
    if (isProjectConfigFile(absolute)) {
      server.config.logger.info(`[${PLUGIN_NAME}] project config changed, reloading`, { timestamp: true });
      server.ws.send({ type: "full-reload", path: "*" });
      return;
    }

    const relativePath = relative(assetRootPath(), absolute);
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return;
    }
    let address = addressFromRelativePath(relativePath);
    if (address.split("/").some((segment) => segment.startsWith("."))) {
      return;
    }
    let changeKind = kind;
    if (isSidecarFileName(basename(address))) {
      // A sidecar is metadata for the asset next to it, so the asset is what changed.
      address = address.slice(0, -META_SUFFIX.length);
      changeKind = "changed";
    }

    await refresh((message) => {
      server.config.logger.warn(`[${PLUGIN_NAME}] ${message}`, { timestamp: true });
    });
    invalidateManifestModule(server);

    const payload: AssetChangedPayload = { address, kind: changeKind, url: developmentUrl(address) };
    server.ws.send({ type: "custom", event: ASSET_CHANGED_EVENT, data: payload });
    reportToDevServer(server);
  }

  /**
   * Reads every file a build writes into the public path and checks for name collisions.
   *
   * @remarks
   * Assets are hashed; an extension's `ignifx.assets.public` files are not, because a WASM loader
   * locates its binary by name (`docs/architecture/05-assets-and-loading.md` §7). The reads run
   * together rather than one per emit, so a large asset tree is bounded by the file system rather
   * than by round trips.
   *
   * @returns One entry per file, in emit order.
   * @throws A {@link VitePluginError} with code `IGX-0552` when two files would build to one name.
   */
  async function collectOutputFiles(): Promise<readonly OutputFile[]> {
    const planned = [
      ...assets.map((asset) => ({
        fileName: `${settings.publicPath}${hashedAddress(asset.address, asset.hash)}`,
        filePath: asset.filePath,
        owner: asset.address,
      })),
      ...extensionAssets.map(({ file }) => ({
        fileName: `${settings.publicPath}${file.fileName}`,
        filePath: file.filePath,
        owner: `the public asset of "${file.packageName}"`,
      })),
    ];

    const owners = new Map<string, string>();
    for (const entry of planned) {
      const owner = owners.get(entry.fileName);
      if (owner !== undefined) {
        throw new VitePluginError(
          VitePluginErrorCode.duplicateOutputFile,
          `"${owner}" and ${entry.owner} both build to "${entry.fileName}"; rename one of them.`,
        );
      }
      owners.set(entry.fileName, entry.owner);
    }

    const sources = await Promise.all(planned.map((entry) => readFile(entry.filePath)));
    return planned.map((entry, index) => ({
      fileName: entry.fileName,
      filePath: entry.filePath,
      source: sources[index] ?? new Uint8Array(),
    }));
  }

  /**
   * Folds a bundler-emitted copy of an extension public asset onto the plugin's own unhashed copy.
   *
   * @remarks
   * `@babylonjs/havok`'s ESM build carries a dead
   * `new URL("HavokPhysics.wasm", import.meta.url)` — dead because `@ignifx/physics` always hands
   * Emscripten a `wasmBinary` — and Rollup resolves it, so a build that also gets the plugin's
   * unhashed copy ships the same 2.09 MB twice (measured in `templates/3d-first-person` on
   * 2026-09-08). Neither copy can simply be dropped: the plugin's is the one
   * `Assets.resolveUrl("HavokPhysics.wasm")` and a hand-written `physics({ havokWasm })` name, and
   * the bundler's is the one the chunk references. So the reference is repointed at the plugin's
   * copy and the bundler's is removed, which leaves exactly one file and keeps every URL that
   * already worked working.
   *
   * The match is on **bytes**, not on the file name a bundler happened to choose: two files with
   * the same contents are interchangeable, and anything else risks folding a file that is merely
   * named alike. Only assets the plugin did not emit itself are candidates, so a project asset is
   * never folded away — its manifest entry points at its own hashed URL.
   *
   * @param bundle - The bundle being generated, edited in place.
   */
  function foldBundlerCopies(bundle: Rollup.OutputBundle): void {
    const ours = new Set(extensionAssets.map(({ file }) => `${settings.publicPath}${file.fileName}`));
    const renames = new Map<string, string>();
    for (const [key, output] of Object.entries(bundle)) {
      if (output.type !== "asset" || ours.has(output.fileName) || typeof output.source === "string") {
        continue;
      }
      const source = output.source;
      const match = extensionAssets.find((described) => isSameBytes(described.source, source));
      if (match === undefined) {
        continue;
      }
      renames.set(output.fileName, `${settings.publicPath}${match.file.fileName}`);
      // A bundle is a plain record keyed by file name, and removing the key is how a plugin drops
      // an output (the emitted copy above has already taken its place).
      // oxlint-disable-next-line no-dynamic-delete -- see above.
      delete bundle[key];
    }
    if (renames.size === 0) {
      return;
    }
    for (const output of Object.values(bundle)) {
      if (output.type !== "chunk") {
        continue;
      }
      let code = output.code;
      for (const [from, to] of renames) {
        code = code.split(from).join(to);
      }
      output.code = code;
    }
  }

  /**
   * Subscribes to one watcher event.
   *
   * @remarks
   * Watcher callbacks are synchronous, so the rescan is queued behind the previous one: that keeps
   * two rapid saves from interleaving two scans, and `api.whenIdle()` gives callers something to
   * await instead of a delay (coding standards §8).
   *
   * @param server - The dev server.
   * @param event - The chokidar event to listen for.
   * @param kind - The change kind that event means.
   */
  function watchFor(
    server: ViteDevServer,
    event: "add" | "change" | "unlink",
    kind: AssetChangedPayload["kind"],
  ): void {
    server.watcher.on(event, (file: string) => {
      pendingWork = pendingWork
        .then(() => handleWatchEvent(server, file, kind))
        .catch((error: unknown) => {
          server.config.logger.error(`[${PLUGIN_NAME}] ${describeError(error)}`, { timestamp: true });
        });
    });
  }

  /**
   * Serves the development manifest and the extension public assets.
   *
   * @param server - The dev server.
   */
  function installMiddleware(server: ViteDevServer): void {
    const manifestPath = `${normalizedBase()}${settings.manifestFileName}`;
    const publicPrefix = `${normalizedBase()}${settings.publicPath}`;
    server.middlewares.use((request, response, next) => {
      const url = (request.url ?? "").split("?")[0] ?? "";
      if (url === manifestPath) {
        response.setHeader("Content-Type", "application/json");
        response.end(serializeManifest(currentManifest()));
        return;
      }
      if (url.startsWith(publicPrefix)) {
        const wanted = decodeURIComponent(url.slice(publicPrefix.length));
        const described = extensionAssets.find((candidate) => candidate.file.fileName === wanted);
        if (described !== undefined) {
          response.setHeader("Content-Type", contentTypeFor(described.file.fileName));
          createReadStream(described.file.filePath).pipe(response);
          return;
        }
      }
      next();
    });
  }

  return {
    name: PLUGIN_NAME,
    api: {
      async whenIdle(): Promise<void> {
        let previous = pendingWork;
        await previous;
        while (pendingWork !== previous) {
          previous = pendingWork;
          // Draining a queue is sequential by definition: each await is what lets whatever was
          // enqueued during the previous one settle, so `Promise.all` cannot express it.
          // oxlint-disable-next-line no-await-in-loop -- see above.
          await previous;
        }
      },
    },
    // The virtual modules and the injected config must be visible to every other plugin's
    // transform, so this plugin resolves before the normal tier.
    enforce: "pre",

    async config(userConfig, env) {
      command = env.command;
      root = resolve(process.cwd(), userConfig.root ?? ".");
      const file =
        settings.configFile === false
          ? null
          : settings.configFile === null
            ? await findIgnifxConfigFile(root)
            : resolve(root, settings.configFile);
      const loaded = await loadIgnifxConfig(file, root, env);
      configFilePath = loaded.path;
      configDependencies = loaded.dependencies;
      const projectConfig: JsonObject = loaded.config;
      return { define: { [IGNIFX_CONFIG_DEFINE_KEY]: JSON.stringify(projectConfig) } };
    },

    configResolved(resolvedConfig) {
      root = resolvedConfig.root;
      base = resolvedConfig.base;
      command = resolvedConfig.command;
    },

    async buildStart() {
      await refresh((message) => {
        this.warn(message);
      });
      if (command === "build" && problems.length > 0) {
        this.error(validationFailureMessage(problems));
      }
    },

    resolveId(id) {
      return resolveVirtualModuleId(id);
    },

    async load(id) {
      if (id === RESOLVED_MANIFEST_MODULE_ID) {
        await ensureScanned((message) => {
          this.warn(message);
        });
        return manifestModuleSource(currentManifest());
      }
      if (id === RESOLVED_SCRIPTS_MODULE_ID) {
        // The HMR client is emitted for `vite dev` only, so a production bundle carries neither the
        // accept handler nor an `import.meta.hot` reference
        // (`docs/architecture/15-devtools-and-diagnostics.md` §5).
        return scriptsModuleSource(settings.scriptsPattern, { hot: command !== "build" });
      }
      return null;
    },

    async configureServer(server) {
      installMiddleware(server);

      server.watcher.add(assetRootPath());
      watchFor(server, "add", "added");
      watchFor(server, "change", "changed");
      watchFor(server, "unlink", "removed");

      await refresh((message) => {
        server.config.logger.warn(`[${PLUGIN_NAME}] ${message}`, { timestamp: true });
      });
      reportToDevServer(server);
    },

    async generateBundle(_output, bundle) {
      await ensureScanned((message) => {
        this.warn(message);
      });
      if (problems.length > 0) {
        this.error(validationFailureMessage(problems));
      }

      const outputs = await collectOutputFiles();
      for (const file of outputs) {
        this.emitFile({
          type: "asset",
          fileName: file.fileName,
          originalFileName: file.filePath,
          source: file.source,
        });
      }
      foldBundlerCopies(bundle);

      this.emitFile({
        type: "asset",
        fileName: settings.manifestFileName,
        source: serializeManifest(currentManifest()),
      });
    },
  };
}
