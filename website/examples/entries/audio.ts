/**
 * Audio examples: the mixer, positional sound, unlocking.
 *
 * One file per gallery category, so several people can add examples at once without editing the
 * same file (`website/plan/08-execution.md` §5). `category` is pinned by the type: an entry that
 * belongs elsewhere does not compile here. Display order within the category is array order; the
 * categories themselves are ordered by `CATEGORIES` in `../catalogue.ts`, which concatenates every
 * file and rejects a duplicate slug.
 */
import type { ExampleOf } from "../catalogue.ts";

/** The Audio examples, in display order. */
export const AUDIO: readonly ExampleOf<"Audio">[] = [
  {
    slug: "audio-mixer",
    title: "Audio mixer",
    category: "Audio",
    dimension: "3D",
    priority: "P0",
    status: "ready",
    line: "A bus tree with faders: one-shots on SFX, a loop on Music, and the autoplay lock in plain sight.",
    paragraph:
      "The four faders are the four buses of `game.audio.json` — `Master`, with `Music`, `SFX` and `UI` routed " +
      "into it — and the rail on the floor is that routing. A fader's knob is the bus's own gain; the lamp above " +
      "it is the gain that actually reaches the output, so pulling `Master` down dims every lamp while the three " +
      "faders under it stay where they are. Click a pad to fire a sound through its bus, click a fader to mute " +
      "one. The ring on the floor is the browser's autoplay lock: it pulses amber until the audio context runs, " +
      "and the chime this example asks for while it is still locked is queued rather than dropped.",
    tries: [
      "Click anywhere: the ring turns green, and the chime queued before that first click plays now.",
      "Pull the Master fader down and watch every lamp on the desk dim while the three faders under it hold their place.",
      "Click the leftmost pad to start the loop, then click the Music fader: the knob turns red and the loop goes quiet.",
    ],
    uses: [
      "parseAudioBusesFile",
      "app.audio.bus",
      "AudioBus",
      "AudioSource",
      "MusicPlayer",
      "app.audio.playOneShot",
      "app.audio.unlock",
    ],
    assets: [
      {
        name: "ambient.wav — the music loop",
        licence: "Apache-2.0",
        author: "Astrum Forge Studios",
        source: "https://github.com/astrum-forge/ignifx/blob/main/templates/2d-topdown/assets/ambient.wav",
      },
      {
        name: "pickup.wav, jump.wav, land.wav — the SFX pads",
        licence: "Apache-2.0",
        author: "Astrum Forge Studios",
        source: "https://github.com/astrum-forge/ignifx/blob/main/templates/2d-topdown/assets/pickup.wav",
      },
      {
        name: "ui-click.wav — the UI pad",
        licence: "Apache-2.0",
        author: "Astrum Forge Studios",
        source: "https://github.com/astrum-forge/ignifx/blob/main/templates/2d-topdown/assets/ui-click.wav",
      },
    ],
    controls: ["mouse", "touch", "gamepad"],
    posterAlt:
      "Three coloured faders — orange, cyan and amber — stand in a row on a dark grid floor, with a fourth green " +
      "fader raised behind them and a pale rail linking all four. Five round pads sit across the front of the " +
      "rig, one brown, three teal and one olive, and a thin amber ring is drawn on the floor around the desk.",
    sourceFiles: ["main.ts", "game.audio.json", "mixer.ts"],
    guide: "play-a-one-shot-and-a-loop",
  },
];
