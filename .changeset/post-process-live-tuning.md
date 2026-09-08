---
"@ignifx/core": patch
---

`PostProcessStack` fields are live: a slider bound to `bloom.threshold` now changes the picture

The stack built its chain once, the first time any effect was enabled, and every `sync` after that
only flipped the chain's `executionEnabled` to match the component. The bloom and SMAA records were
read at that one moment and never again, so `post.bloom.threshold = 0.4` on a running game did
nothing — the website's bloom example had four sliders and none of them moved the frame — and
`post.bloom.enabled = false` on a one-effect chain left bloom running, because the chain's identity
was checked only while no chain existed yet.

Lite's `BloomPostProcessTask` exposes `weight`, `kernel`, `threshold` and `exposure` as writable
fields and `updateUniforms()` re-uploads every sub-pass from them; `SmaaPostProcessTask` documents
the same for `threshold`, `maxSearchSteps`, `diagonalDetection` and `cornerDetection` (verified
against `@babylonjs/lite@1.27.0`, `index.d.ts` 1287 and 11622). The chain now keeps a typed handle
to each of those tasks and, once per frame, uploads whatever changed since the last upload — a frame
in which nothing moved uploads nothing. The one tuning Lite fixes at creation is bloom's
`bloomScale`, which sizes the blur targets, so `bloom.scale` joins "which effects, in which order"
in the chain's identity: a change to any of them disposes the old chain and records a new one. Lite
cannot remove a task from a frame graph, so the old tasks stay in it, disabled and with their GPU
resources freed, at one branch per frame each — toggling an effect's `enabled` in a settings menu
costs a rebuild per click, whereas toggling the whole component's `enabled` keeps the chain and
skips it, which is what the templates' settings screens do.

What a game author sees: an inspector edit, a settings slider or a script write to any bloom or SMAA
field takes effect on the next frame, and turning a single effect off actually turns it off.

Public API change: none. `PostProcessChain.applySettings` and the two adapter functions it calls are
`@internal`.
