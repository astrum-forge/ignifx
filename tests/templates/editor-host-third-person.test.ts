import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import settings from "../../templates/3d-third-person/ignifx.config.js";
import { extensions } from "../../templates/3d-third-person/src/extensions.js";
import { startTemplateSceneView } from "./editor-host-app.js";
import { THIRD_PERSON, thirdPersonScripts } from "./third-person-app.js";
import type { Editor } from "./editor-host-app.js";
import type { SceneFile } from "@ignifx/core";
import type { EditorHost } from "@ignifx/editor-host";

/**
 * The ignifx editor's scene view over `templates/3d-third-person` (ignifx-editor plan ask E16): the
 * host built from the template's own extensions, settings and scripts opens the level from the
 * object the editor sends, and reads every record back as the file has it.
 */

/** The level's address. */
const MAIN_SCENE = "scenes/main.scene.json";

/** The level, as the editor's document holds it. */
const FILE: SceneFile = JSON.parse(readFileSync(join(THIRD_PERSON.assetDir, MAIN_SCENE), "utf8")) as SceneFile;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/**
 * Starts the template's scene view headless and connects an editor to it.
 *
 * @returns The host and the editor, once the host has announced its schemas.
 */
async function sceneView(): Promise<{ readonly host: EditorHost; readonly editor: Editor }> {
  return startTemplateSceneView(
    { settings, extensions: extensions(), scripts: thirdPersonScripts(), assetDir: THIRD_PERSON.assetDir },
    cleanups,
  );
}

describe("the editor's scene view over 3d-third-person", () => {
  it("opens the level from the document's object and reads every record back as the file has it", async () => {
    const { host, editor } = await sceneView();

    const opened = await editor.request("openScene", { file: FILE, address: MAIN_SCENE });
    // A 3D level: the host says so (engine ask E22).
    expect(opened).toEqual({ entityCount: 49, warnings: [], viewMode: "3d" });
    const sceneOpened = await editor.take((message) => message["method"] === "sceneOpened");
    expect(sceneOpened["params"]).toEqual({
      address: MAIN_SCENE,
      name: FILE.name,
      entityCount: 49,
      warnings: [],
      viewMode: "3d",
    });

    const read = await editor.request("readBack", {});
    expect(read).toEqual({ entities: FILE.entities, missing: [], settings: FILE.settings ?? null, issues: [] });
    expect(host.app.world.scenes.map((scene) => scene.name)).toEqual(["default", "editor", FILE.name]);
  });

  it("keeps the editor camera in the persistent editor scene across a reopen", async () => {
    const { host, editor } = await sceneView();
    await editor.request("openScene", { file: FILE, address: MAIN_SCENE });
    const camera = host.editorScene.roots[0];
    await editor.request("openScene", { file: FILE, address: MAIN_SCENE });

    expect(camera?.isDestroyed).toBe(false);
    expect(host.app.world.mainCamera?.entity).toBe(camera);
    expect(await editor.request("select", { entities: [camera?.uid ?? ""] })).toEqual({ entities: [] });
  });
});
