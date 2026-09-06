---
name: audio
description: Adds sound and music to an ignifx game with @ignifx/audio: the bus tree, AudioSource and AudioListener components, static and streaming AudioClip assets, spatial audio, a music player, and the browser unlock flow. Use when adding or editing sound effects, music, audio buses, mixing, or spatial audio in an ignifx project, or when the user mentions @ignifx/audio, AudioSource, AudioListener, or audio buses.
license: Apache-2.0
metadata:
  ignifx-version: "0.0.0-unreleased"
---

# @ignifx/audio

## What this is / when to use

`@ignifx/audio` is the ignifx extension that plays sound. It wraps Babylon Lite's Web Audio engine
in a mixer tree of named **buses**, an `AudioSource` component per entity, an `AudioListener` for the
ears, and a `MusicPlayer` script with crossfading.

Everything works under Node. The headless backend keeps the same state a real engine keeps and
_simulates_ playback from the frame delta, so `isPlaying`, `instanceCount`, fades, and `onEnded` are
all real in a test that never opens a browser.

Use it for sound effects, footsteps, UI clicks, positional audio, music with crossfades, and the
"tap to start" unlock every browser game needs.

## Environment

- Engine: ignifx `0.0.0-unreleased`; this package targets `@ignifx/core` `>=0.0.0 <1.0.0`.
- Peer dependency: `@babylonjs/lite` `1.27.0`, reached only from `src/lite/**`.
- Browsers, Electron, and Node. Nothing happens at import time; registering the extension is the
  whole installation.

```ts
import { createApp } from "@ignifx/core";
import { audio } from "@ignifx/audio";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas, extensions: [audio({ masterVolume: 0.8 })] });
  await app.start();
}
```

`ignifx.config.ts` carries the same settings under `audio`:

| Setting            | Default                                 | Meaning                                                      |
| ------------------ | --------------------------------------- | ------------------------------------------------------------ |
| `buses`            | `""`                                    | Address of the `.audio.json` bus tree; empty builds defaults |
| `defaultBuses`     | `["Master","Music","SFX","UI","Voice"]` | Tree built when no file is named; the first name is the root |
| `pausableBuses`    | `["Master","Music","SFX","Voice"]`      | Which buses `app.pause()` pauses                             |
| `masterVolume`     | `1`                                     | Master output gain the app starts at                         |
| `queueWhileLocked` | `true`                                  | Whether plays made before the unlock are held                |
| `pauseWithApp`     | `true`                                  | Whether `app.pause()` pauses audio at all                    |

## Mental model

```
app.audio (AudioService)
 ├─ state       "locked" until the audio context runs, then the context's own state
 ├─ buses       Master → { Music, SFX, UI, Voice }   (a gain each, chained)
 ├─ voices      one per (clip, bus, options); each carries N concurrent instances
 ├─ listener    the enabled AudioListener the ears follow
 └─ backend     WebAudioBackend in a browser · HeadlessBackend under Node

AudioSource  → one voice → play() starts an instance (oldest stolen past maxInstances)
AudioListener→ the ears; the most recently enabled one wins
MusicPlayer  → two voices during a crossfade, on the Music bus
```

One `PreRender` system (order `-400`) advances all of it once per frame: fades, pending stops, the
`app.pause()` transition, simulated playback, `onEnded`, and Lite's `updateSpatialAudio`.

## First app

```ts
import { createApp, Script } from "@ignifx/core";
import type { AssetHandle, ScriptCallbacks } from "@ignifx/core";
import { audio, AudioClip, AudioListener, AudioSource } from "@ignifx/audio";

class Beeper extends Script implements ScriptCallbacks {
  static typeId = "mygame/Beeper";

  #source: AudioSource | null = null;

  awake(): void {
    this.#source = this.requireComponent(AudioSource);
  }

  beep(): void {
    this.#source?.play({ pitch: 0.9 + Math.random() * 0.2 });
  }
}

const app = await createApp({ headless: true, extensions: [audio()] });
app.registerComponents([Beeper]);

// Loads awaited before `app.start()` settle as soon as they finish (no frame is needed yet).
const clip: AssetHandle<AudioClip> = app.assets.load<AudioClip>("sfx/beep.wav");
await clip.promise;
await app.start();

app.world.createEntity("Ears").addComponent(AudioListener);
const speaker = app.world.createEntity("Speaker");
speaker.addComponent(AudioSource, { clip, volume: 0.7 });
speaker.addComponent(Beeper).beep();
```

## Core APIs

### `app.audio`

| Member                       | Meaning                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| `state`                      | `"locked"` before the first unlock, then `"running"`/`"suspended"`/…       |
| `unlock()`                   | Resumes the context; call it from a real click handler                     |
| `masterVolume`               | Master output gain, applied after every bus                                |
| `buses`                      | `ReadonlyMap<string, AudioBus>`, in declaration order                      |
| `bus(name)` / `tryBus(name)` | Throws `IGX-1001` / answers `null`                                         |
| `createBus(name, options)`   | Adds a bus at run time                                                     |
| `playOneShot(clip, options)` | Fire-and-forget; `OneShotOptions` is `bus` (default `SFX`) + `PlayOptions` |
| `listener`                   | The active `AudioListener`, or `null`                                      |
| `lite.engine`                | Lite's `AudioEngine`, or `null` headless — unstable escape hatch           |

### `AudioSource`

| Field                                    | Default               | Applied                |
| ---------------------------------------- | --------------------- | ---------------------- |
| `clip`                                   | `null`                | rebuilds the voice     |
| `bus`                                    | `"SFX"`               | rebuilds the voice     |
| `volume`                                 | `1`                   | live                   |
| `pitch`                                  | `1`                   | on the next `play()`   |
| `loop`, `maxInstances`, `spatial`        | `false`, `8`, `false` | rebuilds the voice     |
| `playOnAwake`                            | `false`               | at `awake`             |
| `minDistance`, `maxDistance`, `rolloff`  | `1`, `50`, `1`        | rebuilds the voice     |
| `distanceModel`                          | `"inverse"`           | rebuilds the voice     |
| `cone.innerAngle/outerAngle/outerVolume` | `360`, `360`, `0`     | rebuilds the voice     |
| `pan`                                    | `0`                   | live, non-spatial only |

Methods: `play(options?)`, `playOneShot(clip, options?)`, `stop(fadeSeconds?)`, `pause()`,
`resume()`, and the reads `isPlaying`, `instanceCount`, `instance`, `onEnded`.

The two `playOneShot` methods take **different** options. `AudioSource.playOneShot(clip, options?)`
takes `OneShotVolume` — `{ volume }` and nothing else — and forwards the source's `bus`;
`app.audio.playOneShot(clip, options?)` takes `OneShotOptions`, which is `bus` plus all of
`PlayOptions`. Use the service form when a one-shot needs more than a gain. Either way the voice is
non-spatial and shared per `(clip, bus)`, so a positional impact is `play()` on a spatial
`AudioSource`, not a one-shot.

### `SoundInstance`

`play()` hands back the **sound**, not one of its concurrent instances: Babylon Lite's `playSound`
returns `void` and every control acts on all instances at once, so ignifx does not invent a handle
Lite cannot back. Two `play()` calls on one source return the same object with `instanceCount === 2`.

## Recipes

### Play a footstep with random pitch, eight at a time

```ts run
import { Script } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";
import { AudioSource } from "@ignifx/audio";

export class Footsteps extends Script implements ScriptCallbacks {
  static typeId = "mygame/Footsteps";

  #source: AudioSource | null = null;

  awake(): void {
    this.#source = this.requireComponent(AudioSource);
    this.#source.maxInstances = 8; // the oldest step is stolen past this
  }

  step(): void {
    this.#source?.play({ volume: 0.6, pitch: 0.9 + Math.random() * 0.2 });
  }
}
```

### Wait for a sound to finish, in a headless test

```ts
import { createApp } from "@ignifx/core";
import type { AssetHandle } from "@ignifx/core";
import { audio, AudioClip, AudioSource } from "@ignifx/audio";

const app = await createApp({ headless: true, extensions: [audio()] });

// Before `app.start()` a load settles as soon as it finishes; afterwards it waits for a frame.
const clip: AssetHandle<AudioClip> = app.assets.load<AudioClip>("sfx/door.wav");
await clip.promise;

const source = app.world.createEntity("Door").addComponent(AudioSource, { clip });
await app.start();
app.step(1 / 60);

let ended = false;
source.onEnded.connect(() => {
  ended = true;
});
source.play();

// Simulated playback advances by the frame delta, so this is exact on every machine.
for (let frame = 0; frame < 60 && !ended; frame += 1) {
  app.step(1 / 60);
}
```

### Position a sound in the world

```ts
import { createApp } from "@ignifx/core";
import type { AssetHandle } from "@ignifx/core";
import { audio, AudioClip, AudioListener, AudioSource } from "@ignifx/audio";

const app = await createApp({ headless: true, extensions: [audio()] });
const clip: AssetHandle<AudioClip> = app.assets.load<AudioClip>("sfx/torch.wav");
await clip.promise; // settles at once: the app is not running yet
await app.start();

// The ears usually live on the camera entity.
app.world.createEntity("Main Camera").addComponent(AudioListener);

const torch = app.world.createEntity("Torch");
torch.transform.localPosition.x = 12;
torch.addComponent(AudioSource, {
  clip,
  spatial: true,
  loop: true,
  playOnAwake: true,
  minDistance: 2,
  maxDistance: 40,
  distanceModel: "inverse",
});
```

Angles are **degrees** in `cone`; ignifx converts them to the radians Lite wants. A spatial source
follows its entity automatically: the pump hands Lite the entity's world matrix every frame.

### Crossfade the music

```ts
import { createApp } from "@ignifx/core";
import type { AssetHandle } from "@ignifx/core";
import { audio, AudioClip, MusicPlayer } from "@ignifx/audio";

const app = await createApp({ headless: true, extensions: [audio()] });
await app.start();

const menu: AssetHandle<AudioClip> = app.assets.load<AudioClip>("music/menu.ogg");
const battle: AssetHandle<AudioClip> = app.assets.load<AudioClip>("music/battle.ogg");
await Promise.all([menu.promise, battle.promise]);

const music = app.world.createEntity("Music").addComponent(MusicPlayer, { crossfadeSeconds: 3 });
music.play(menu.value, { fadeIn: 1.5 });
music.crossfadeTo(battle.value, 2);
```

Put the entity in a scene marked `persistent` and the track survives a `"single"` scene load.

### Unlock on the first tap

```ts
import type { App } from "@ignifx/core";

export function installUnlockPrompt(app: App, button: HTMLElement): void {
  button.addEventListener("click", () => {
    void app.audio.unlock().then(() => {
      button.remove();
    });
  });
}
```

Every `play()` made while `app.audio.state === "locked"` is held on its source and started in the
order it was asked for, so game code never has to check.

## File formats

`.audio.json` declares the mixer tree — see `references/formats/ignifx.audiobuses.md`:

```json
{
  "format": "ignifx.audiobuses",
  "formatVersion": 1,
  "buses": [
    { "name": "Master" },
    { "name": "Music", "parent": "Master", "volume": 0.8 },
    { "name": "SFX", "parent": "Master" },
    { "name": "UI", "parent": "Master", "pausable": false }
  ]
}
```

A clip streams instead of decoding when its `.meta.json` sidecar says so:

```json
{ "audio": { "streaming": true } }
```

## Gotchas

- **Do not** expect sound before a user gesture. `app.audio.state` reads `"locked"` until the
  context runs; plays are queued, not lost. Give the player something to tap.
- **Do not** hold a `SoundInstance` expecting it to be one voice among many — it names the sound.
  `stop()` stops every instance of it.
- **Do not** change `pitch` and expect a running instance to follow: Lite fixes an instance's
  playback rate when it starts, so `pitch` applies to the next `play()`.
- **Do not** change `clip`, `bus`, `loop`, `maxInstances`, or `spatial` while a sound is playing
  unless you mean to stop it: a Web Audio route is fixed at creation, so the voice is rebuilt.
- **Do not** rely on `clip.duration` for `.mp3`, `.ogg`, `.webm`, or `.flac` under Node — it is
  `null`, and a simulated instance of such a clip never ends on its own. Use `.wav` in tests.
- **Do not** load a five-minute track as a static clip. Mark it streaming; it plays from a media
  element rather than decoding into memory.
- **Do not** put an `AudioListener` on more than one enabled entity and expect a particular one to
  win: the listener enabled last takes the ears.
- **Do not** call `app.audio.bus("Ambience")` for a bus the tree does not declare — that is
  `IGX-1001`. Declare it in `.audio.json`, in `audio({ defaultBuses })`, or with `createBus`.
- **Do not** await an `.audio.json` load in `onStart`: delivery needs a frame. Sources created
  before the tree exists hold their plays until it arrives.
- `app.pause()` pauses every bus but `UI` by default; `audio({ pauseWithApp: false })` turns it off.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `references/api/audio.md` for the generated
API · `references/formats/ignifx.audiobuses.md` for the bus file · `docs/architecture/10-audio.md`
for the design rationale.
