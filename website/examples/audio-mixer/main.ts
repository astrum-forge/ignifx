import { AUDIO_ASSET_TYPE, audio, AudioSource, Camera, MusicPlayer, parseAudioBusesFile } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, button, readout, slider } from "../_kit/panel.ts";
import { createGridGround, createLightRig } from "../_kit/stage.ts";
import busesSource from "./game.audio.json?raw";
import { attachMixer } from "./mixer.ts";
import type { MixerDesk, PadId } from "./mixer.ts";
import type { PanelControl } from "../_kit/panel.ts";
import type { App, AssetHandle, AudioClip } from "ignifx";

/**
 * The mixer: a bus tree from an `.audio.json`, four faders that **are** those buses, five pads that
 * fire sounds through them, and the browser's autoplay lock shown rather than hidden.
 *
 * ## The tree comes from the document, before the first frame
 *
 * `game.audio.json` beside this file is the mixer: `Master`, with `Music`, `SFX` and `UI` under it.
 * It is imported with `?raw`, checked by `parseAudioBusesFile` — the same parser the asset loader
 * uses — and handed to `audio({ busTree })`, which builds the tree during `createApp`. A tree named
 * as an **address** (`audio({ buses: "audio/game.audio.json" })`) is what a game normally writes,
 * and it arrives a frame later, because asset delivery needs a stepped frame; `busTree` is the only
 * way to have a custom tree standing before the first one. It is imported here, rather than
 * vendored under `website/examples/assets/`, so the viewer page can show it as a tab beside this
 * file — which is the point of the example.
 *
 * ## Nothing is audible before a gesture, and nothing is lost either
 *
 * `app.audio.state` reads `"locked"` until the audio context runs. Every `play()` made before then
 * is **held on its voice and flushed in order** the moment it does, so game code never has to
 * check: the ring on the floor pulses amber, the panel reads `locked`, and the queue counter shows
 * how many plays are waiting. Clicking anywhere unlocks it — Babylon Lite resumes the context on
 * the first click in the document — and the panel's Unlock button calls `app.audio.unlock()`
 * itself, which is what a "tap to start" screen does.
 *
 * ## Two ways to play, and when each is right
 *
 * The three impact pads own an `AudioSource`: a component with a clip, a bus and an instance limit,
 * which is what a thing in the world that makes a noise should be. The UI click goes through
 * `app.audio.playOneShot`, which is fire-and-forget and needs no entity. `pitch` is a **field** on
 * the source rather than an argument, because Babylon Lite fixes an instance's playback rate when
 * it starts — so setting it applies to the next `play()`.
 */

/** The clips this example loads, by the address the asset manifest resolves. */
const CLIPS = {
  music: "audio/ambient.wav",
  pickup: "audio/pickup.wav",
  jump: "audio/jump.wav",
  land: "audio/land.wav",
  click: "audio/ui-click.wav",
} as const;

/** The buses, in fader order: the names `game.audio.json` declares. */
const BUSES = ["Master", "Music", "SFX", "UI"] as const;

/** How much a one-shot's pitch may wander, so a repeated impact does not sound like a machine. */
const PITCH_SPREAD = 0.14;

/** Where the camera starts. */
const SHOT = { yaw: 0, pitch: 28, distance: 4.75, target: { x: 0, y: 0.56, z: 0.12 } } as const;

/** `JSON.parse` answers `any`; the document is `unknown` until the parser has checked it. */
const busesJson: unknown = JSON.parse(busesSource);

/**
 * Loads one clip.
 *
 * @param app - The app whose asset service loads it.
 * @param address - The manifest address.
 * @returns The handle, with one holder.
 */
function loadClip(app: App, address: string): AssetHandle<AudioClip> {
  return app.assets.load<AudioClip>(address, { type: AUDIO_ASSET_TYPE });
}

/**
 * Writes a gain as a percentage.
 *
 * @param value - The linear gain, `0` to `1`.
 * @returns The text for a slider's value cell.
 */
function gain(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

bootExample({
  title: "Audio mixer",
  extensions: [audio({ busTree: parseAudioBusesFile(busesJson, "game.audio.json"), masterVolume: 0.9 })],
  settings: {
    rendering: {
      clearColor: { r: 0.035, g: 0.043, b: 0.059, a: 1 },
      msaaSamples: 4,
      // No `shadows` feature: nothing on the desk casts one, and asking for the pass anyway made
      // Dawn refuse the frame — the empty shadow map ends up read and written in one synchronisation
      // scope ("usage includes writable usage and another usage in the same synchronization scope",
      // measured on SwiftShader 2026-09-08). A feature is read once at `app.start()`, so this is the
      // place it has to be right.
      features: {},
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel, random }) {
    const eye = app.world.createEntity("Main Camera");
    const camera = eye.addComponent(Camera, { near: 0.05, far: 120, fov: 42 });
    attachOrbit(app, eye, { ...SHOT, minDistance: 2.4, maxDistance: 12, minPitch: 6, maxPitch: 72 });

    // Awaited before `app.start()`: a load that completes before the loop runs settles at once,
    // where one awaited afterwards waits for a `PreUpdate`.
    await createGridGround(app, { size: 60, color: { r: 0.17, g: 0.19, b: 0.24, a: 1 } });
    createLightRig(app, { focus: { x: 0, y: 0.4, z: 0.2 }, keyIntensity: 2.2, rimIntensity: 0.8, shadows: false });

    const clips = {
      music: loadClip(app, CLIPS.music),
      pickup: loadClip(app, CLIPS.pickup),
      jump: loadClip(app, CLIPS.jump),
      land: loadClip(app, CLIPS.land),
      click: loadClip(app, CLIPS.click),
    };
    await Promise.all(Object.values(clips).map((handle: AssetHandle<AudioClip>) => handle.promise));

    // One `AudioSource` per impact: a clip, a bus and an instance limit. Past `maxInstances` the
    // oldest instance is stolen, which is what stops a held-down pad stacking into a roar.
    const source = (name: string, clip: AssetHandle<AudioClip>): AudioSource =>
      app.world
        .createEntity(`${name} source`)
        .addComponent(AudioSource, { clip, bus: "SFX", volume: 0.85, maxInstances: 6 });
    const impacts = {
      pickup: source("Pickup", clips.pickup),
      jump: source("Jump", clips.jump),
      land: source("Land", clips.land),
    };
    const music = app.world
      .createEntity("Music")
      .addComponent(MusicPlayer, { crossfadeSeconds: 1.5, loopTrack: true, volume: 1 });

    let queued = 0;
    let playing = false;
    // The desk is built below and lights its own lamps; the only thing these handlers need it for
    // is latching the music pad, so it is read through a variable the builder fills in.
    let desk: MixerDesk | null = null;

    /** Counts a play made before the unlock, so the panel can show that none was dropped. */
    const countIfQueued = (): void => {
      if (app.audio.isLocked && app.audio.queueWhileLocked) {
        queued += 1;
      }
    };
    const impact = (name: "jump" | "land" | "pickup"): void => {
      const emitter = impacts[name];
      // `random` is the kit's seeded generator; an example never calls `Math.random`.
      emitter.pitch = 1 - PITCH_SPREAD / 2 + random() * PITCH_SPREAD;
      emitter.play();
      countIfQueued();
    };
    const uiClick = (): void => {
      // Fire and forget, on a bus `app.pause()` never pauses: a menu keeps its own clicks audible.
      app.audio.playOneShot(clips.click.value, { bus: "UI", volume: 0.8 });
      countIfQueued();
    };
    const toggleMusic = (): void => {
      playing = !playing;
      if (playing) {
        music.play(clips.music.value, { fadeIn: 1.2 });
      } else {
        music.stop({ fadeOut: 0.8 });
      }
      countIfQueued();
      desk?.latch("music", playing);
    };

    desk = attachMixer(app, camera, {
      play: (pad: PadId): void => {
        if (pad === "music") {
          toggleMusic();
        } else if (pad === "click") {
          uiClick();
        } else {
          impact(pad);
        }
      },
      // One bus, one flag: `muted` silences a bus and everything under it without losing where its
      // fader was. Muting `Master` is how a game's "mute all" works.
      toggleMute: (name: string): void => {
        const bus = app.audio.bus(name);
        bus.muted = !bus.muted;
      },
    });

    // A start-up chime, made while the context is still locked. It is **not** dropped: the voice
    // holds it and the service flushes every held play, in the order it was asked for, the moment
    // the context runs — which is why the queue counter below reads 1 before anyone has clicked and
    // "flushed" afterwards. A game's menu music is the same call in the same place.
    impact("pickup");

    // A slider and a button per bus, and one readout for the mutes. Not a `toggle`: a checkbox is
    // written once when the panel mounts, so it would go stale the moment a click on a fader in the
    // scene muted the same bus. A button cannot disagree with anything, and the readout is re-read
    // four times a second.
    const faders: PanelControl[] = BUSES.flatMap((name: string): readonly PanelControl[] => {
      const bus = app.audio.bus(name);
      return [
        slider(name, { min: 0, max: 1, step: 0.01, format: gain }, bind(bus, "volume")),
        button(`Mute ${name}`, (): void => {
          bus.muted = !bus.muted;
        }),
      ];
    });
    faders.push(
      readout("Muted", (): string => {
        const muted = BUSES.filter((name: string) => app.audio.bus(name).muted);
        return muted.length === 0 ? "none" : muted.join(", ");
      }),
      // The output gain sits after every bus, which is why it is not a fader on the desk: it is the
      // system volume, not part of the tree.
      slider("Output gain", { min: 0, max: 1, step: 0.01, format: gain }, bind(app.audio, "masterVolume")),
    );

    panel({
      title: "Audio mixer",
      groups: [
        {
          label: "Sound",
          controls: [
            readout("State", (): string => app.audio.state),
            readout("Queued while locked", (): string => {
              if (queued === 0) {
                return "0";
              }
              return `${String(queued)} ${app.audio.isUnlocked ? "flushed" : "waiting"}`;
            }),
            button("Unlock", (): void => {
              // A real gesture: a click handler is exactly where a resume belongs.
              void app.audio.unlock();
            }),
          ],
        },
        { label: "Mixer", controls: faders },
        {
          label: "Play",
          controls: [
            button("Pickup", (): void => {
              impact("pickup");
            }),
            button("Jump", (): void => {
              impact("jump");
            }),
            button("Land", (): void => {
              impact("land");
            }),
            button("UI click", uiClick),
            button("Music", toggleMusic),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [
            readout("Music playing", (): string => (music.isPlaying ? "yes" : "no")),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
          ],
        },
      ],
    });
  },
});
