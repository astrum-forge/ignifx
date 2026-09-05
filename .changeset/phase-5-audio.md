---
"@ignifx/audio": minor
"ignifx": minor
---

Phase 5: audio

`@ignifx/audio` ships the subsystem `docs/architecture/10-audio.md` describes. Registering `audio()` gives a game `app.audio`, three components, two asset types, the `audio` settings section, the `audio` diagnostics group, and one `PreRender` system.

`app.audio` (`AudioService`) owns the mixer tree — named `AudioBus` gains chained parent to child, built from the `defaultBuses` setting or from an `.audio.json` (`ignifx.audiobuses`, with `parseAudioBusesFile` and a loader) — plus `masterVolume`, `bus`/`tryBus`/`createBus`, `playOneShot`, the active `listener`, `onStateChanged`, and the `lite.engine` escape hatch. `state` reads `"locked"` until the audio context runs: browsers refuse to make a sound before a user gesture and Babylon Lite quietly drops a non-looping play made while the context is suspended, so every `play()` made while locked is held on its source and flushed, in order, by `unlock()` or by Lite's own `resumeOnInteraction`.

Components: `AudioSource` (clip, bus, volume, pitch, loop, `playOnAwake`, `maxInstances`, spatial placement with cone angles in degrees, stereo pan; `play`/`playOneShot`/`stop(fade)`/`pause`/`resume`, `isPlaying`, `instanceCount`, `onEnded`), `AudioListener` (one active pair of ears, attached to the entity's Lite node), and `MusicPlayer` (a `Script` with a playlist, `play(clip, { fadeIn })`, `crossfadeTo(clip, seconds)`, `stop({ fadeOut })`, `next()`, routed to the `Music` bus and surviving a `"single"` scene load from a persistent scene). Assets: `AudioClip` for `.mp3 .ogg .wav .webm .flac`, static by default and streaming through a `{ "audio": { "streaming": true } }` sidecar.

**Audio is testable under Node.** The one `AudioBackend` contract has two implementations: `WebAudioBackend` wraps Lite's engine and is the only module that imports `@babylonjs/lite`; `HeadlessBackend` is pure TypeScript that keeps the same state — playing, paused, instance counts, gains, oldest-instance stealing — and *simulates* playback, ending an instance after `clip.duration / playbackRate` seconds of engine time advanced by the `PreRender` pump from the frame delta. Fades are interpolated by the service rather than handed to Lite's `RampOptions`, so a two-second crossfade takes two seconds of game time on both backends, and `onEnded` is raised from the pump so it lands at a defined point in the frame instead of on Lite's audio-thread callback. A gameplay test steps the app and reads real answers.

Ten error codes are added: `IGX-1001` (unknown bus), `IGX-1002` (a spatial source playing with no listener), `IGX-1003`–`IGX-1006` (a malformed `.audio.json`: bad header, unreadable version, duplicate bus name, a parent not declared before its child), `IGX-1007` (no Web Audio in this host), `IGX-1008` (a clip that would not decode), `IGX-1009` (a streaming clip on a context that cannot stream) and `IGX-1010` (the service used after disposal).
