import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import settings from "../../templates/2d-topdown/ignifx.config.js";
import { extensions } from "../../templates/2d-topdown/src/extensions.js";
import { startTemplateSceneView } from "./editor-host-app.js";
import { TOPDOWN, topdownScripts } from "./topdown-app.js";
import type { SceneFile } from "@ignifx/core";

/**
 * The ignifx editor's scene view over `templates/2d-topdown` (ignifx-editor plan ask E22): the host
 * built from the template's own extensions, settings and scripts reports the level as 2D, from the
 * project's `twoD.mode: "sprite"`, so the editor need not guess it from the level's cameras.
 */

/** The level's address. */
const MAIN_SCENE = "scenes/main.scene.json";

/** The level, as the editor's document holds it. */
const FILE: SceneFile = JSON.parse(readFileSync(join(TOPDOWN.assetDir, MAIN_SCENE), "utf8")) as SceneFile;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe("the editor's scene view over 2d-topdown", () => {
  it("opens the level and reports it as a 2D scene", async () => {
    const { editor } = await startTemplateSceneView(
      { settings, extensions: extensions(), scripts: topdownScripts(), assetDir: TOPDOWN.assetDir },
      cleanups,
    );

    const opened = await editor.request("openScene", { file: FILE, address: MAIN_SCENE });
    expect(opened).toEqual({ entityCount: FILE.entities.length, warnings: [], viewMode: "2d" });
    const sceneOpened = await editor.take((message) => message["method"] === "sceneOpened");
    expect(sceneOpened["params"]).toMatchObject({ address: MAIN_SCENE, viewMode: "2d" });
    // A headless view has no 2D editor camera to switch to.
    await expect(editor.request("setViewMode", { mode: "2d" })).rejects.toThrow(/viewMode2d/u);
  });
});
