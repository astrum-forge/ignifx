/**
 * Asset hot reload in the scene view (engine ask E23): which changed assets the host reloads in
 * place, how it waits for the new value, and which of the document's instance roots a changed scene
 * or prefab rebuilds (`docs/architecture/17-editor-host.md` §6.1).
 */

import type { DocumentIndex } from "./document.js";
import type { App, AssetHandle } from "@ignifx/core";

/**
 * A change on disk to one asset, as `@ignifx/vite-plugin`'s `ignifx:asset-changed` event reports
 * it; the event's payload is accepted as it is.
 *
 * @beta
 */
export interface EditorAssetChange {
  /** The asset's address, relative to the asset root. */
  readonly address: string;
  /** What happened to the file. */
  readonly kind: "added" | "changed" | "removed";
}

/** The asset type of a scene or prefab file. */
export const SCENE_ASSET_TYPE = "scene";

/**
 * The asset types the host reloads in place. A scene or prefab rebuilds the document's instances
 * of it; the renderers read a model, mesh, material and sprite atlas from their handle every frame,
 * and a shader's materials rebuild on its `onReplaced`. A texture is left out: the materials and
 * atlases built from it keep the texture they were given, which the reload would unload.
 */
export const IN_PLACE_ASSET_TYPES: readonly string[] = [
  SCENE_ASSET_TYPE,
  "model",
  "mesh",
  "material",
  "spriteatlas",
  "shader",
];

/** A pending wait for a reload, which the host settles with `false` when it is disposed. */
export interface PendingReload {
  /** Resolves with `true` once the new value is delivered, `false` when the reload failed. */
  readonly replaced: Promise<boolean>;
  /** Stops waiting and resolves {@link PendingReload.replaced} with `false`. */
  cancel(): void;
}

/**
 * Starts waiting for a handle's next replacement. The assets service reports a failed reload only
 * through `app.onError`, without the address, so any asset failure while waiting ends the wait.
 *
 * @param app - The scene view's app.
 * @param handle - The handle about to be reloaded.
 * @returns The wait.
 */
export function waitForReplacement(app: App, handle: AssetHandle): PendingReload {
  let settle: ((replaced: boolean) => void) | null = null;
  const replaced = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const disconnects: (() => void)[] = [];
  const finish = (value: boolean): void => {
    for (const disconnect of disconnects.splice(0)) {
      disconnect();
    }
    settle?.(value);
  };
  disconnects.push(
    handle.onReplaced.connect((): void => {
      finish(true);
    }),
    app.onError.connect((report): void => {
      if (report.source === "asset") {
        finish(false);
      }
    }),
  );
  return {
    replaced,
    cancel: (): void => {
      finish(false);
    },
  };
}

/**
 * Collects the addresses a scene asset instances, directly or through the scenes it instances.
 *
 * @param app - The scene view's app.
 * @param address - The scene's address.
 * @param into - The addresses found so far; also guards against a cycle.
 * @returns `into`, with `address` and every scene it pulls in added.
 */
function sceneClosure(app: App, address: string, into: Set<string>): Set<string> {
  if (into.has(address)) {
    return into;
  }
  into.add(address);
  const handle = app.assets.get(address);
  if (handle === null || handle.state !== "loaded" || handle.type !== SCENE_ASSET_TYPE) {
    return into;
  }
  const dependencies: unknown = Reflect.get(Object(handle.value), "dependencies");
  if (Array.isArray(dependencies)) {
    for (const dependency of dependencies) {
      const nested: unknown = Reflect.get(Object(dependency), "address");
      if (typeof nested === "string") {
        sceneClosure(app, nested, into);
      }
    }
  }
  return into;
}

/**
 * The document's instance roots built from a scene, directly or through another scene they
 * instance, in document order. A root inside another root of the list is left out: rebuilding the
 * outer one rebuilds it.
 *
 * @param app - The scene view's app.
 * @param index - The open document's index.
 * @param address - The changed scene's address.
 * @returns The roots' uids.
 */
export function instancesOf(app: App, index: DocumentIndex, address: string): readonly string[] {
  const affected = new Set<string>();
  for (const record of index.file.entities) {
    const scene = record.instance?.scene.$asset;
    if (scene !== undefined && sceneClosure(app, scene, new Set()).has(address)) {
      affected.add(record.uid);
    }
  }
  return [...affected].filter((uid) => {
    for (let parent = index.records.get(uid)?.parent ?? null; parent !== null;) {
      if (affected.has(parent)) {
        return false;
      }
      parent = index.records.get(parent)?.parent ?? null;
    }
    return true;
  });
}
