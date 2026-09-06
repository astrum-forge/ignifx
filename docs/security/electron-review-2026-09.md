# Electron security review — September 2026

**Date:** 2026-09-07 · **Reviewer:** hardening wave 1 · **Electron:** 44.2.0 (pinned, `catalog:`)
**Scope:** `packages/electron/**`, `templates/*/desktop/**`, `templates/*/electron-builder.yml`,
`templates/*/electron.vite.config.ts`
**Spec:** `CONSTITUTION.md` §9 · `docs/architecture/14-platform-electron.md` §3 ·
`docs/adr/0018-electron-tooling.md`
**Runtime evidence:** `tests/visual/tests/desktop.spec.ts` (12 tests, macOS 15 / Darwin 25.5.0,
arm64, Apple `metal-3` adapter — all passing on 2026-09-07)

Every Electron API named below was checked against
`node_modules/.pnpm/electron@44.2.0_supports-color@8.1.1/node_modules/electron/electron.d.ts`, and
the line numbers cited are that file's. Nothing here is from memory or from Electron's prose docs.

---

## 1. Summary

| Verdict         | Count |
| --------------- | ----- |
| ok              | 25    |
| fixed           | 10    |
| accepted risk   | 8     |
| **Total items** | 43    |

Nothing found was remotely exploitable in a shipped game today: the renderer is sandboxed, loads one
document from a private scheme, has no network origins in its policy, and holds no credentials. The
ten fixes close _reachability_ gaps — a guard that did not cover every path in, a check whose
comparison could not distinguish the values it compared, and handlers that acted for any caller.

Two of the ten were real defects rather than defence in depth; two more (items 9 and 10) change no
behaviour at all and only write down a default, so that a future change to it is a diff. The two
defects:

- **`lockNavigation`'s origin comparison was inert for the packaged app.** It compared
  `new URL(url).origin`, and `ignifx` is not a _special_ scheme to the WHATWG URL parser, so every
  `ignifx://…` URL has the opaque origin `"null"` — including the window's own. `"null" === "null"`
  passed, so a navigation to any `ignifx://<authority>/…` was permitted.
- **The `ignifx://` handler served every authority.** `protocol.handle` is registered per _scheme_,
  so `ignifx://evil/index.html` reached the handler and was served the packaged files from a second
  Chromium origin — one for which `'self'` in the Content-Security-Policy would have meant that
  origin, not the game's.

Together those two turned into: a page could navigate itself to `ignifx://evil/index.html` and get a
second, same-content origin outside the one the rest of the hardening names. Both are now refused,
and the refusals are asserted in the unit suite and against a real Electron process.

---

## 2. Checklist

`file:line` is the line in this repository at the time of the review.

### 2.1 Renderer process isolation

| #   | Setting                       | Where                                                                                   | Value   | Verdict   |
| --- | ----------------------------- | --------------------------------------------------------------------------------------- | ------- | --------- |
| 1   | `contextIsolation`            | `packages/electron/src/main/window.ts:171`                                              | `true`  | ok        |
| 2   | `sandbox`                     | `packages/electron/src/main/window.ts:172`                                              | `true`  | ok        |
| 3   | `nodeIntegration`             | `packages/electron/src/main/window.ts:173`                                              | `false` | ok        |
| 4   | `nodeIntegrationInWorker`     | `packages/electron/src/main/window.ts:174`                                              | `false` | ok        |
| 5   | `nodeIntegrationInSubFrames`  | `packages/electron/src/main/window.ts:175`                                              | `false` | ok        |
| 6   | `webSecurity`                 | `packages/electron/src/main/window.ts:176`                                              | `true`  | ok        |
| 7   | `allowRunningInsecureContent` | `packages/electron/src/main/window.ts:177`                                              | `false` | ok        |
| 8   | `experimentalFeatures`        | `packages/electron/src/main/window.ts:178`                                              | `false` | ok        |
| 9   | `enableBlinkFeatures`         | `packages/electron/src/main/window.ts:182`                                              | `""`    | **fixed** |
| 10  | `enableWebSQL`                | `packages/electron/src/main/window.ts:185`                                              | `false` | **fixed** |
| 11  | `webviewTag`                  | `packages/electron/src/main/window.ts:186`                                              | `false` | ok        |
| 12  | `remote` module               | not enabled anywhere; `@electron/remote` is not a dependency of any package or template | absent  | ok        |

**9 — `enableBlinkFeatures` (`electron.d.ts` 19410).** Was absent, which means Chromium's default
(empty). Stating `""` makes "no experimental Blink features" a reviewable line rather than a default
somebody has to go and look up, and turns a future accidental addition into a diff. Behaviour
unchanged.

**10 — `enableWebSQL` (`electron.d.ts` 19427).** Was absent. Electron's own security warnings check
this value (`electron.d.ts` 20521 lists it beside `nodeIntegrationInSubFrames`). WebSQL is a removed
web API with a history of memory-safety bugs and no game uses it.

**Enforcement.** All eleven live in one frozen record, `ENFORCED_WEB_PREFERENCES`
(`packages/electron/src/main/window.ts:157`), which `windowOptionsFor` spreads **after** the
caller's own object (`:246`), so a caller cannot weaken one by passing its opposite —
`test/security.test.ts` offers every key as its opposite and asserts none of it lands. The running
window's resolved values are read back through `getLastWebPreferences()` in
`tests/visual/tests/desktop.spec.ts:253`, so the pure builder and the real window are pinned to each
other.

### 2.2 Content-Security-Policy

| #   | Item                            | Where                                      | Value                                                                              | Verdict       |
| --- | ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- | ------------- |
| 13  | Delivery                        | `packages/electron/src/main/window.ts:304` | response header via `session.webRequest.onHeadersReceived` (`electron.d.ts` 19657) | ok            |
| 14  | Packaged policy                 | `packages/electron/src/main/csp.ts:147`    | see below                                                                          | ok            |
| 15  | `script-src` never `'unsafe-*'` | `packages/electron/src/main/csp.ts:155`    | `'self' 'wasm-unsafe-eval'`                                                        | ok            |
| 16  | `style-src 'unsafe-inline'`     | `packages/electron/src/main/csp.ts:173`    | allowed                                                                            | accepted risk |
| 17  | Development widening            | `packages/electron/src/main/csp.ts:149`    | dev-server origin in `script-src` when `mode: "development"`                       | accepted risk |

The packaged policy, verbatim:

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:;
connect-src 'self' data: blob:; worker-src 'self' blob:; child-src 'none'; object-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; manifest-src 'self'
```

A header rather than a `<meta>` tag for two reasons that are properties of the mechanism:
`frame-ancestors` is ignored in a `<meta>` policy by specification, and a `<meta>` policy only
applies from the point the parser reaches it. The listener **replaces** any policy the response
already carried rather than appending one (`window.ts:305–315`), because two
`Content-Security-Policy` headers intersect and the effective policy would be something no single
file states.

Asserted against a real window: `tests/visual/tests/desktop.spec.ts:348` fetches `index.html`,
reads the header back, and then appends an inline `<script>` and asserts it did not run.

**16 — `style-src 'unsafe-inline'`, accepted.** `@ignifx/ui` installs its stylesheet as a `<style>`
element and every template's `index.html` carries one. Inline **styles** cannot execute script under
this policy — `script-src` does not list `'unsafe-inline'` — so the exposure is CSS injection in a
page with no untrusted HTML in it. Removing it needs per-element nonces threaded through the UI
package; that is a design change, not a hardening step, and is out of scope here.

**17 — the development policy, accepted.** `cspValueFor` picks a development policy only when
`entry` is an `http(s):` URL, which is only true under `electron-vite dev`; a packaged build takes
the production branch and `cspFor({ mode: "production", devServerOrigin: … })` ignores the origin
outright (`csp.ts:149`, asserted at `test/security.test.ts:146`). The dev server is the developer's
own machine. `csp: null` is available and means _no policy at all_ — that is documented on the
option and in the skill, and it is the game's own decision.

### 2.3 Navigation and window opening

| #   | Item                   | Where                                      | Value                                | Verdict   |
| --- | ---------------------- | ------------------------------------------ | ------------------------------------ | --------- |
| 18  | `setWindowOpenHandler` | `packages/electron/src/main/window.ts:422` | `{ action: "deny" }` unconditionally | ok        |
| 19  | `will-navigate`        | `packages/electron/src/main/window.ts:428` | blocked off the window's origin      | **fixed** |
| 20  | `will-redirect`        | `packages/electron/src/main/window.ts:429` | blocked off the window's origin      | **fixed** |
| 21  | `will-frame-navigate`  | `packages/electron/src/main/window.ts:430` | blocked off the window's origin      | **fixed** |
| 22  | `will-attach-webview`  | `packages/electron/src/main/window.ts:431` | `preventDefault()`                   | **fixed** |

**19 — the origin comparison was inert.** `lockNavigation` compared `new URL(url).origin` against
`new URL(entryUrl).origin`. Measured on Node 25.2.1, both are the string `"null"` for any
`ignifx://` URL, because `ignifx` is not one of the WHATWG parser's _special_ schemes — so the check
passed for `ignifx://anything/…`. It still blocked `https://`, which is why nothing observable was
wrong. The comparison now runs through `originOfUrl`
(`packages/electron/src/main/origin.ts:43`), which rebuilds the tuple from `protocol` and `host` and
returns `null` — a refusal — for every URL with an opaque origin (`data:`, `blob:`, `javascript:`,
`file:`, and anything that does not parse). `test/security.test.ts` states the old behaviour
explicitly, so the defect cannot come back silently.

**20, 21 — two more ways in.** `will-navigate` (`electron.d.ts` 17671) does not fire for a
server-side redirect; `will-redirect` (17802) is the hook for the hop that actually loads.
`will-frame-navigate` (17652) is the subframe equivalent. The policy already forbids frames
(`frame-src 'none'`), so 21 matters for a window whose policy the game replaced.

The listeners also stopped using the **deprecated** positional `url` argument (`electron.d.ts`
17671–17690 marks it `@deprecated`) and read `details.url` off the event instead.

**22 — `will-attach-webview` (`electron.d.ts` 17579).** `webviewTag: false` already means no
`<webview>` can be created; refusing the attachment is the second, independent lock, because a
`<webview>` that attaches is a second renderer with its own preferences.

### 2.4 Permissions

| #   | Item                          | Where                                      | Value                            | Verdict   |
| --- | ----------------------------- | ------------------------------------------ | -------------------------------- | --------- |
| 23  | `setPermissionRequestHandler` | `packages/electron/src/main/window.ts:480` | allow-list of 3, deny by default | ok        |
| 24  | `setPermissionCheckHandler`   | `packages/electron/src/main/window.ts:483` | the same allow-list              | ok        |
| 25  | `setDevicePermissionHandler`  | `packages/electron/src/main/window.ts:484` | `false` for every device         | **fixed** |

The allow-list is `["pointerLock", "fullscreen", "automatic-fullscreen"]`
(`ALLOWED_PERMISSIONS`, `window.ts:448`). Camera, microphone, geolocation, notifications, MIDI
sysex, USB, HID, Serial, clipboard read, idle detection, display capture and everything else the
Electron 44 permission union lists (`electron.d.ts` 13417) are denied — asserted per name in
`test/window.test.ts`.

**25.** `setDevicePermissionHandler` (`electron.d.ts` 13383) is the _third_ question Electron asks:
the per-device grant WebHID, WebUSB and Web Serial consult once a chooser has run. It was not set,
so it fell back to Electron's default. Since `usb`, `hid` and `serial` are already denied on both
other paths, no chooser can open — this is a second lock on a shut door, not a reachable hole.

`setUSBProtectedClassesHandler` (`electron.d.ts` 13508) and `setBluetoothPairingHandler` (13342) are
**not** set: both only matter once a device permission has been granted, which cannot happen.
Recorded as an accepted risk in §3 rather than as an omission.

### 2.5 The `ignifx://` protocol

| #   | Item               | Where                                        | Value                                                                          | Verdict   |
| --- | ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------ | --------- |
| 26  | Scheme privileges  | `packages/electron/src/main/protocol.ts:50`  | `standard`, `secure`, `supportFetchAPI`, `stream`                              | ok        |
| 27  | Path normalisation | `packages/electron/src/main/protocol.ts:173` | decode, NUL check, backslash fold, containment check                           | ok        |
| 28  | Authority check    | `packages/electron/src/main/protocol.ts:194` | only `app`; anything else `IGX-1465` → `403`                                   | **fixed** |
| 29  | Response headers   | `packages/electron/src/main/protocol.ts:353` | `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin` | ok        |

**27 — traversal, in detail.** Two independent layers, and both are tested:

1. Chromium's own URL parser collapses `..` and `%2e%2e` path segments before the request is
   dispatched, because the scheme is `standard` (measured in S9.1, ADR-0018).
2. `protocolPathFor` does not rely on that. It percent-decodes the path, refuses a NUL byte
   (`protocol.ts:215` — the one character that truncates a path inside libc), folds `\` to `/` so
   the containment check sees what the file system will, resolves against the served root, and
   throws `IGX-1465` unless the result is the root or starts with `root + sep`.

Refused, each with a test in `packages/electron/test/security.test.ts` and
`packages/electron/test/protocol.test.ts`:

| Request                                     | Why it is refused                                   |
| ------------------------------------------- | --------------------------------------------------- |
| `ignifx://app/..%2f..%2fetc/passwd`         | encoded separator survives the parser; resolves out |
| `ignifx://app/%2e%2e%2f%2e%2e%2fetc/passwd` | fully encoded traversal; resolves out               |
| `ignifx://app/a/..%5c..%5cetc/passwd`       | encoded **backslash**, folded to `/`, resolves out  |
| `ignifx://app/%00etc/passwd`                | NUL byte                                            |
| `ignifx://app/%e0%a4%a`                     | undecodable percent escape                          |
| `ignifx://evil/index.html`                  | authority is not `app` (item 28)                    |

`respondToProtocolRequest` turns every one of these into `403` with the common headers
(`protocol.ts:419`), never a stack trace and never a partial read. Confirmed against a real Electron
process: `tests/visual/tests/desktop.spec.ts:305` calls `net.fetch` from the **main** process (the
renderer's own `connect-src 'self'` would otherwise refuse the request before the handler saw it)
and gets `200` for `ignifx://app/index.html`, `403` for `ignifx://evil/index.html`, and `403` for
`ignifx://app/..%2f..%2f..%2fetc/passwd`.

**28.** `protocol.handle` is registered per scheme, not per authority, so every `ignifx://<anything>`
reached the handler and `protocolPathFor` cheerfully served the same directory. The consequence is
not file disclosure — the containment check still held — but a second Chromium origin serving the
game's own files, for which `'self'` in the injected policy means _that_ origin. Combined with the
inert navigation check (item 19), a page could have reached it. Both halves are now closed.

### 2.6 IPC and the preload bridge

| #   | Item              | Where                                         | Value                                                      | Verdict   |
| --- | ----------------- | --------------------------------------------- | ---------------------------------------------------------- | --------- |
| 30  | Bridge surface    | `packages/electron/src/preload/bridge.ts:185` | `contextBridge.exposeInMainWorld` of a closed function set | ok        |
| 31  | Sender validation | `packages/electron/src/main/ipc.ts:193`       | game window, top frame, allowed origin — else `IGX-1467`   | **fixed** |

**30 — what crosses.** `exposeIgnifxHost()` (`electron.d.ts` 7237) exposes `version`, `versions`,
and four namespaces of async functions. `ipcRenderer` never crosses; neither does a channel name the
renderer could choose; neither does the `IpcRendererEvent` in the window-event subscription
(`bridge.ts:146` drops it on purpose, because it carries a live `sender`). Every handler is
`ipcMain.handle` (`electron.d.ts` 8993) — request/response, never a fire-and-forget `on` — and every
handler re-validates its arguments (`ipc.ts:52`, `:68`) before touching the file system or the
shell. `tests/visual/tests/desktop.spec.ts:323` asserts from inside the running renderer that
`require`, `process`, `module` and `global` are all absent and that `window.ignifxHost`'s key set is
exactly the seven documented members.

**31 — nothing validated the sender.** Every handler ignored its `IpcMainInvokeEvent`, and
`ipcMain.handle` is registered per **channel**: any frame in any `WebContents` in the process could
invoke `ignifx:storage.set` or `ignifx:shell.openExternal`. Electron's own note on the event says
handlers should check `senderFrame` (`electron.d.ts` 18806). They now do, and the check asks three
questions rather than one:

- the message came from the game window's own `WebContents` (captured at install time, so a
  destroyed window does not turn the gate into a different error);
- the sending frame is the **top** frame (`senderFrame.parent === null`), so a subframe on the same
  origin is refused too;
- `senderFrame.origin` (`electron.d.ts` 19272 — Chromium's own serialization, which for a `standard`
  scheme really is `ignifx://app`) is on the allow-list, which is `["ignifx://app"]` for a packaged
  build and additionally the dev-server origin when `installHostHandlers` is given the same `entry`
  the window was created with.

The gate runs **before any argument is read**, and the refusal is `IGX-1467`. `isTrustedSender` is a
pure predicate over a three-field record, so every way of failing is stated on its own in
`test/security.test.ts` and `test/ipc.test.ts`; the four templates now pass `entry` through
(`templates/*/desktop/main.ts`), and the real bridge still works end to end — the desktop suite's
storage round-trip and `openExternal` tests both pass unchanged.

Exposure before the fix was small: with `nodeIntegrationInSubFrames: false`, `frame-src 'none'`,
`child-src 'none'` and every navigation off-origin blocked, there was no second frame to send from.
It is defence in depth made real rather than a hole closed.

### 2.7 `shell.openExternal`

| #   | Item       | Where                                     | Value                                 | Verdict |
| --- | ---------- | ----------------------------------------- | ------------------------------------- | ------- |
| 32  | Allow-list | `packages/electron/src/main/window.ts:37` | `["https:", "mailto:"]`               | ok      |
| 33  | The check  | `packages/electron/src/main/ipc.ts:249`   | parsed `protocol`, not a prefix match | ok      |

An allow-list, not a deny-list, and **stricter than the checklist asked for**: the brief named
"http/https only", and plain `http:` is refused here as well. `file:`, `javascript:`, `data:`,
`ignifx:` and every custom protocol some other installed application registered all fail, as does a
string that is not a URL at all. The check is on `new URL(url).protocol`, so `https:/\/evil` — which
the WHATWG parser normalises to `https://evil` — is allowed, and that is deliberate: the list gates
_protocols_, and handing an `https` URL to the user's browser is the entire purpose of the call.
Refusal is `IGX-1464`, asserted through the real bridge at
`tests/visual/tests/desktop.spec.ts:496`.

### 2.8 Packaging

| #   | Item                                  | Where                                    | Value                           | Verdict       |
| --- | ------------------------------------- | ---------------------------------------- | ------------------------------- | ------------- |
| 34  | Electron Fuses                        | `templates/*/electron-builder.yml:50`    | six flipped; see below          | **fixed**     |
| 35  | `asar`                                | `templates/*/electron-builder.yml:29`    | `true`                          | ok            |
| 36  | ASAR integrity validation             | `templates/*/electron-builder.yml`       | off                             | accepted risk |
| 37  | Code signing (macOS)                  | `templates/*/electron-builder.yml:70`    | `identity: null` — **unsigned** | accepted risk |
| 38  | Hardened runtime / Gatekeeper (macOS) | `templates/*/electron-builder.yml:71–72` | `false` / `false`               | accepted risk |
| 39  | Code signing (Windows)                | `templates/*/electron-builder.yml:82`    | `signAndEditExecutable: false`  | accepted risk |
| 40  | Notarization                          | nowhere                                  | not configured                  | accepted risk |
| 41  | Auto-update                           | nowhere                                  | not configured                  | accepted risk |

**34 — what `electron-builder.yml` now signs, notarises, and flips.** It signs nothing and notarises
nothing (items 37–40). It does flip the Electron Fuses, through `electron-builder` 26.15.3's own
`electronFuses` key — which delegates to `@electron/fuses` 1.8.0, already a transitive dependency of
`app-builder-lib`, so **no new dependency was added**:

| Fuse                                   | Set to  | What it closes                                                     |
| -------------------------------------- | ------- | ------------------------------------------------------------------ |
| `runAsNode`                            | `false` | `ELECTRON_RUN_AS_NODE=1` turning the app into a Node REPL          |
| `enableNodeOptionsEnvironmentVariable` | `false` | `NODE_OPTIONS` injecting arbitrary Node flags                      |
| `enableNodeCliInspectArguments`        | `false` | `--inspect` attaching a debugger to the main process               |
| `grantFileProtocolExtraPrivileges`     | `false` | `file://` pages getting powers a browser would not give them       |
| `onlyLoadAppFromAsar`                  | `true`  | an `app/` directory dropped beside `app.asar` being loaded instead |
| `enableCookieEncryption`               | `true`  | the on-disk cookie store being plaintext                           |
| `resetAdHocDarwinSignature`            | `true`  | (not a fuse — re-applies the signature flipping invalidates)       |

Verified on the packaged macOS arm64 build produced by `pnpm dist:desktop` on 2026-09-07, by reading
the fuse wire back out of the `.app` with `@electron/fuses`' `getCurrentFuseWire`:

```
RunAsNode                            0
EnableCookieEncryption               1
EnableNodeOptionsEnvironmentVariable 0
EnableNodeCliInspectArguments        0
EnableEmbeddedAsarIntegrityValidation 0
OnlyLoadAppFromAsar                  1
LoadBrowserProcessSpecificV8Snapshot 0
GrantFileProtocolExtraPrivileges     0
```

and `codesign --verify --deep --strict "ignifx Third Person.app"` exits 0 against an `adhoc`
signature — which is what `resetAdHocDarwinSignature` is for, and what macOS arm64 needs to run a
binary at all. `ELECTRON_RUN_AS_NODE=1 <binary> -e "console.log(…)"` printed nothing, which is the
`runAsNode` fuse doing its job.

**36 — ASAR integrity validation, accepted and deliberate.**
`enableEmbeddedAsarIntegrityValidation` needs the resource hashes a real signing step writes into
the bundle. These builds carry no signing identity, so turning it on would make the packaged app
refuse to start. It is written as an explicit `false` with the reason beside it, so that whoever adds
a signing identity finds the line rather than the absence of one.

**37–40 — signing and notarization, accepted.** Out of scope before 1.0 (ADR-0018): both need
credentials belonging to whoever ships the game, not to the template. `identity: null` and
`signAndEditExecutable: false` make the unsigned path an explicit configuration rather than a build
failure. `SECURITY.md` says an unsigned `dist:desktop` build is out of scope for a vulnerability
report.

**41 — auto-update, accepted.** Not configured at all, which means there is no update channel to
attack. Documented after 1.0. The security consequence is the other way round: a shipped game does
not receive Chromium security fixes without a rebuild, which is why ADR-0018 schedules a **quarterly
Electron bump** and why the `desktop-build` CI matrix exists to prove a bump has not broken
packaging.

### 2.9 Privacy (`CONSTITUTION.md` §9.1)

| #   | Item                            | Finding                                                                                                 | Verdict |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| 42  | Telemetry                       | none. No analytics, no crash reporter, no update check in `packages/electron` or `templates/*/desktop`. | ok      |
| 43  | Third-party requests at runtime | none. `connect-src 'self' data: blob:` in the packaged policy would refuse one anyway.                  | ok      |

`app.setAppLogsPath`, `crashReporter`, and `session.setProxy` are not called anywhere in the package
or the templates.

---

## 3. Accepted risks, collected

| #   | Risk                                                                 | Why it is accepted                                                                                                  |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 16  | `style-src 'unsafe-inline'`                                          | `@ignifx/ui` and every template inject a `<style>`; inline styles cannot execute script under this policy.          |
| 17  | Dev-server origin in the development `script-src`                    | Only under `electron-vite dev`, against the developer's own machine; a packaged build ignores the option entirely.  |
| 30a | `setUSBProtectedClassesHandler` / `setBluetoothPairingHandler` unset | Both only matter after a device permission is granted, and `usb`/`hid`/`serial`/Bluetooth are denied on every path. |
| 36  | ASAR integrity validation off                                        | Needs signed resource hashes; these builds are unsigned by design.                                                  |
| 37  | macOS builds unsigned                                                | Credentials belong to whoever ships the game (ADR-0018).                                                            |
| 39  | Windows builds unsigned                                              | Same, and the Windows configuration has never been executed here at all.                                            |
| 40  | No notarization                                                      | Same.                                                                                                               |
| 41  | No auto-update                                                       | Out of scope before 1.0; mitigated by the quarterly Electron bump in the plan.                                      |

Two more, recorded here because they are properties of the design rather than settings:

- **Symbolic links inside the served directory are followed.** `protocolPathFor` resolves a path
  lexically and does not `realpath` it, so a symlink committed into a game's own build output could
  point outside the served root. The build output is produced by the game's own `vite build` from
  its own sources; treating it as hostile would be treating the game as hostile. Not fixed.
- **`devTools` is left at Chromium's default (`true`).** A packaged game can open DevTools. That is
  a debugging affordance for the player's own process, not a privilege boundary — the renderer is
  already sandboxed and holds nothing the player cannot read out of `out/renderer`.

---

## 4. Dependency audit

Run on **2026-09-07** (local `Mon 7 Sep 2026 03:09 AWST`), pnpm 11.17.0, registry
`https://registry.npmjs.org/`:

| Command             | Result                           |
| ------------------- | -------------------------------- |
| `pnpm audit`        | `No known vulnerabilities found` |
| `pnpm audit --prod` | `No known vulnerabilities found` |

Machine-readable counts from `pnpm audit --json`: `info 0, low 0, moderate 0, high 0, critical 0`
across `920` total dependencies (`6` production, `914` development, `206` optional).

**Advisory-database state.** `pnpm audit` posts the lockfile's dependency tree to the npm registry's
bulk-advisory endpoint and reports what comes back; neither the endpoint nor pnpm returns a database
version or timestamp, so the only honest statement of "which advisory data" is the date of the run.
Both runs above are from a network-reachable machine on 2026-09-07 — a run behind a proxy that
cannot reach the registry reports the same "no known vulnerabilities" line rather than an error,
which is exactly why the audit is **not** a CI job.

**Why `pnpm audit` is not in CI.** It has two failure modes that are not about this repository:
an advisory-database or registry outage turns every unrelated pull request red, and an advisory
published against a transitive dependency with no fix available yet does the same until upstream
moves. Neither is actionable by the person whose pull request it blocks. The `licenses` job added in
this change _is_ deterministic — it reads the installed tree and diffs a committed file — so it is a
gate; the audit stays a recorded, dated manual step, re-run at each release and whenever this review
is refreshed. `renovate.json` is what keeps versions moving between reviews.

## 5. Third-party licence notices

`pnpm licenses:notices` regenerates `THIRD_PARTY_NOTICES.md` (`CONSTITUTION.md` §11.2) and
`pnpm licenses:check` fails when it is stale; the CI `licenses` job runs both. It records **8**
third-party production packages: `@babylonjs/havok`, `@babylonjs/lite`,
`@dimforge/rapier2d-compat`, `@types/emscripten`, `@types/webxr`, `@webgpu/types`, `electron`, and
`vite`. `@babylonjs/lite`'s own `NOTICE.txt` is reproduced verbatim, as Apache-2.0 §4(d) requires of
a redistribution — it carries the licences of `manifold-3d`, the `@recast-navigation` packages,
`text-shaper`, Recast & Detour, and the Emscripten runtime, all of which are compiled into Lite's
WebAssembly and therefore into a shipped game.

Sample art, audio and models stay in each template's `ATTRIBUTION.md` (§11.3), and the website's web
fonts keep their licences in `website/public/licenses/`; neither is duplicated into the notices file.

---

## 6. What this review did **not** verify

- **Windows.** No Windows build has been run, here or ever. The `win` block in each
  `electron-builder.yml` — NSIS, `signAndEditExecutable: false`, and now the fuses — is
  configuration only. Whether `electronFuses` flips correctly on a Windows binary is unverified.
- **Linux.** Likewise. No Linux build, no Linux run, no display.
- **Code signing and notarization.** Never exercised. `resetAdHocDarwinSignature` was verified for
  the _ad-hoc_ case only.
- **The packaged app's CSP in anger.** The Content-Security-Policy assertions in the desktop suite
  run against the `out/` build launched through Playwright's `_electron` fixture, which is the same
  main process the packaged app runs but not the `.app` bundle itself. Nothing in the header path
  depends on packaging, but it has not been read out of a running `.app`.
- **The sender check against a genuinely hostile frame.** There is no way to create a second frame
  in the packaged window — `frame-src 'none'`, `child-src 'none'`, `webviewTag: false`, and every
  off-origin navigation blocked — so the refusal paths are proved by unit tests over the pure
  predicate, and only the _accept_ path is proved against a real Electron process.
- **The other three templates' packaged builds.** All four templates' `build:desktop` was run and
  all four typecheck, and their `electron-builder.yml` fuse blocks and `desktop/main.ts` are
  byte-identical apart from the app id, product name, window title and size — but only
  `3d-third-person` was put through `dist:desktop`, so only its fuses and signature were read back.
