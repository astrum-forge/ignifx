---
"@ignifx/core": minor
---

Core: `app.tweens`

`docs/architecture/12-3d-toolkit.md` §4 puts tweening in the kernel, because both toolkits use it and because a tween is a clock consumer like any other. `app.tweens.to(target, props, options)` moves any object's numeric, `Vec2`, `Vec3`, or `Quat` fields over time and hands back a `Tween`.

**What it does.** Component-wise interpolation for vectors, shortest-arc slerp for quaternions, and a plain lerp for numbers. `duration`, `ease`, `delay`, `loop` (extra cycles; `-1` forever), `yoyo`, `updateWhenPaused`, and `onComplete`. Easing is a name from `EASING_NAMES` — `linear`, `quadIn/Out/InOut`, `cubicIn/Out/InOut`, `sineInOut`, `backOut`, `elasticOut`, `bounceOut` — or a custom `(t: number) => number`. The handle carries `pause`/`resume`/`stop`/`complete`, `progress`, `isPlaying`/`isPaused`/`isDone`, and an `onComplete` signal alongside the callback; `stop` leaves the value where it stands and never completes, `complete` jumps to the end and fires.

**Where it runs.** A `PostUpdate` system at order `-100`, ahead of `@ignifx/2d`'s sprite clock (`0`) and `@ignifx/3d`'s `Animator` (`10`), so a tween driving an animation parameter is read in the same frame it is written. It advances on `time.deltaTime`, so `time.timeScale` slows it and `app.pause()` freezes it; a tween created with `updateWhenPaused: true` runs on `time.unscaledDeltaTime` instead. Every tween dies with the app.

**Two details that make it behave.** Endpoints are latched when the tween's delay elapses rather than when it is created, so two tweens queued on one property chain instead of fighting. And a channel decides once, from a property descriptor, whether writing means mutating the value in place (`Transform.localPosition` hands back the live vector) or assigning back through a setter (`Transform.position` hands back a copy) — which is why both work.

New codes: `IGX-0109` (a tween option outside its domain) and `IGX-0110` (a field that is not tweenable, or not writable).
