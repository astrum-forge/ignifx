import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startEditorHost } from "@ignifx/editor-host";
import { afterEach, describe, expect, it } from "vitest";
import settings from "../../templates/3d-third-person/ignifx.config.js";
import { extensions } from "../../templates/3d-third-person/src/extensions.js";
import { fetchFrom } from "./headless-app.js";
import { THIRD_PERSON, thirdPersonScripts } from "./third-person-app.js";
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

/** The origin the test editor is served from. */
const EDITOR_ORIGIN = "ignifx://app";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** The editor's end of the port: requests by id, notifications kept in order. */
class Editor {
  readonly #port: MessagePort;

  readonly #inbox: Record<string, unknown>[] = [];

  readonly #waiting: (() => void)[] = [];

  #id = 0;

  /**
   * Hands the host a port.
   *
   * @param target - The host's message target.
   */
  constructor(target: EventTarget) {
    const channel = new MessageChannel();
    this.#port = channel.port1;
    this.#port.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
      this.#inbox.push(event.data);
      this.#waiting.splice(0).forEach((wake) => {
        wake();
      });
    });
    this.#port.start();
    target.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "ignifx-editor/connect" },
        origin: EDITOR_ORIGIN,
        ports: [channel.port2],
      }),
    );
  }

  /**
   * Waits for the first message a predicate accepts, and takes it.
   *
   * @param accept - The predicate.
   * @returns The message.
   */
  async take(accept: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    for (;;) {
      const index = this.#inbox.findIndex(accept);
      const found = index >= 0 ? this.#inbox.splice(index, 1)[0] : undefined;
      if (found !== undefined) {
        return found;
      }
      // oxlint-disable-next-line no-await-in-loop -- one message at a time
      await new Promise<void>((resolve) => {
        this.#waiting.push(resolve);
      });
    }
  }

  /**
   * Sends a request and waits for its answer.
   *
   * @param method - The method.
   * @param params - Its parameters.
   * @returns The answer's `result`, or throws its `error`.
   */
  async request(method: string, params: unknown): Promise<unknown> {
    this.#id += 1;
    const id = this.#id;
    // A `MessagePort` has one peer and takes no target origin; the rule is for windows.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- see above.
    this.#port.postMessage({ jsonrpc: "2.0", id, method, params });
    const answer = await this.take((message) => message["id"] === id);
    if ("error" in answer) {
      throw new Error(JSON.stringify(answer["error"]));
    }
    return answer["result"];
  }

  /** Closes the port. */
  close(): void {
    this.#port.close();
  }
}

/**
 * Starts the template's scene view headless and connects an editor to it.
 *
 * @returns The host and the editor, once the host has announced its schemas.
 */
async function sceneView(): Promise<{ readonly host: EditorHost; readonly editor: Editor }> {
  const target = new EventTarget();
  const starting = startEditorHost({
    editorOrigin: EDITOR_ORIGIN,
    headless: true,
    messageTarget: target,
    settings,
    extensions: extensions(),
    scripts: thirdPersonScripts(),
    assets: { fetch: fetchFrom(THIRD_PERSON.assetDir) },
  });
  const editor = new Editor(target);
  await editor.request("hello", { editorVersion: "0.1.0", protocol: { major: 0, minor: 3 } });
  const host = await starting;
  // A headless app pumps no frames, and after `start()` asset loads settle in `PreUpdate`.
  const pump = setInterval(() => {
    host.app.step(1 / 60);
  }, 1);
  cleanups.push(() => {
    clearInterval(pump);
    editor.close();
    host.dispose();
  });
  await editor.take((message) => message["method"] === "schemasChanged");
  return { host, editor };
}

describe("the editor's scene view over 3d-third-person", () => {
  it("opens the level from the document's object and reads every record back as the file has it", async () => {
    const { host, editor } = await sceneView();

    const opened = await editor.request("openScene", { file: FILE, address: MAIN_SCENE });
    expect(opened).toEqual({ entityCount: 49, warnings: [] });
    const sceneOpened = await editor.take((message) => message["method"] === "sceneOpened");
    expect(sceneOpened["params"]).toEqual({ address: MAIN_SCENE, name: FILE.name, entityCount: 49, warnings: [] });

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
