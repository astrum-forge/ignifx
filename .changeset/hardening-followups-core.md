---
"@ignifx/core": minor
---

A `PostProcessStack` configured before `app.start()` now works, `Diagnostics` gains
`groupOrRegister`, and Lite's error table and glTF parser leave the entry chunk

**Fixed.** Enabling `bloom` (or any effect) on a `PostProcessStack` **before** `app.start()` used to
present a black page: the chain recorded its first frame-graph task immediately, and at that point
the offscreen scene colour it samples had never been built, so Lite raised error 107 —
`PostProcessTask "ignifx:bloom-extract-highlights": sourceTexture has no color texture` — and WebGPU
rejected the whole frame. A chain built before the scene is registered now only appends its tasks;
`registerScene`'s own `frameGraph.build()` records them, in array order, after the scene task that
allocates the colour. Configuring a stack before or after `start()` reaches the same first frame.

**Added.** `app.diagnostics.groupOrRegister(name, counterNames)` returns an existing counter group or
registers it. `registerGroup` throws `IGX-1503` on a duplicate, which is right for an extension that
registers once and wrong for a script whose `awake` runs per instance and again after a scene
reload; `group(name) ?? registerGroup(name, …)` had to be written out at every call site. When the
group already exists it comes back exactly as first registered and the new `counterNames` are
ignored, because counters are indexed and renumbering them under a live subsystem would corrupt
its readings.

**Changed (bundle).** Two things that every build carried and few builds use are now behind dynamic
imports: Babylon Lite's 43 KB error-message table, which `enableErrorDecoding` pulled into the entry
chunk of every build because `createApp`'s `mode` defaults to `"development"`, and Lite's glTF
parser, which the always-registered `model` loader pulled in even for a game that loads no model.
Both call sites were already asynchronous. Measured on `examples/hello-cube`, the entry chunk fell
from 284,181 to 268,634 gzipped bytes (−15,547, −5.5%) with the total over all chunks unchanged.

**Documentation.** `FrameSample.cpuMs` and `createApp`'s `mode` no longer claim the Vite plugin sets
the build mode: nothing does, `mode` defaults to `"development"` in a production `vite build` too,
and a project that wants production behaviour passes `mode` itself. `Logger`'s example no longer
suggests a message interpolates `{placeholder}` tokens — it does not, and they print verbatim.
Phase-era "arrives in Phase N" notes for work that either shipped (scene loading, layer masks, the
3D animator) or was never implemented (shader materials, PBR extensions) now describe what the build
actually does.
