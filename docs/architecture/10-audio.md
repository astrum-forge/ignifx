# 10 · Audio

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/audio` · **Inspiration:** Godot audio buses, Unity `AudioSource`/`AudioListener`/`AudioMixer`

Babylon Lite ships a complete Web Audio engine (a port of Babylon's Audio V2): engine, buses, static and streaming sounds, spatialization with transform attachment, stereo panning, analyzers, unlock handling. `@ignifx/audio` adds conventions, components, and asset integration on top. Lite API names verified against `@babylonjs/lite@1.27.0`.

**Implementation note (Phase 5).** The package is built against **one `AudioBackend` interface** with two implementations: `WebAudioBackend` (`src/lite/web/**`, the only module that imports `@babylonjs/lite`) and `HeadlessBackend` (`src/headless/**`, pure TypeScript). §7 below is therefore not a stub: the headless backend keeps the same state a real engine keeps and simulates playback from the frame delta, so every gameplay test runs under Node with real semantics. Sections marked _(corrected)_ record where the implementation departs from the text above it, with the reason.

---

## 1. Service (`app.audio`)

```ts
interface AudioService {
  readonly state: "locked" | "running" | "suspended" | "interrupted" | "closed"; // Lite AudioEngineState plus "locked" (created, never unlocked)
  unlock(): Promise<void>; // unlockAudioEngineAsync; also called automatically on the first user gesture
  masterVolume: number; // setMasterVolume/getMasterVolume
  readonly buses: ReadonlyMap<string, AudioBus>; // "Master", "Music", "SFX", "UI", "Voice" by default (createAudioBusAsync)
  bus(name: string): AudioBus; // throws IGX-1001 when unknown
  tryBus(name: string): AudioBus | null; // (corrected) expected absence is not an error
  createBus(name: string, options?: { parent?: string; volume?: number; pausable?: boolean }): Promise<AudioBus>;
  playOneShot(clip: AudioClip, options?: OneShotOptions): SoundInstance; // fire-and-forget on the SFX bus
  readonly listener: AudioListener | null; // active listener component
  readonly onStateChanged: Signal<AudioService["state"]>;
  readonly lite: { readonly engine: AudioEngine | null }; // unstable escape hatch; null headless
}
interface AudioBus {
  readonly name: string;
  readonly parent: AudioBus | null; // (corrected) the tree has to be readable to be inspectable
  readonly pausable: boolean; // (corrected) whether app.pause() pauses it
  volume: number;
  muted: boolean;
  readonly effectiveVolume: number; // (corrected) this bus's applied gain times every ancestor's
  setVolume(v: number, rampSeconds?: number): void;
  readonly lite: LiteAudioBus | null; // (corrected) null headless
}
```

**Corrections.**

- `playOneShot` takes a loaded `AudioClip`, not an `AssetRef`. An `asset()` field decodes to a **loaded `AssetHandle`** (`05-assets-and-loading.md` §3 since Phase 2), so a loaded clip is what game code actually holds; taking a reference would mean returning a `SoundInstance` for a sound that may never load.
- `SoundInstance` names **the sound**, not one of its concurrent instances, and repeated `play()` calls on one source return the same object. Lite's `playSound` returns `void` (`index.d.ts` 8955) and `stopSound`/`pauseSound`/`setSoundVolume` all act on every instance at once, so there is no per-instance handle to hand back; inventing one would mean a Lite sound, and a gain sub-graph, per `play()`. It carries `clip`, `bus`, `isPlaying`, `isPaused`, `instanceCount`, `volume`, `setVolume(v, ramp?)`, `stop(fade?)`, `pause()`, `resume()`, and `onEnded`.
- The engine is created in **`register`**, not in `onStart`. `04-extensions.md` §2.4 allows an async `register`, the audio engine has no dependency on the Lite _render_ engine, and `app.audio` has to be usable the moment `await createApp(…)` returns. A `.audio.json` tree is the exception and is still built at delivery: awaiting an asset in `onStart` deadlocks (`04-extensions.md` §2.5).
- Fades are interpolated by the service in the `PreRender` pump and pushed to the backend as plain values, rather than handed to Lite's `RampOptions` (`index.d.ts` 9339). A Lite ramp runs on the audio context's clock, which no headless test has; Lite's own `parameterRampDuration` (10 ms) still de-clicks each per-frame write.
- There is no `getBusVolume`/`getSoundVolume` in Lite 1.27.0 (only `getMasterVolume`, `index.d.ts` 5819), so `@ignifx/audio` owns the authoritative gain values.

- The engine is created with `createAudioEngineAsync({ resumeOnInteraction: true, resumeOnPause: true })`. Browsers require a user gesture before audio plays; Lite resumes on the first **`click` on `document`** — that one event, not `pointerdown` or `keydown` (`lib/audio/audio-engine.js`) — and `unlock()` exists for explicit prompts ("tap to start"). Until unlocked, `play()` calls are queued per source (configurable: `audio({ queueWhileLocked: true })`).
- Bus layout comes from `.audio.json` (`{ "format": "ignifx.audiobuses", "formatVersion": 1, "buses": [{ "name": "Music", "parent": "Master", "volume": 0.8 }, …] }`) or defaults. Buses route to their parent (`outBus`), ending at Lite's main bus. A bus must be declared **after** the bus it routes into: a forward reference and a cycle are then the same failure (`IGX-1006`) and validation is one linear pass. Each entry may carry `"pausable"`, overriding the `audio.pausableBuses` setting for that bus.
- _(corrected)_ The tree's default root is the **first** name in `audio.defaultBuses`; every other name routes into it.
- Effects (reverb, EQ, compressor) are not part of Lite; post-1.0 they are built with Web Audio nodes inserted through `engine.audioContext` (`createSoundSourceAsync`). The bus API reserves an `effects` field for that.

## 2. `AudioClip` asset

- Loader for `.mp3`, `.ogg`, `.wav`, `.webm`, `.flac` (browser-decodable). Sidecar `.meta.json` chooses `{ "audio": { "streaming": true } }`.
- Static clips decode into a Lite `SoundBuffer` (`createSoundBufferAsync`) shared by all sources; streaming clips are media-element backed (`createStreamingSoundAsync`) and created per playing source. Static is the default; use streaming for music longer than ~30 s.
- Headless: the loader returns duration metadata only.

**Corrections.**

- The clip's shape is `{ address, url, isStreaming, duration: number | null, channels: number | null, sampleRate: number | null, byteLength, isDecoded, lite: { buffer: LiteSoundBuffer | null } }`. `duration` is `null` when this build could not determine it: under Node only a `.wav` header is parsed, because MP3, OGG, WebM, and FLAC need a container parser and coding standards §13 makes that a dependency decision with an ADR paragraph behind it. A headless instance of a `null`-duration clip never ends on its own, which the headless backend documents.
- A streaming clip is **never fetched** by the loader: Lite's `createStreamingSoundAsync` takes the URL and builds the media element, so fetching would download the file twice.
- Whether the loader decodes is decided by "does this app have a decoder", not by `app.isHeadless`: a browser test drives a headless app against a real `OfflineAudioContext`, and that app decodes. With no decoder the bytes are released as soon as the header has been read.

## 3. `AudioSource` component

_(corrected)_ `AudioSource`, `AudioListener`, and `MusicPlayer` extend **`Script`**, not `Component`. This kernel delivers `awake`, `onEnable`, and `onDisable` only to classes deriving from `Script` (`packages/core/src/lifecycle/lifecycle-queue.ts`: `invokeCallback` returns early when the class carries no script info), and `playOnAwake` is defined in terms of `awake` — which is also the first callback that sees a scene file's decoded props (`06-serialization-and-scene-format.md` §4). Under `isolatedDeclarations` the fields are declared with `declare` over a `static schema`, exactly as the core render components do, rather than through `Script.define`.

```ts
class AudioSource extends Component.define({
  clip: asset(AudioClip),
  bus: str("SFX"),
  volume: f32(1, { min: 0, max: 1 }),
  pitch: f32(1, { min: 0.1, max: 4 }), // playbackRate
  loop: bool(false),
  playOnAwake: bool(false),
  maxInstances: i32(8),
  spatial: bool(false), // 3D positional audio (enableSpatial)
  minDistance: f32(1),
  maxDistance: f32(50),
  rolloff: f32(1),
  distanceModel: enumOf(["linear", "inverse", "exponential"] as const, "inverse"),
  cone: record({ innerAngle: f32(360), outerAngle: f32(360), outerVolume: f32(0) }),
  pan: f32(0, { min: -1, max: 1 }), // stereo pan for non-spatial sources (enableStereo/setStereoPan)
}) {
  play(options?: PlayOptions): SoundInstance; // new instance per call (playSound), subject to maxInstances
  playOneShot(clip: AudioClip, volume?: number): SoundInstance;
  stop(fadeSeconds?: number): void;
  pause(): void;
  resume(): void;
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

- Spatial sources attach to the entity's transform node through Lite's `attachedTo` (`attachSpatialTarget`), so position and orientation follow automatically; `updateSpatialAudio(engine)` is pumped once per frame in `PreRender` at **order −400** — after physics interpolation (−500) and well before the render sync (900) — and `setSpatialAutoUpdate(engine, false)` keeps Lite from starting a second `requestAnimationFrame` loop (`CONSTITUTION.md` §3.2).
- Angles are degrees in the schema and converted to radians for Lite; `pitch` maps to `playbackRate` (Lite's `pitch` is in cents and is not exposed).
- Streaming clips ignore `maxInstances > preloadCount` and warn.

**Corrections.**

- `maxInstances` **steals the oldest** instance rather than refusing the newest, which is what Lite does (`lib/audio/static-sound.js`, `_stopExcessInstances`) and what a footstep loop wants.
- `volume` and `pan` are pushed to a running sound as soon as they change. `pitch` applies to the **next** `play()`: Lite fixes an instance's playback rate when it starts. `clip`, `bus`, `loop`, `maxInstances`, and the spatial parameters rebuild the voice — a Web Audio route is fixed at creation — which stops whatever is playing.
- `onEnded` is raised from the `PreRender` pump when the sound stops carrying instances, whether it ran out or was stopped, and never for a sound that is merely paused. Lite's own `onEnded` comes off a Web Audio `ended` event at an arbitrary point between frames and is deliberately not used.
- `PlayOptions.volume` defaults to `1` and multiplies the source's `volume` field, the way Unity's `PlayOneShot` volume scale does.
- `AudioSource.playOneShot(clip, { volume })` takes an options object rather than a bare number, matching every other options-taking call in the engine (coding standards §5.4).

## 4. `AudioListener` component

One active listener (usually on the main camera entity; templates add it there). Maps to `setSpatialListener(engine, { attachedTo: node })`. When no listener is enabled, spatial sources fall back to the world origin and a development warning is logged once (`IGX-1002`) — Lite builds a listener at the origin on first use either way (`lib/audio/spatial.js`, `ensureSpatialSubNode`).

_(corrected)_ Selection is "the most recently **enabled** listener wins", which during a scene load is the one with the highest creation serial; disabling it hands the ears back to the previous one. The component declares no serialized fields: which listener is active is decided by which one is enabled, and a scene file already records that.

## 5. Music

`MusicPlayer` (script in `@ignifx/audio`): `play(clip, { fadeIn })`, `crossfadeTo(clip, seconds)`, `stop({ fadeOut })`, playlist support, routes to the `Music` bus, uses streaming clips, and survives scene loads when placed in a persistent scene.

_(corrected)_ Whether a track streams is a property of the **clip** (its `.meta.json` sidecar), not of the player; the player plays whatever it is given. Its fields are `playlist`, `bus` (`"Music"`), `volume`, `playOnAwake`, `autoAdvance`, `loopPlaylist`, `loopTrack`, and `crossfadeSeconds`. A crossfade holds two voices at once; a track that **ends** advances the playlist when `autoAdvance` is set, and a track that is **stopped** does not, because a stop is a decision and an ending is not.

## 6. Pausing and focus

- `app.pause()` pauses sources on buses marked `pausable` (default: all except `UI`); `resume()` restores them. Configurable with `audio({ pauseWithApp: false })`.
- Tab hidden/interrupted contexts are handled by Lite (`resumeOnPause`); `app.audio.state` reflects `"interrupted"`.

_(corrected)_ `App` has no pause signal, so the transition is **polled** in the `PreRender` pump: `app.pause()` sets `time.paused` (`01-lifecycle-and-time.md` §7) and the pump compares it with the previous frame's value. Polling one boolean once a frame allocates nothing and needs no kernel change; if `App.onPaused` ever lands, the poll becomes a connection. `resume()` un-pauses exactly the voices the pause paused, so a sound the game paused itself stays paused.

## 7. Headless behaviour

Node has no Web Audio; the service runs a **simulation** backend — not a no-op — that tracks state (`isPlaying`, `isPaused`, instance counts, gains, oldest-instance stealing) and ends an instance after `clip.duration / playbackRate` seconds of engine time, so gameplay tests remain meaningful.

The clock is the engine clock the `PreRender` pump advances, not `Date.now()` and not `performance.now()`: `app.step(1 / 60)` advances audio by exactly one sixtieth of a second, so a test that steps sixty times has advanced audio by exactly one second on every machine (coding standards §10). `HeadlessBackend({ startSuspended: true })` reproduces a browser's locked context, so the unlock flow is exercised under Node too.

## 8. Diagnostics

`app.diagnostics.group("audio")`: `state` (an index into `locked, running, suspended, interrupted, closed`), `voices`, `instances`, `streaming`, `buses`, `unlockedAtMs`; devtools shows bus faders and optional analyzers (`enableAnalyzer`).

_(corrected)_ The counters are flat numbers in one `DiagnosticsGroup`, which is what `15-devtools-and-diagnostics.md` §3 and core's `Diagnostics.registerGroup` provide — there is no `app.diagnostics.audio` property and no per-bus array; a group is a `Float64Array` behind resolved indices so that sampling allocates nothing.
