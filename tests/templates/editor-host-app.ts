import { startEditorHost } from "@ignifx/editor-host";
import { fetchFrom } from "./headless-app.js";
import type { ConcreteComponentType, Extension, SettingsInput } from "@ignifx/core";
import type { EditorHost } from "@ignifx/editor-host";

/**
 * The ignifx editor's scene view over a template, headless (ignifx-editor plan asks E16 and E22):
 * a host built from the template's own extensions, settings and scripts, and the editor's end of
 * its port.
 */

/** The origin the test editor is served from. */
const EDITOR_ORIGIN = "ignifx://app";

/** The editor's end of the port: requests by id, notifications kept in order. */
export class Editor {
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

/** What the template's `main.ts` hands `createApp`. */
export interface TemplateSceneViewOptions {
  /** The template's `ignifx.config.ts`. */
  readonly settings: SettingsInput;
  /** The template's `extensions()`. */
  readonly extensions: readonly Extension[];
  /** The template's script classes. */
  readonly scripts: readonly ConcreteComponentType[];
  /** The template's asset directory. */
  readonly assetDir: string;
}

/**
 * Starts a template's scene view headless and connects an editor to it.
 *
 * @param options - The template's settings, extensions, scripts and assets.
 * @param cleanups - Where to register the teardown, run after each test.
 * @returns The host and the editor, once the host has announced its schemas.
 */
export async function startTemplateSceneView(
  options: TemplateSceneViewOptions,
  cleanups: (() => void)[],
): Promise<{ readonly host: EditorHost; readonly editor: Editor }> {
  const target = new EventTarget();
  const starting = startEditorHost({
    editorOrigin: EDITOR_ORIGIN,
    headless: true,
    messageTarget: target,
    settings: options.settings,
    extensions: options.extensions,
    scripts: options.scripts,
    assets: { fetch: fetchFrom(options.assetDir) },
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
