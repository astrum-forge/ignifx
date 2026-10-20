---
name: editor-host
description: Connects an ignifx project to the ignifx editor with @ignifx/editor-host: the Vite plugin that serves the editor's scene view from the project's own dev server, the virtual:ignifx/editor play controls a game's main.ts hands its app to (play, pause, step, stop, playState, playStateChanged, playStats), and the host half of the editor protocol 0.3 over a MessagePort (hello/ready, heartbeat, and the scene document methods openScene, applyOps, readBack, select, pick, frame, setGizmo, setViewMode, screenshot, getSchemas, describeSettings), including the 2D view mode (an editor Camera2D and app.twoD.pickAt picking). Use when wiring a project or template for the editor, when the user mentions @ignifx/editor-host, editorHostPlugin, attachEditorPlayControls, virtual:ignifx/editor, startEditorHost or /__ignifx_editor__/, or when debugging why the editor cannot connect to a view or why the scene view disagrees with the editor's document.
license: Apache-2.0
metadata:
  ignifx-version: "0.10.0"
---

# @ignifx/editor-host

## What this is / when to use

`@ignifx/editor-host` is the part of the ignifx editor that lives **inside a project**. The editor
never bundles the engine: it starts the project's own Vite dev server and shows two pages from it in
frames. The **scene view** is `/__ignifx_editor__/`, a page this package's Vite plugin adds; the
**play view** is the game's own `index.html`. Both use the project's single copy of `@ignifx/core`,
so the editor always runs exactly the engine version and the scripts the project has.

Use it when a project should open in the editor. Game code never calls the host directly: the Vite
plugin generates the scene view's page, and `main.ts` adds one line for the play view. Do not ship it;
production builds contain none of it.

The package is on the engine's version line (install the same version as `@ignifx/core`), not the
editor's, even though its name starts with `editor-`.

## Environment

- Engine: ignifx `0.10.0`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- Peers: `@ignifx/core` and `@babylonjs/lite` (the scene view's gizmos); for the `./vite` entry,
  `@ignifx/vite-plugin` and `vite`.
- A development dependency of the project, at the same version as its `@ignifx/core`.
- Nothing happens at import time; the plugin's generated page module is what starts the host.

```ts ignore-check
// vite.config.ts — the editor passes its own origin when it starts the dev server.
import { ignifx } from "@ignifx/vite-plugin";
import { editorHostPlugin } from "@ignifx/editor-host/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [ignifx(), editorHostPlugin({ editorOrigin: process.env.IGNIFX_EDITOR_ORIGIN ?? "ignifx://app" })],
});
```

| Option                | Default                | Meaning                                                                     |
| --------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `editorOrigin`        | required               | The editor's origin; the only one that may frame the scene view or connect  |
| `extensions`          | `"/src/extensions.ts"` | Module exporting `extensions()`; the scene view uses `[]` when it is absent |
| `bootScene`           | none                   | A scene address the scene view loads before it starts                       |
| `heartbeatIntervalMs` | `1000`                 | Milliseconds between `heartbeat` notifications in both views                |

Add `/// <reference types="@ignifx/editor-host/client" />` beside `@ignifx/vite-plugin/client` so
`virtual:ignifx/editor` is typed.

## Mental model

```
editor window (ignifx://app)
├── <iframe> scene view   http://127.0.0.1:<port>/__ignifx_editor__/
│     generated module → startEditorHost({ extensions(), scripts, settings, manifest })
│     owns its app, in edit mode; hostKind "scene"
│     world: the open document's scene  +  a persistent "editor" scene (camera, never saved)
└── <iframe> play view    http://localhost:<port>/  (the game's own index.html)
      main.ts → attachEditorPlayControls(app)   (virtual:ignifx/editor; a no-op in builds)
      the game owns its app; hostKind "play"

each view ◀── MessagePort ──▶ editor     JSON-RPC 2.0, protocol 0.3
   connect (window message, origin-checked) → hello → ready → ping/pong, heartbeat
   scene view: schemasChanged → openScene → applyOps… / readBack / select / pick / frame / setGizmo / screenshot
               / setViewMode / getSchemas / describeSettings (on request only)
               ← sceneOpened, selectionChanged, transformDragging/Dragged, hotReloaded, assetReloaded,
                 hostError, log
   play view:  play / pause / step / stop / playState / playStats
               ← playStateChanged, log, hostError, hotReloaded (logRelay; kept from before hello)
```

The editor posts `{ type: "ignifx-editor/connect" }` with a fresh `MessagePort` to each view on every
`load`. A host takes a port only from `editorOrigin`, replaces its old port whenever a new one
arrives, answers `hello` with `ready` (engine version, protocol, capabilities, host kind), and then
sends a `heartbeat` notification every second so the editor notices a crashed view. The play view's
module listens as soon as it is evaluated and keeps the port until `attachEditorPlayControls(app)`
runs, so a port posted while `main.ts` awaits `createApp` is not lost. Under `vite dev` both views
carry `Content-Security-Policy: frame-ancestors <editorOrigin>`.

The editor owns the scene document; the scene view mirrors it. `openScene` sends the whole file
object (it may hold unsaved edits) and the host builds it with `world.loadSceneFile`, keeping the
file's uids. Every command the editor applies to its document goes to the host as `applyOps`, the
same ops; any failure means the mirror drifted, and the editor resends `openScene`. What the user
does in the view comes back as notifications (`selectionChanged`, `transformDragged`) that the
editor turns into commands. The host never edits the document. When a script's hot reload changes a
field's default, the host gives the field its new default wherever the document leaves it out, and
keeps the values and overrides the document sets (`hotReloadDefaults`), so the editor need not
reopen the scene.

## First app

A headless scene-view host and the editor's side of the handshake, in one Node program. An
`EventTarget` stands in for the frame's `window`.

```ts run
import { EDITOR_CONNECT_MESSAGE_TYPE, PROTOCOL_VERSION, startEditorHost } from "@ignifx/editor-host";

const frameWindow = new EventTarget();
const host = await startEditorHost({ editorOrigin: "ignifx://app", headless: true, messageTarget: frameWindow });

// The editor's side: a fresh channel, with one end posted to the view's window.
const channel = new MessageChannel();
frameWindow.dispatchEvent(
  new MessageEvent("message", {
    data: { type: EDITOR_CONNECT_MESSAGE_TYPE },
    origin: "ignifx://app",
    ports: [channel.port2],
  }),
);

const ready = await new Promise<unknown>((resolve) => {
  channel.port1.onmessage = (event: MessageEvent): void => {
    resolve(event.data);
  };
  channel.port1.postMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "hello",
    params: { editorVersion: "0.1.0", protocol: PROTOCOL_VERSION },
  });
});
console.log(JSON.stringify(ready));

channel.port1.close();
host.dispose();
```

## Core APIs

`skills/ignifx/references/api/editor-host.md` and `editor-host-vite.md` have the generated surface.

| Member                                                               | What it does                                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `editorHostPlugin(options)` (`/vite`)                                | The two Vite plugins: the scene view's page (dev only) and `virtual:ignifx/editor`                                                 |
| `attachEditorPlayControls(app)`                                      | From `virtual:ignifx/editor`: hands the game's app to the editor; returns a detach                                                 |
| `startEditorHost(options)`                                           | Starts the scene view's host and its edit-mode app; resolves to a disposable `EditorHost`                                          |
| `listenForEditorPlayControls(options)`                               | What `virtual:ignifx/editor` calls in development: keeps the editor's port until `attach(app)` starts the controls on it           |
| `startEditorPlayControls(app, options)`                              | The play controls on their own, listening from the call                                                                            |
| `EDITOR_CONNECT_MESSAGE_TYPE`, `isEditorConnectMessage`              | The window message that carries the port, and its check                                                                            |
| `PROTOCOL_VERSION`, `RpcErrorCode`, `isRpcMessage`, `isPlayState`    | The protocol 0.3 values and checks, mirrored from `@ignifx/editor-protocol`; before 1.0 the major and minor must both match        |
| `SceneMethod`, `SceneNotification`, `SceneOp`, `isApplyOpsParams`, … | The scene document methods, notifications, the thirteen ops, and their guards                                                      |
| `EditorHost.editorScene`                                             | The persistent `editor` scene instance holding the host's own objects                                                              |
| `EditorHost.assetChanged(change)`                                    | Reloads an asset changed on disk in place and sends `assetReloaded`; the generated page calls it on `ignifx:asset-changed`         |
| `PlayMethod`, `PlayState`                                            | `play`, `pause`, `step`, `stop`, and what each answers; `playState` reads the state without changing it                            |
| `PlayNotification`, `PlayPhase`, `isPlayStateReport`                 | `playStateChanged` and `playState`'s `{ state: "playing" \| "paused" \| "stopped", frameCount, time }`                             |
| `PlayStats`, `isPlayStats`                                           | `playStats`'s `{ fps, frameTimeMs, entityCount, frameCount }`: the newest second of `app.diagnostics` frames, the world's entities |
| `HostCapability.hotReloadDefaults`                                   | The scene view gives fields the document leaves out their new default after a script's hot reload                                  |
| `HostCapability.logRelay`, `isAppErrorData`, `LoggedError`           | Both views relay `log` (with the first `Error` a line carries), `hostError` (entity, component, phase, stack) and `hotReloaded`    |
| `EditorHostErrorCode`                                                | `IGX-1801` bad origin, `IGX-1802` no window, `IGX-1803` bad option                                                                 |

## Recipes

### Hand the game to the play controls

```ts ignore-check
// src/main.ts, after createApp and registerComponents.
import { attachEditorPlayControls } from "virtual:ignifx/editor";
import { acceptHotReload } from "virtual:ignifx/scripts";

acceptHotReload(app);
attachEditorPlayControls(app);
```

In `vite build` the import is an empty function, so the same `main.ts` ships with no editor code.

### Share the extension list with the scene view

```ts
// src/extensions.ts — main.ts passes `extensions: extensions()` to createApp too.
import type { Extension } from "@ignifx/core";

export function extensions(): Extension[] {
  return [];
}
```

### Drive the play view

```ts run
import { createApp } from "@ignifx/core";
import { EDITOR_CONNECT_MESSAGE_TYPE, PROTOCOL_VERSION, startEditorPlayControls } from "@ignifx/editor-host";

const app = await createApp({ headless: true });
const pageWindow = new EventTarget();
const controls = startEditorPlayControls(app, { editorOrigin: "ignifx://app", messageTarget: pageWindow });

const channel = new MessageChannel();
pageWindow.dispatchEvent(
  new MessageEvent("message", {
    data: { type: EDITOR_CONNECT_MESSAGE_TYPE },
    origin: "ignifx://app",
    ports: [channel.port2],
  }),
);
const answers: unknown[] = [];
const done = new Promise<void>((resolve) => {
  channel.port1.onmessage = (event: MessageEvent): void => {
    // Answers carry their request's id; `heartbeat` and `playStateChanged` do not.
    if (typeof event.data === "object" && event.data !== null && "id" in event.data) {
      answers.push(event.data);
    }
    if (answers.length === 4) {
      resolve();
    }
  };
});
const send = (id: number, method: string, params?: object): void => {
  // JSON-RPC allows `params` to be absent, but not `undefined`.
  channel.port1.postMessage({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
};
send(1, "hello", { editorVersion: "0.1.0", protocol: PROTOCOL_VERSION });
send(2, "play");
send(3, "step", { deltaSeconds: 1 / 60 });
send(4, "playState");
await done;
console.log(JSON.stringify(answers.at(-1)));

channel.port1.close();
controls.dispose();
app.dispose();
```

### Open a scene document in the scene view

```ts run
import { EDITOR_CONNECT_MESSAGE_TYPE, PROTOCOL_VERSION, startEditorHost } from "@ignifx/editor-host";

const frameWindow = new EventTarget();
const host = await startEditorHost({ editorOrigin: "ignifx://app", headless: true, messageTarget: frameWindow });
const channel = new MessageChannel();
frameWindow.dispatchEvent(
  new MessageEvent("message", {
    data: { type: EDITOR_CONNECT_MESSAGE_TYPE },
    origin: "ignifx://app",
    ports: [channel.port2],
  }),
);

// Answers by id; notifications (heartbeat, schemasChanged, sceneOpened, log) are skipped here.
const waiting = new Map<number, (result: unknown) => void>();
channel.port1.onmessage = (event: MessageEvent<{ id?: number; result?: unknown; error?: unknown }>): void => {
  const { id } = event.data;
  if (id !== undefined) {
    waiting.get(id)?.(event.data.result ?? event.data.error);
  }
};
let nextId = 0;
const request = async (method: string, params: unknown): Promise<unknown> => {
  nextId += 1;
  const id = nextId;
  const answer = new Promise<unknown>((resolve) => waiting.set(id, resolve));
  channel.port1.postMessage({ jsonrpc: "2.0", id, method, params });
  return answer;
};

await request("hello", { editorVersion: "0.1.0", protocol: PROTOCOL_VERSION });
const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const file = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "level01",
  entities: [{ uid: "01J9Z6M7E5S3A0V2Q4R8T1Y6WX", name: "Player", parent: null, transform }],
};
console.log(JSON.stringify(await request("openScene", { file, address: null })));
await request("applyOps", {
  ops: [{ op: "setEntityField", entity: "01J9Z6M7E5S3A0V2Q4R8T1Y6WX", field: "name", value: "Hero" }],
  commandName: "Rename Player",
  commandId: "cmd-1",
});
console.log(JSON.stringify(await request("readBack", {})));

channel.port1.close();
host.dispose();
```

## File formats

None of its own. The scene view builds the editor's scene document (`ignifx.scene`) from the file
object `openScene` sends, through `world.loadSceneFile`; `readBack` answers with the records
`serializeScene` writes.

## Gotchas

- **List `editorHostPlugin` for `vite build` too** when `main.ts` imports `virtual:ignifx/editor`:
  the build half is what turns it into an empty function. Without the plugin the import does not
  resolve.
- **`editorOrigin` is exact.** It must equal `event.origin` as the browser reports it, with no path or
  trailing slash: `ignifx://app` for the packaged editor, `http://localhost:<port>` for the editor's
  own dev server. A mismatch is silent by design: the host just never connects.
- **Every view reload needs a new port.** A transferred `MessagePort` cannot be posted twice; the
  editor makes a fresh `MessageChannel` on each `load`, and the host closes the previous port.
- **The scene view runs in edit mode** (`createApp({ editMode: true })`, ADR-0028): a script gets no
  callback unless its class sets `static runInEditMode = true`, and physics does not step. Pass
  `editMode: false` to `startEditorHost` to run it as a second copy of the game. The play view is the
  game's own app and is never in edit mode.
- **The engine version is read from the project.** `VERSION` from `@ignifx/core` is `"0.0.0"` when
  core runs from source rather than its build, so the plugin reads `@ignifx/core/package.json` and
  passes `engineVersion`; the host prefers a stamped `VERSION`.
- **Script edits reload both views** while `main.ts` imports `src/scripts/**` statically: Vite's one
  module graph sends a full reload to every page when an update reaches a module that does not
  accept it.
- **Scene methods answer `notReady` until the app has started.** The host answers `hello` at once;
  its first `schemasChanged` is the cue that `openScene` and the rest are accepted. `applyOps`,
  `readBack` and `frame` answer `noScene` while no scene is open.
- **The scene view keeps the project's `rendering.msaaSamples`.** The gizmos and the outline draw in
  core's render overlay (`app.renderer.openOverlay()`), which works at every MSAA setting.
- **A headless host lists only `heartbeat`.** Without a canvas there are no gizmos, no `screenshot`,
  and every `pick` misses without a `ray`; `setGizmo` and `screenshot` then answer `methodNotFound`. In headless
  tests, asset loads after `start()` settle only when something calls `app.step()`.
- **A `pick` carries the camera ray, hit or miss.** On a canvas the answer adds
  `ray: { origin, direction }` (world space, from the editor camera's `screenToRay` at the converted
  backing pixel) and, when the ray crosses `z = 0` ahead of the camera, `plane: [x, y, 0]`. A 3D
  editor drops an asset where `ray` meets `y = 0`; a 2D one uses `plane`.
- **The 2D view mode needs a canvas, not a dependency.** On a canvas the host lists `viewMode2d` and
  `pick2d`. `openScene` and `sceneOpened` report `viewMode`: `"2d"` for `twoD.mode: "sprite"` or a
  scene whose cameras are all `Camera2D`. `setViewMode { mode: "2d" }` enables the host's own
  `Camera2D` (priority 1 000 000) and makes the 3D editor camera orthographic over the same
  rectangle; the level's `Camera2D` is never changed. In 2D mode `frame` fits sprite quads and
  tilemaps, and `pick` and clicks use `app.twoD.pickAt` (unpickable sprites included): a hit's
  `point` is on `z = 0` and its `distance` is `null`. The host finds `app.twoD` and the 2D classes
  by name, so a project without `@ignifx/2d` still gets an orthographic 2D view of its meshes.
- **Settings over the protocol.** `describeSettings` answers `{ sections, values }`: core's
  `describeSettings(app)` with each section's `settingsJsonSchema` entry as `propsSchema`, and the
  values the app resolved, in the settings form (`{ x, y, z }`, `{ r, g, b, a }`). No notification
  announces settings; ask again after the project's settings change.
- **A changed asset reloads in place, not the view.** The scene view's page hands every
  `ignifx:asset-changed` event to `host.assetChanged`, which calls `app.assets.reload(address)` for an
  asset the app has loaded, of type `scene` (a scene or prefab), `model`, `mesh`, `material`,
  `spriteatlas` or `shader`. A changed prefab rebuilds the document's instances of it, directly or
  through another prefab, with their uids, transforms, overrides and document children; `readBack`
  then writes the new prefab's hash. The host sends `assetReloaded { address, type, entities }`
  (the rebuilt instance roots) once the new value is in. A texture, a removed file and the open
  document's own file are left alone and send nothing.
- **Document uids only.** Members of an instanced prefab and the editor's own entities never appear
  in a selection, a pick or `readBack`; a pick on a prefab member resolves to its instance root.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`docs/architecture/17-editor-host.md` for the design, the protocol and the security rules ·
`packages/editor-host/api/editor-host.api.md` and `editor-host-vite.api.md` for the exact surface ·
`skills/ignifx/SKILL.md` for the engine.
