# 10 · Audio

**Status:** Implemented; describes the code on `main` · **Package:** `@ignifx/audio` · **Inspiration:** Godot audio buses, Unity `AudioSource`/`AudioListener`/`AudioMixer`

Babylon Lite ships a complete Web Audio engine (a port of Babylon's Audio V2): engine, buses, static and streaming sounds, spatialization with transform attachment, stereo panning, analyzers, unlock handling. `@ignifx/audio` adds conventions, components, and asset integration on top. Babylon Lite names are those of the pinned version (`pnpm-workspace.yaml` catalog).

**Source map** (`packages/audio/src/`)

- `extension.ts` — `audio()`: creates the backend and the service in `register`, registers the loaders and the pump.
- `service/` — `audio-service.ts` (`app.audio`), `audio-bus.ts`, `voice.ts` (one sound and its queued plays), `ramp.ts` (fades), `audio-system.ts` (the `PreRender` pump, order −400).
- `components/` — `AudioSource`, `AudioListener`, `MusicPlayer`.
- `assets/` — the clip loader, the `.wav` header parser, the `.audio.json` bus file and its loader.
- `backend/types.ts` — the `AudioBackend` interface. `lite/web/web-backend.ts` — the Web Audio backend, the only module that imports Babylon Lite. `headless/headless-backend.ts` — the simulation backend.
- `settings.ts`, `errors.ts` (`IGX-1001`–`IGX-1010`).

Invariants to keep:

- Everything above the backend goes through the one `AudioBackend` interface; both implementations keep the same observable state (§7).
- The service owns the authoritative gains and interpolates fades itself; Lite ramps are not used (§1).
- One pump per frame at `PreRender` −400 drives spatial updates, fades, `onEnded`, the pause poll and the headless clock; Lite's own animation-frame loop stays off (§3, §6, §7).
- A `SoundInstance` names a sound, not one of its concurrent instances (§1).
- `AudioSource`, `AudioListener` and `MusicPlayer` are `Script`s, because only scripts receive `awake`/`onEnable`/`onDisable` (§3).
- Headless time is engine time, never the wall clock (§7).

Not built: bus effects (reverb, EQ, compressor) and analyzers.

---

## 1. Service (`app.audio`)

```ts
interface AudioService {
  readonly state: "locked" | "running" | "suspended" | "interrupted" | "closed"; // Lite AudioEngineState plus "locked" (created, never unlocked)
  unlock(): Promise<void>; // unlockAudioEngineAsync; also called automatically on the first user gesture
  masterVolume: number; // setMasterVolume/getMasterVolume
  readonly buses: ReadonlyMap<string, AudioBus>; // "Master", "Music", "SFX", "UI", "Voice" by default (createAudioBusAsync)
  bus(name: string): AudioBus; // throws IGX-1001 when unknown
  tryBus(name: string): AudioBus | null; // expected absence is not an error
  createBus(name: string, options?: { parent?: string; volume?: number; pausable?: boolean }): Promise<AudioBus>;
  playOneShot(clip: AudioClip, options?: OneShotOptions): SoundInstance; // fire-and-forget on the SFX bus
  readonly listener: AudioListener | null; // active listener component
  readonly onStateChanged: Signal<AudioService["state"]>;
  readonly lite: { readonly engine: AudioEngine | null }; // unstable escape hatch; null headless
}
interface AudioBus {
  readonly name: string;
  readonly parent: AudioBus | null;
  readonly pausable: boolean; // whether app.pause() pauses it
  volume: number;
  muted: boolean;
  readonly effectiveVolume: number; // this bus's applied gain times every ancestor's
  setVolume(v: number, rampSeconds?: number): void;
  readonly lite: LiteAudioBus | null; // null headless
}
```

- **One backend interface.** The package is built against `AudioBackend`, with two implementations: the Web Audio backend (`createWebAudioBackend`) and `HeadlessBackend` (pure TypeScript, §7). `audio({ createBackend })` substitutes another.
- **The engine is created in `register`**, not in `onStart`. `04-extensions.md` §2.4 allows an async `register`, the audio engine has no dependency on the Lite _render_ engine, and `app.audio` has to be usable the moment `await createApp(…)` returns. A `.audio.json` tree is the exception and is built at delivery: awaiting an asset in `onStart` deadlocks (`04-extensions.md` §2.5).
- The engine is created with `createAudioEngineAsync({ resumeOnInteraction: true, resumeOnPause: true })`. Browsers require a user gesture before audio plays; Lite resumes on the first **`click` on `document`** — that one event, not `pointerdown` or `keydown` (`lib/audio/audio-engine.js`) — and `unlock()` exists for explicit prompts ("tap to start"). Until unlocked, `play()` calls are queued per source (configurable: `audio({ queueWhileLocked: true })`).
- **`playOneShot` takes a loaded `AudioClip`**, not an `AssetRef`. An `asset()` field decodes to a loaded `AssetHandle` (`05-assets-and-loading.md` §3), so a loaded clip is what game code holds; taking a reference would mean returning a `SoundInstance` for a sound that may never load.
- **`SoundInstance` names the sound**, not one of its concurrent instances, and repeated `play()` calls on one source return the same object. Lite's `playSound` returns `void` and `stopSound`/`pauseSound`/`setSoundVolume` all act on every instance at once, so there is no per-instance handle to hand back; inventing one would mean a Lite sound, and a gain sub-graph, per `play()`. It carries `clip`, `bus`, `isPlaying`, `isPaused`, `instanceCount`, `volume`, `setVolume(v, ramp?)`, `stop(fade?)`, `pause()`, `resume()`, and `onEnded`.
- **Fades are interpolated by the service** in the `PreRender` pump and pushed to the backend as plain values, rather than handed to Lite's `RampOptions`. A Lite ramp runs on the audio context's clock, which no headless test has; Lite's own `parameterRampDuration` (10 ms) still de-clicks each per-frame write.
- **The service owns the gain values.** Lite has `getMasterVolume` and no `getBusVolume`/`getSoundVolume`.
- Bus layout comes from `.audio.json` (`{ "format": "ignifx.audiobuses", "formatVersion": 1, "buses": [{ "name": "Music", "parent": "Master", "volume": 0.8 }, …] }`) or defaults. Buses route to their parent (`outBus`), ending at Lite's main bus. A bus must be declared **after** the bus it routes into: a forward reference and a cycle are then the same failure (`IGX-1006`) and validation is one linear pass. Each entry may carry `"pausable"`, overriding the `audio.pausableBuses` setting for that bus.
- The default tree's root is the **first** name in `audio.defaultBuses`; every other name routes into it.
- Effects (reverb, EQ, compressor) are not part of Lite and are not built; `AudioBus` has no effects member.

## 2. `AudioClip` asset

- Loader for `.mp3`, `.ogg`, `.wav`, `.webm`, `.flac` (browser-decodable). Sidecar `.meta.json` chooses `{ "audio": { "streaming": true } }`.
- Static clips decode into a Lite `SoundBuffer` (`createSoundBufferAsync`) shared by all sources; streaming clips are media-element backed (`createStreamingSoundAsync`) and created per playing source. Static is the default; use streaming for music longer than ~30 s.
- The clip's shape is `{ address, url, isStreaming, duration: number | null, channels: number | null, sampleRate: number | null, byteLength, isDecoded, lite: { buffer: LiteSoundBuffer | null } }`. `duration` is `null` when this build could not determine it: under Node only a `.wav` header is parsed, because MP3, OGG, WebM, and FLAC need a container parser and coding standards §13 makes that a dependency decision with an ADR paragraph behind it. A headless instance of a `null`-duration clip never ends on its own.
- A streaming clip is **never fetched** by the loader: Lite's `createStreamingSoundAsync` takes the URL and builds the media element, so fetching would download the file twice.
- Whether the loader decodes is decided by "does this app have a decoder", not by `app.isHeadless`: a browser test drives a headless app against a real `OfflineAudioContext`, and that app decodes. With no decoder the bytes are released as soon as the header has been read.

## 3. `AudioSource` component

`AudioSource`, `AudioListener`, and `MusicPlayer` extend **`Script`**, not `Component`. The kernel delivers `awake`, `onEnable`, and `onDisable` only to classes deriving from `Script` (`packages/core/src/lifecycle/lifecycle-queue.ts`: `invokeCallback` returns early when the class carries no script info), and `playOnAwake` is defined in terms of `awake` — which is also the first callback that sees a scene file's decoded props (`06-serialization-and-scene-format.md` §4). Under `isolatedDeclarations` the fields are declared with `declare` over a `static schema`, exactly as the core render components do, rather than through `Script.define`.

```ts
class AudioSource extends Script {
  // schema fields
  clip: AssetHandle<AudioClip> | null; // asset(AudioClip)
  bus: string; // "SFX"
  volume: number; // 1, in [0, 1]
  pitch: number; // 1, in [0.1, 4]; playbackRate
  loop: boolean; // false
  playOnAwake: boolean; // false
  maxInstances: number; // 8
  spatial: boolean; // false; 3D positional audio (enableSpatial)
  minDistance: number; // 1
  maxDistance: number; // 50
  rolloff: number; // 1
  distanceModel: "linear" | "inverse" | "exponential"; // "inverse"
  cone: { innerAngle: number; outerAngle: number; outerVolume: number }; // 360, 360, 0
  pan: number; // 0, in [-1, 1]; stereo pan for non-spatial sources (enableStereo/setStereoPan)

  play(options?: PlayOptions): SoundInstance | null; // null when the source has no clip; playSound, subject to maxInstances
  playOneShot(clip: AudioClip, options?: { volume?: number }): SoundInstance;
  stop(fadeSeconds?: number): void;
  pause(): void;
  resume(): void;
  readonly instance: SoundInstance | null;
  readonly isPlaying: boolean;
  readonly instanceCount: number;
  readonly onEnded: Signal<void>;
}
interface PlayOptions {
  volume?: number;
  pitch?: number;
  loop?: boolean;
  delay?: number;
  startOffset?: number;
  duration?: number;
}
```

- Spatial sources attach to the entity's transform node through Lite's `attachedTo` (`attachSpatialTarget`), so position and orientation follow automatically; `updateSpatialAudio(engine)` is pumped once per frame in `PreRender` at **order −400** — after the physics display pose, which is written at the top of `Update` (order −900, `01-lifecycle-and-time.md` §3), and well before the render sync (900) — and `setSpatialAutoUpdate(engine, false)` keeps Lite from starting a second `requestAnimationFrame` loop (`CONSTITUTION.md` §3.2).
- Angles are degrees in the schema and converted to radians for Lite; `pitch` maps to `playbackRate` (Lite's `pitch` is in cents and is not exposed).
- `maxInstances` **steals the oldest** instance rather than refusing the newest, which is what Lite does (`lib/audio/static-sound.js`, `_stopExcessInstances`) and what a footstep loop wants.
- `volume` and `pan` are pushed to a running sound as soon as they change. `pitch` applies to the **next** `play()`: Lite fixes an instance's playback rate when it starts. `clip`, `bus`, `loop`, `maxInstances`, and the spatial parameters rebuild the voice — a Web Audio route is fixed at creation — which stops whatever is playing.
- `onEnded` is raised from the `PreRender` pump when the sound stops carrying instances, whether it ran out or was stopped, and never for a sound that is merely paused. Lite's own `onEnded` comes off a Web Audio `ended` event at an arbitrary point between frames and is deliberately not used.
- `PlayOptions.volume` defaults to `1` and multiplies the source's `volume` field, the way Unity's `PlayOneShot` volume scale does.
- `AudioSource.playOneShot(clip, { volume })` takes an options object rather than a bare number, matching every other options-taking call in the engine (coding standards §5.4).

## 4. `AudioListener` component

One active listener (usually on the main camera entity; templates add it there). Maps to `setSpatialListener(engine, { attachedTo: node })`. When no listener is enabled, spatial sources fall back to the world origin and a development warning is logged once (`IGX-1002`) — Lite builds a listener at the origin on first use either way (`lib/audio/spatial.js`, `ensureSpatialSubNode`).

Selection is "the most recently **enabled** listener wins", which during a scene load is the one with the highest creation serial; disabling it hands the ears back to the previous one. The component declares no serialized fields: which listener is active is decided by which one is enabled, and a scene file already records that.

## 5. Music

`MusicPlayer` (script in `@ignifx/audio`): `play(clip, { fadeIn })`, `crossfadeTo(clip, seconds)`, `stop({ fadeOut })`, `next()`, playlist support. It routes to the `Music` bus and survives scene loads when placed in a persistent scene.

Whether a track streams is a property of the **clip** (its `.meta.json` sidecar), not of the player; the player plays whatever it is given. Its fields are `playlist`, `bus` (`"Music"`), `volume`, `playOnAwake`, `autoAdvance`, `loopPlaylist`, `loopTrack`, and `crossfadeSeconds`. A crossfade holds two voices at once; a track that **ends** advances the playlist when `autoAdvance` is set, and a track that is **stopped** does not, because a stop is a decision and an ending is not.

## 6. Pausing and focus

- `app.pause()` pauses sources on buses marked `pausable` (default: all except `UI`); `resume()` restores them. Configurable with `audio({ pauseWithApp: false })`.
- Tab hidden/interrupted contexts are handled by Lite (`resumeOnPause`); `app.audio.state` reflects `"interrupted"`.
- `App` has no pause signal, so the transition is **polled** in the `PreRender` pump: `app.pause()` sets `time.paused` (`01-lifecycle-and-time.md` §7) and the pump compares it with the previous frame's value. Polling one boolean once a frame allocates nothing and needs no kernel change. `resume()` un-pauses exactly the voices the pause paused, so a sound the game paused itself stays paused.

## 7. Headless behaviour

Node has no Web Audio; the service runs `HeadlessBackend`, a **simulation** — not a no-op — that tracks state (`isPlaying`, `isPaused`, instance counts, gains, oldest-instance stealing) and ends an instance after `clip.duration / playbackRate` seconds of engine time, so every gameplay test runs under Node with real semantics.

The clock is the engine clock the `PreRender` pump advances, not `Date.now()` and not `performance.now()`: `app.step(1 / 60)` advances audio by exactly one sixtieth of a second, so a test that steps sixty times has advanced audio by exactly one second on every machine (coding standards §10). `HeadlessBackend({ startSuspended: true })` reproduces a browser's locked context, so the unlock flow is exercised under Node too.

## 8. Diagnostics

`app.diagnostics.group("audio")`: `state` (an index into `locked, running, suspended, interrupted, closed`), `voices`, `instances`, `streaming`, `buses`, `unlockedAtMs`. The devtools Audio panel shows a fader per bus.

The counters are flat numbers in one `DiagnosticsGroup`, which is what `15-devtools-and-diagnostics.md` §3 and core's `Diagnostics.registerGroup` provide — there is no `app.diagnostics.audio` property and no per-bus array; a group is a `Float64Array` behind resolved indices so that sampling allocates nothing.
