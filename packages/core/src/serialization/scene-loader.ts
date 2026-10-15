import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { asJsonArray, asJsonObject } from "./json-view.js";
import { computeSceneHash } from "./scene-asset.js";
import { isSceneFileHeader, SCENE_ASSET_TYPE, SCENE_FILE_EXTENSIONS, SCENE_FORMAT_VERSION } from "./scene-file.js";
import { asSceneFile, validateSceneFile } from "./validate.js";
import type { SceneAsset } from "./scene-asset.js";
import type { SceneFile, SceneFileComponent, SceneFileEntity } from "./scene-file.js";
import type { AssetHandle, AssetLoader, Assets, LoaderContext } from "../assets/types.js";
import type { JsonValue } from "../schema/json.js";

/**
 * Options accepted by {@link createSceneLoader}.
 *
 * @public
 */
export interface SceneLoaderOptions {
  /**
   * `true` (the default) validates every file against the scene format before building anything,
   * reporting `IGX-0608` with the issue list. Production builds may switch it off once the content
   * has been validated at build time by the Vite plugin
   * (`docs/architecture/06-serialization-and-scene-format.md` §8).
   */
  readonly validate?: boolean;
}

/**
 * The `AssetLoader` for `*.scene.json` and `*.prefab.json`
 * (`docs/architecture/06-serialization-and-scene-format.md` §4 steps 1 and 2, ADR-0005 — one
 * loader for levels and prefabs).
 *
 * @remarks
 * The loader does everything the file needs *before* the world sees it: parse, check the header and
 * the format version, validate the structure, then resolve every `$asset` it can find — in
 * `settings`, in every component's `props`, and in every `instance.scene`, recursively through the
 * scene assets those pull in. The resulting `SceneAsset` therefore carries a fully loaded
 * dependency set, which is what makes `world.instantiate` synchronous
 * (`02-scene-graph.md` §2).
 *
 * @param options - Whether to validate.
 * @returns The loader to register with `ctx.registerAssetLoader`.
 *
 * @example
 * ```ts
 * ctx.registerAssetLoader(createSceneLoader());
 * const level = await app.assets.loadAsync<SceneAsset>("levels/level01.scene.json");
 * ```
 *
 * @public
 */
export function createSceneLoader(options?: SceneLoaderOptions): AssetLoader<SceneAsset> {
  const validate = options?.validate ?? true;
  return {
    type: SCENE_ASSET_TYPE,
    extensions: SCENE_FILE_EXTENSIONS,
    async load(ctx: LoaderContext): Promise<SceneAsset> {
      const parsed: unknown = await ctx.fetchJson();
      const file = readSceneFile(parsed, ctx.address, validate);
      const dependencies = await loadDependencies(file, ctx);
      return { address: ctx.address, file, dependencies, hash: await computeSceneHash(file) };
    },
  };
}

/**
 * Checks a parsed file's header, version, and structure.
 *
 * @param parsed - The parsed JSON.
 * @param address - The address, for diagnostics.
 * @param validate - `true` runs the structural validation.
 * @returns The file.
 * @throws IgnifxError with code `IGX-0308` when the header is missing, `IGX-0603` when the format
 * version is not readable, and `IGX-0608` when the structure does not match.
 *
 * @internal
 */
export function readSceneFile(parsed: unknown, address: string, validate: boolean): SceneFile {
  if (!isSceneFileHeader(parsed)) {
    throw new IgnifxError(CoreErrorCode.notASceneFile, `${address} is not an ignifx scene file.`, {
      context: { file: address },
      hint: 'A scene file carries { "format": "ignifx.scene", "formatVersion": 1 }.',
    });
  }
  // Boundary assertion (coding standards §5.2): `isSceneFileHeader` established that the value is a
  // plain object, which is all this read of `formatVersion` needs.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const version = (parsed as Record<string, unknown>)["formatVersion"];
  if (version !== SCENE_FORMAT_VERSION) {
    throw new IgnifxError(
      CoreErrorCode.unsupportedFormatVersion,
      `${address} declares format version ${String(version)}, which this build cannot read.`,
      {
        context: { file: address, version: String(version) },
        hint: `This build reads ignifx.scene version ${String(SCENE_FORMAT_VERSION)}.`,
      },
    );
  }
  if (validate) {
    const issues = validateSceneFile(parsed);
    const first = issues[0];
    if (first !== undefined) {
      throw new IgnifxError(
        CoreErrorCode.sceneFileInvalid,
        `${address} does not match the scene file schema: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
        { context: { file: address, issues: issues.length, first: first.path } },
      );
    }
  }
  return asSceneFile(parsed);
}

/** One asset a scene file references: its address and the type the reference declares. */
interface DependencyRequest {
  /** The address, fragment included. */
  readonly address: string;
  /** The declared asset type, or `null` when the address's extension identifies it. */
  readonly type: string | null;
}

/**
 * Lists every asset the file references, in a stable order: `settings` first, then each entity's
 * `instance.scene`, then each component's `props`
 * (`docs/architecture/06-serialization-and-scene-format.md` §4 step 2).
 *
 * @param file - The parsed file.
 * @returns The references, deduplicated by address, in discovery order.
 */
function dependencyRequests(file: SceneFile): readonly DependencyRequest[] {
  const requests: DependencyRequest[] = [];
  const seen = new Set<string>();
  const add = (address: string, type: string | null): void => {
    if (address === "" || seen.has(address)) {
      return;
    }
    seen.add(address);
    requests.push({ address, type });
  };
  const settings = file.settings;
  if (settings !== undefined) {
    collectAssetRefs(settings, add);
  }
  for (let index = 0; index < file.entities.length; index += 1) {
    const entity = file.entities[index];
    if (entity !== undefined) {
      collectEntityRefs(entity, add);
    }
  }
  return requests;
}

/**
 * Loads every asset the file references through the loader context, which retains each one for
 * the scene asset being loaded.
 *
 * @param file - The parsed file.
 * @param ctx - The loader context.
 * @returns The loaded handles, deduplicated by address, in discovery order.
 */
async function loadDependencies(file: SceneFile, ctx: LoaderContext): Promise<readonly AssetHandle[]> {
  // Every dependency is requested at once and awaited together: the asset service already applies
  // the project's concurrency limit, so serialising here would only make a scene load slower.
  return Promise.all(
    dependencyRequests(file).map(async (request) =>
      ctx.loadDependency(request.address, request.type === null ? undefined : { type: request.type }),
    ),
  );
}

/**
 * Options accepted by {@link loadSceneDependencies}.
 *
 * @public
 */
export interface LoadSceneDependenciesOptions {
  /** Aborts every request; the handles already loaded are released before the promise rejects. */
  readonly signal?: AbortSignal;
}

/**
 * Loads every asset a scene file references — in `settings`, in every component's `props`, and in
 * every `instance.scene`, recursively through the scenes those pull in — the walk the scene loader
 * runs before it builds anything (`docs/architecture/06-serialization-and-scene-format.md` §4
 * step 2).
 *
 * @remarks
 * It is the half of the scene loader a file that is already in memory needs: pass the result to
 * `createSceneAsset` and the asset can be built synchronously with `instantiateScene`. Each handle
 * is returned with one holder, which the caller owns: release them all when the scene they serve
 * is gone. `world.loadSceneFile` does that for a whole scene.
 *
 * @param assets - The asset service to load through, normally `app.assets`.
 * @param file - The scene file.
 * @param options - Cancellation.
 * @returns The loaded handles, deduplicated by address, in the loader's order.
 * @throws Whatever the asset service rejects a load with (an `AssetLoadError`); every handle
 * loaded by then is released first.
 *
 * @example
 * ```ts
 * const dependencies = await loadSceneDependencies(app.assets, file);
 * const asset = await createSceneAsset("memory:scene/draft", file, dependencies);
 * ```
 *
 * @public
 */
export async function loadSceneDependencies(
  assets: Assets,
  file: SceneFile,
  options?: LoadSceneDependenciesOptions,
): Promise<readonly AssetHandle[]> {
  const signal = options?.signal;
  const handles = dependencyRequests(file).map((request) =>
    assets.load<unknown>(request.address, {
      ...(request.type === null ? {} : { type: request.type }),
      ...(signal === undefined ? {} : { signal }),
    }),
  );
  try {
    await Promise.all(handles.map(async (handle) => handle.promise));
  } catch (error) {
    for (let index = 0; index < handles.length; index += 1) {
      handles[index]?.release();
    }
    throw error;
  }
  return handles;
}

/**
 * Collects the asset references of one entity: its `instance.scene` first, so a nested scene is
 * loaded before the props that may name sub-assets of it, then every component's props.
 *
 * @param entity - The entity record.
 * @param add - Called with each address and its declared type.
 */
function collectEntityRefs(entity: SceneFileEntity, add: (address: string, type: string | null) => void): void {
  const instance = entity.instance;
  if (instance !== undefined) {
    add(instance.scene.$asset, instance.scene.type ?? SCENE_ASSET_TYPE);
    const overrides = instance.overrides ?? [];
    for (let index = 0; index < overrides.length; index += 1) {
      const value = overrides[index]?.value;
      if (value !== undefined) {
        collectAssetRefs(value, add);
      }
    }
  }
  const components = entity.components ?? [];
  for (let index = 0; index < components.length; index += 1) {
    const component: SceneFileComponent | undefined = components[index];
    const props = component?.props;
    if (props !== undefined) {
      collectAssetRefs(props, add);
    }
  }
}

/**
 * Walks any JSON and reports every `{ "$asset": … }` it finds, at any depth.
 *
 * @param value - The JSON to walk.
 * @param add - Called with each address and its declared type.
 */
function collectAssetRefs(value: JsonValue, add: (address: string, type: string | null) => void): void {
  const items = asJsonArray(value);
  if (items !== null) {
    for (let index = 0; index < items.length; index += 1) {
      collectAssetRefs(items[index] ?? null, add);
    }
    return;
  }
  const object = asJsonObject(value);
  if (object === null) {
    return;
  }
  const address = object["$asset"];
  if (typeof address === "string") {
    const type = object["type"];
    add(address, typeof type === "string" ? type : null);
    return;
  }
  for (const key of Object.keys(object)) {
    collectAssetRefs(object[key] ?? null, add);
  }
}
