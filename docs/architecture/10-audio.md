# 10 · Audio

**Status:** Design standard (pre-1.0) · **Package:** `@ignifx/audio` · **Inspiration:** Godot audio buses, Unity `AudioSource`/`AudioListener`/`AudioMixer`

Babylon Lite ships a complete Web Audio engine (a port of Babylon's Audio V2): engine, buses, static and streaming sounds, spatialization with transform attachment, stereo panning, analyzers, unlock handling. `@ignifx/audio` adds conventions, components, and asset integration on top. Lite API names verified against `@babylonjs/lite@1.27.0`.

---

## 1. Service (`app.audio`)

```ts
interface AudioService {
  readonly state: "locked" | "running" | "suspended" | "interrupted" | "closed"; // Lite AudioEngineState plus "locked" (created, never unlocked)
  unlock(): Promise<void>; // unlockAudioEngineAsync; also called automatically on the first user gesture
  masterVolume: number; // setMasterVolume/getMasterVolume
  readonly buses: ReadonlyMap<string, AudioBus>; // "Master", "Music", "SFX", "UI", "Voice" by default (createAudioBusAsync)
  bus(name: string): AudioBus; // throws IGX-1001 when unknown
  createBus(name: string, options?: { parent?: string; volume?: number }): Promise<AudioBus>;
  playOneShot(clip: AudioClip | AssetRef<AudioClip>, options?: PlayOptions): SoundInstance; // fire-and-forget on the SFX bus
  readonly listener: AudioListener | null; // active listener component
  readonly onStateChanged: Signal<AudioService["state"]>;
  readonly lite: { readonly engine: AudioEngine }; // unstable escape hatch
}
interface AudioBus {
  readonly name: string;
  volume: number;
  muted: boolean;
  setVolume(v: number, rampSeconds?: number): void;
  readonly lite: LiteAudioBus;
}
```

- The engine is created in `onStart` (`createAudioEngineAsync({ resumeOnInteraction: true, resumeOnPause: true })`). Browsers require a user gesture before audio plays; Lite resumes on the first click/tap automatically and `unlock()` exists for explicit prompts ("tap to start"). Until unlocked, `play()` calls are queued per source (configurable: `audio({ queueWhileLocked: true })`).
- Bus layout comes from `.audio.json` (`{ "format": "ignifx.audiobuses", "buses": [{ "name": "Music", "parent": "Master", "volume": 0.8 }, …] }`) or defaults. Buses route to their parent (`outBus`), ending at Lite's main bus.
- Effects (reverb, EQ, compressor) are not part of Lite; post-1.0 they are built with Web Audio nodes inserted through `engine.audioContext` (`createSoundSourceAsync`). The bus API reserves an `effects` field for that.

## 2. `AudioClip` asset

- Loader for `.mp3`, `.ogg`, `.wav`, `.webm`, `.flac` (browser-decodable). Sidecar `.meta.json` chooses `{ "audio": { "streaming": false, "preload": true } }`.
- Static clips decode into a Lite `SoundBuffer` (`createSoundBufferAsync`) shared by all sources; streaming clips are media-element backed (`createStreamingSoundAsync`) and created per playing source. Static is the default; use streaming for music longer than ~30 s.
- Headless: the loader returns duration metadata only.

## 3. `AudioSource` component

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

- Spatial sources attach to the entity's transform node through Lite's `attachedTo` (`attachSpatialTarget`), so position and orientation follow automatically; `updateSpatialAudio(engine)` is pumped once per frame in `PreRender` (auto-update is disabled to keep the pump in a defined phase).
- Angles are degrees in the schema and converted to radians for Lite; `pitch` maps to `playbackRate` (Lite's `pitch` is in cents and is not exposed).
- Streaming clips ignore `maxInstances > preloadCount` and warn.

## 4. `AudioListener` component

One active listener (usually on the main camera entity; templates add it there). Maps to `setSpatialListener(engine, { attachedTo: node })`. When no listener is enabled, spatial sources fall back to the world origin and a development warning is logged once (`IGX-1002`).

## 5. Music

`MusicPlayer` (script in `@ignifx/audio`): `play(clip, { fadeIn })`, `crossfadeTo(clip, seconds)`, `stop({ fadeOut })`, playlist support, routes to the `Music` bus, uses streaming clips, and survives scene loads when placed in a persistent scene.

## 6. Pausing and focus

- `app.pause()` pauses sources on buses marked `pausable` (default: all except `UI`); `resume()` restores them. Configurable with `audio({ pauseWithApp: false })`.
- Tab hidden/interrupted contexts are handled by Lite (`resumeOnPause`); `app.audio.state` reflects `"interrupted"`.

## 7. Headless behaviour

Node has no Web Audio; the service runs a no-op backend that tracks state (`isPlaying`, instance counts, `onEnded` after the clip's duration in simulated time) so gameplay tests remain meaningful.

## 8. Diagnostics

`app.diagnostics.audio`: state, active instances per bus, streaming count, unlock timestamp; devtools shows bus faders and optional analyzers (`enableAnalyzer`).
