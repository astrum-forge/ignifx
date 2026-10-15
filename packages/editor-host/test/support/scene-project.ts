import { readFileSync } from "node:fs";
import { Component, entityRef, f32, Script, stringifySceneFile, u32 } from "@ignifx/core";
import { startEditorHost } from "../../src/host.js";
import { connect, EDITOR_ORIGIN } from "./editor.js";
import type { EditorPeer, Received } from "./editor.js";
import type { EditorHost } from "../../src/host.js";
import type { Entity, FetchLike, SceneFile } from "@ignifx/core";

/**
 * The project the 0.3 wire fixture's scene belongs to, served to a live headless host: the two
 * scripts it names, the prefab it instances, and the mesh, material and model it references.
 */

/** The fixture's `game/Health`, with the fields its `schemasChanged` describes. */
export class Health extends Component.define({ max: u32(100), regenPerSecond: f32(0) }) {
  static typeId = "game/Health";
}

/** The component the crate prefab carries, whose `mass` the fixture's overrides patch. */
export class CrateBody extends Component.define({ mass: f32(1) }) {
  static typeId = "game/CrateBody";
}

/** A component that points at another entity, for references across ops. */
export class Follow extends Component.define({ target: entityRef<Entity>() }) {
  static typeId = "game/Follow";
}

/** A script whose `awake` throws, for `hostError`. It runs in edit mode, as the scene view is. */
export class Exploder extends Script {
  static typeId = "game/Exploder";

  static runInEditMode = true;

  /** Fails on purpose. */
  awake(): void {
    throw new Error("Exploder.awake: boom.");
  }
}

/** The crate prefab: one root, merged into the instance root, and two children. */
export const CRATE_PREFAB: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "Crate",
  entities: [
    {
      uid: "01M4XQ7K3N8V2D5R0B6G1HT9WS",
      name: "Crate",
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "01M4XQ7K3N8V2D5R0B6G1HT9WT", type: "game/CrateBody", props: { mass: 1 } }],
    },
    {
      uid: "01M4XQ7K3N8V2D5R0B6G1HT9WU",
      name: "Lid",
      parent: "01M4XQ7K3N8V2D5R0B6G1HT9WS",
      transform: { position: [0, 0.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      uid: "01M4XQ7K3N8V2D5R0B6G1HT9WV",
      name: "Base",
      parent: "01M4XQ7K3N8V2D5R0B6G1HT9WS",
      transform: { position: [0, -0.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
};

/** A boot scene, which a test can hold back to keep the app from starting. */
export const BOOT_SCENE = "scenes/boot.scene.json";

/** The project's files, by address. */
const FILES: Readonly<Record<string, string | Uint8Array<ArrayBuffer>>> = {
  "prefabs/crate.prefab.json": stringifySceneFile(CRATE_PREFAB),
  "meshes/ground.mesh.json": JSON.stringify({
    format: "ignifx.mesh",
    formatVersion: 1,
    primitive: "box",
    options: { size: 1 },
  }),
  "materials/grass.material.json": JSON.stringify({
    format: "ignifx.material",
    formatVersion: 1,
    type: "pbr",
    name: "grass",
    baseColor: [0.3, 0.6, 0.2, 1],
    metallic: 0,
    roughness: 0.9,
  }),
  "models/player.glb": new Uint8Array(
    readFileSync(new URL("../../../../tests/fixtures/assets/Box.glb", import.meta.url)),
  ),
  [BOOT_SCENE]: stringifySceneFile({ format: "ignifx.scene", formatVersion: 1, name: "boot", entities: [] }),
};

/** A promise a test settles by hand. */
class Gate {
  /** Settles once {@link Gate.open} is called. */
  readonly promise: Promise<void>;

  #open: (() => void) | null = null;

  /** Creates a closed gate. */
  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.#open = resolve;
    });
  }

  /** Opens the gate; later calls do nothing. */
  open(): void {
    this.#open?.();
  }
}

/** A live host over the fixture project, and the editor's end of its channel. */
export interface LiveHost {
  /** The host, once it has started. */
  readonly host: Promise<EditorHost>;
  /** The editor's end of the channel. */
  readonly wire: Wire;
  /** Lets the boot scene load, so the app starts. */
  release(): void;
  /** Stops pumping frames and disposes everything. */
  dispose(): Promise<void>;
}

/**
 * Starts a headless host over the fixture project and connects an editor to it. The app starts
 * only once `release` is called, so the editor can meet a host whose app is still starting.
 *
 * @returns The host and the editor's end.
 */
export function startLiveHost(): LiveHost {
  const gate = new Gate();
  const fetch: FetchLike = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const address = url.replace(/^.*?assets\//u, "").replace(/^\//u, "");
    if (address === BOOT_SCENE) {
      await gate.promise;
    }
    const body = FILES[address];
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
  };
  const target = new EventTarget();
  const host = startEditorHost({
    editorOrigin: EDITOR_ORIGIN,
    headless: true,
    messageTarget: target,
    engineVersion: "0.9.0",
    heartbeatIntervalMs: 60_000,
    settings: { layers: { layers: ["Default", "Characters"] } },
    scripts: [Health, CrateBody, Follow, Exploder],
    assets: { fetch },
    bootScene: BOOT_SCENE,
  });
  const wire = new Wire(connect(target));
  // A headless app pumps no frames, and after `start()` asset loads settle in `PreUpdate`.
  let pump: ReturnType<typeof setInterval> | null = null;
  void host.then((started) => {
    pump = setInterval(() => {
      if (started.app.isRunning) {
        started.app.step(1 / 60);
      }
    }, 1);
  });
  return {
    host,
    wire,
    release: (): void => {
      gate.open();
    },
    async dispose(): Promise<void> {
      gate.open();
      wire.close();
      const started = await host;
      if (pump !== null) {
        clearInterval(pump);
      }
      started.dispose();
    },
  };
}

/** The editor's end of a channel, keeping the notifications that arrive between answers. */
export class Wire {
  /** Every notification received and not yet taken, in order. */
  readonly notifications: Received[] = [];

  readonly #peer: EditorPeer;

  /**
   * Wraps the editor's end.
   *
   * @param peer - The editor's port.
   */
  constructor(peer: EditorPeer) {
    this.#peer = peer;
  }

  /**
   * Posts a request exactly as given and waits for the message that answers its id.
   *
   * @param request - The request.
   * @returns The answer.
   */
  async request(request: Received): Promise<Received> {
    this.#peer.post(request);
    for (;;) {
      // Messages arrive in order; awaiting them one at a time is the point.
      // oxlint-disable-next-line no-await-in-loop -- see above
      const message = await this.#peer.next();
      if ("id" in message && message["id"] === request["id"]) {
        return message;
      }
      this.notifications.push(message);
    }
  }

  /**
   * Takes the first notification of a method, waiting for it when none has arrived.
   *
   * @param method - The method.
   * @returns The notification.
   */
  async notification(method: string): Promise<Received> {
    for (;;) {
      const index = this.notifications.findIndex((message) => message["method"] === method);
      if (index >= 0) {
        const [found] = this.notifications.splice(index, 1);
        if (found !== undefined) {
          return found;
        }
      }
      // oxlint-disable-next-line no-await-in-loop -- one message at a time
      this.notifications.push(await this.#peer.next());
    }
  }

  /** Closes the editor's port. */
  close(): void {
    this.#peer.close();
  }
}
