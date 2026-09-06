# Template audio — attribution

Every sound the four templates ship is an **original work created for this repository** by Astrum
Forge Studios and is covered by the repository's Apache-2.0 licence. Nothing here is copied from,
derived from, or redistributed out of a third-party sound library, no file was downloaded, and no
audio library is involved (`CONSTITUTION.md` §11.3). Every sample is a number this script computes:
sines, seeded white noise and a one-pole low-pass, written to disk through the hand-written
RIFF/WAVE encoder in `../2d-templates/png.mjs`.

This directory holds the **generator**, not the output: the files it writes land in
`templates/<name>/assets/`, because a template has to be self-contained — `create-ignifx` copies the
directory verbatim into a player's project and cannot reference a path in this repository.

```sh
node tests/fixtures/assets/audio-templates/make-template-audio.mjs
```

It is deterministic — every random value comes from the seeded generator in `png.mjs`, never from
`Math.random` — so a regenerated file is byte for byte the file that is committed, and it refuses to
write anything over the 60 KB per-file budget.

## What it writes

Each of `2d-topdown`, `2d-sidescroller`, `3d-third-person` and `3d-first-person` gets the same seven
clips and the same `game.audio.json` mixer document. The clips are mono 16-bit PCM.

| File           | Bus   | Rate      | Length | What it is                                                              |
| -------------- | ----- | --------- | ------ | ----------------------------------------------------------------------- |
| `footstep.wav` | SFX   | 22.05 kHz | 110 ms | Noise low-passed to a body thump over a sine two octaves under the root |
| `jump.wav`     | SFX   | 22.05 kHz | 160 ms | A sine sweeping one octave up from the root, plus a second harmonic     |
| `land.wav`     | SFX   | 22.05 kHz | 200 ms | The footstep's heavier relative: twice low-passed, three octaves down   |
| `pickup.wav`   | SFX   | 22.05 kHz | 320 ms | Three bells 60 ms apart — root, major third, octave — struck partials   |
| `ui-click.wav` | UI    | 22.05 kHz | 55 ms  | Bright noise with a very fast decay over a sine above the root          |
| `ui-hover.wav` | UI    | 22.05 kHz | 40 ms  | The click, shorter, higher and levelled well under it                   |
| `ambient.wav`  | Music | 8 kHz     | 3.6 s  | A seamlessly looping chord pad                                          |

Every clip is peak-normalised rather than mixed by ear, so nothing clips: 0.7 of full scale for the
effects, 0.4 for `ui-hover.wav` — a hover fires far more often than a click and has to sit under it
— and 0.35 for the pad.

## Why the four templates do not sound alike

Each template is transposed to its own root and its pad holds its own chord, so the set shares a
vocabulary without sounding like one game.

| Template          | Root         | Pad chord  |
| ----------------- | ------------ | ---------- |
| `2d-topdown`      | A, 440 Hz    | minor add9 |
| `2d-sidescroller` | C, 523.25 Hz | sus2       |
| `3d-third-person` | G, 392 Hz    | major      |
| `3d-first-person` | D, 293.66 Hz | minor 7    |

## Why `ambient.wav` is 8 kHz

A pad has no high-frequency content, so the rate buys length instead: 60 KB is 1.36 seconds at
22.05 kHz but 3.8 seconds at 8 kHz, and a 3.6-second loop is long enough not to be heard repeating
in the first few seconds of play.

## How the loop is seamless

Every oscillator in the pad is counted in **whole cycles per loop**, not in hertz: a voice asked for
`f` hertz is rendered at `round(f × 3.6) / 3.6`, so it ends the buffer where it started and the
sample after the last one is the first one. The amplitude LFOs and the one-cycle detunings are
counted the same way, and the spectral tilt that keeps the pad soft is an arithmetic gain per voice
rather than a filter, because a filter has state that would not repeat across the seam. **No fade is
applied at either end** — a fade is exactly what puts a step at the seam.

The script measures the result and prints it: the step across the wrap next to the mean and largest
steps the clip already takes internally. The wrap step lands at roughly the mean step and about a
third of the largest, which is what a join indistinguishable from an ordinary sample looks like.
