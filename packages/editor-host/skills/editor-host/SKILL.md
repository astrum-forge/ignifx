---
name: editor-host
description: Connects an ignifx project to the ignifx editor with @ignifx/editor-host: the Vite plugin that serves the editor's scene view from the project's own dev server, the virtual:ignifx/editor play controls a game's main.ts hands its app to, and the host half of the editor protocol (hello/ready, ping, heartbeat) over a MessagePort. Use when wiring a project or template for the editor, when the user mentions @ignifx/editor-host, editorHostPlugin, attachEditorPlayControls, virtual:ignifx/editor, startEditorHost or /__ignifx_editor__/, or when debugging why the editor cannot connect to a view.
license: Apache-2.0
metadata:
  ignifx-version: "0.9.0"
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

- Engine: ignifx `0.9.0`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- Peers: `@ignifx/core`; for the `./vite` entry, `@ignifx/vite-plugin` and `vite`.
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
│     owns its app; hostKind "scene"
└── <iframe> play view    http://localhost:<port>/  (the game's own index.html)
      main.ts → attachEditorPlayControls(app)   (virtual:ignifx/editor; a no-op in builds)
      the game owns its app; hostKind "play"

each view ◀── MessagePort ──▶ editor     JSON-RPC 2.0, protocol 0.1
   connect (window message, origin-checked) → hello → ready → ping/pong, heartbeat, play/pause/step/stop
```

The editor posts `{ type: "ignifx-editor/connect" }` with a fresh `MessagePort` to each view on every
`load`. A host takes a port only from `editorOrigin`, replaces its old port whenever a new one
arrives, answers `hello` with `ready` (engine version, protocol, capabilities, host kind), and then
sends a `heartbeat` notification every second so the editor notices a crashed view.

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

| Member                                             | What it does                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `editorHostPlugin(options)` (`/vite`)              | The two Vite plugins: the scene view's page (dev only) and `virtual:ignifx/editor` |
| `attachEditorPlayControls(app)`                    | From `virtual:ignifx/editor`: hands the game's app to the editor; returns a detach |
| `startEditorHost(options)`                         | Starts the scene view's host and its app; resolves to a disposable `EditorHost`    |
| `startEditorPlayControls(app, options)`            | What `attachEditorPlayControls` calls in development                               |
| `EDITOR_CONNECT_MESSAGE_TYPE`                      | The window message that carries the port                                           |
| `PROTOCOL_VERSION`, `RpcErrorCode`, `isRpcMessage` | The protocol 0.1 values and checks, mirrored from `@ignifx/editor-protocol`        |
| `PlayMethod`, `PlayState`                          | `play`, `pause`, `step`, `stop`, and what each answers                             |
| `EditorHostErrorCode`                              | `IGX-1801` bad origin, `IGX-1802` no window, `IGX-1803` bad option                 |

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
    answers.push(event.data);
    if (answers.length === 3) {
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
await done;
console.log(JSON.stringify(answers.at(-1)));

channel.port1.close();
controls.dispose();
app.dispose();
```

## File formats

None. The scene view loads the project's own scene files through the normal loader; the editor's
document model lives in the editor.

## Gotchas

- **List `editorHostPlugin` for `vite build` too** when `main.ts` imports `virtual:ignifx/editor`:
  the build half is what turns it into an empty function. Without the plugin the import does not
  resolve.
- **`editorOrigin` is exact.** It must equal `event.origin` as the browser reports it, with no path or
  trailing slash: `ignifx://app` for the packaged editor, `http://localhost:<port>` for the editor's
  own dev server. A mismatch is silent by design: the host just never connects.
- **Every view reload needs a new port.** A transferred `MessagePort` cannot be posted twice; the
  editor makes a fresh `MessageChannel` on each `load`, and the host closes the previous port.
- **The scene view runs game scripts** until edit mode lands in core; it is a second copy of the game
  in its own app.
- **The engine version is read from the project.** `VERSION` from `@ignifx/core` is `"0.0.0"` in
  unreleased builds, so the plugin reads `@ignifx/core/package.json` and passes `engineVersion`.
- **Script edits reload both views** while `main.ts` imports `src/scripts/**` statically: Vite's one
  module graph sends a full reload to every page when an update reaches a module that does not
  accept it.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`docs/architecture/17-editor-host.md` for the design, the protocol and the security rules ·
`packages/editor-host/api/editor-host.api.md` and `editor-host-vite.api.md` for the exact surface ·
`skills/ignifx/SKILL.md` for the engine.
