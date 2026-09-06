---
"@ignifx/audio": patch
---

The two `playOneShot` overloads document why they differ

`AudioSource.playOneShot(clip, { volume })` takes a gain and nothing else and supplies the source's
own bus; `app.audio.playOneShot(clip, options)` takes `bus` plus all of `PlayOptions`. That
asymmetry is what `docs/architecture/10-audio.md` §3 specifies — the component form exists to fire a
second clip through this source's bus — and both TSDoc entries now say it and point at each other.
No signature changed.
