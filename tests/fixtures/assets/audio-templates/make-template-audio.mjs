// Regenerates every sound the four templates ship. Run with:
//   node tests/fixtures/assets/audio-templates/make-template-audio.mjs
//
// Every sample is arithmetic evaluated here, so the audio is an original work (see ATTRIBUTION.md).
// Nothing is downloaded and no audio library is involved: the RIFF/WAVE encoder and the seeded
// generator both come from `../2d-templates/png.mjs`, which is written against the published
// specification (`CONSTITUTION.md` §11.3).
//
// The files are written straight into `templates/<name>/assets/`, because a template has to be
// self-contained: `create-ignifx` copies the directory verbatim into a player's project, so it
// cannot reference a path in this repository.
//
// Each template gets the same seven clips transposed to its own root and its own pad chord, so the
// four templates share a vocabulary without sounding like one game. `ambient.wav` is built to loop:
// every partial in it is an integer multiple of 1/L for the loop length L, so the sample after the
// last one is the first one, and no fade is applied at either end — a fade is what would break the
// seam. The script prints the measured wrap step next to the steps the clip already takes.
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { encodeWav, rng } from "../2d-templates/png.mjs";

const HERE = import.meta.dirname;
const REPO = join(HERE, "..", "..", "..", "..");

/** The rate every short effect is rendered at; 22.05 kHz keeps a bright click bright. */
const SFX_RATE = 22_050;

/** The rate the pad is rendered at. A pad has no content up here, and 8 kHz buys seconds of loop. */
const PAD_RATE = 8_000;

/** The pad's loop length, in seconds. Every pad partial completes a whole number of cycles in it. */
const PAD_SECONDS = 3.6;

/** The per-file budget. 60 KB is 1.36 seconds at `SFX_RATE`, and 3.8 seconds at `PAD_RATE`. */
const MAX_BYTES = 60 * 1_024;

/**
 * The mixer document every template ships, byte for byte. The bus names are fixed by the settings
 * screen and the pause menu, so they are not renamed here and no fifth bus is added.
 *
 * `UI` is not pausable because the pause menu's own clicks have to be audible while the app is
 * paused. `Music` is not pausable either: the pause menu **ducks** the music with a volume ramp
 * rather than stopping it, and `app.pause()` would silence a pausable bus outright, leaving nothing
 * to duck.
 */
const AUDIO_BUSES = `{
  "format": "ignifx.audiobuses",
  "formatVersion": 1,
  "buses": [
    { "name": "Master", "parent": "", "volume": 1 },
    { "name": "Music", "parent": "Master", "volume": 0.6, "pausable": false },
    { "name": "SFX", "parent": "Master", "volume": 0.8, "pausable": true },
    { "name": "UI", "parent": "Master", "volume": 0.9, "pausable": false }
  ]
}
`;

/**
 * The four templates, each with the root its effects are transposed to and the chord its pad
 * holds. The roots are a fourth and a fifth apart rather than adjacent, so switching templates is
 * audible immediately; the chords carry the mood.
 */
const TEMPLATES = [
  { name: "2d-topdown", rootHz: 440, chord: [0, 3, 7, 14], chordName: "A minor add9", seed: 0x2d_71_00_01 },
  { name: "2d-sidescroller", rootHz: 523.25, chord: [0, 2, 7, 12], chordName: "C sus2", seed: 0x2d_51_00_02 },
  { name: "3d-third-person", rootHz: 392, chord: [0, 4, 7, 12], chordName: "G major", seed: 0x3d_73_00_03 },
  { name: "3d-first-person", rootHz: 293.66, chord: [0, 3, 7, 10], chordName: "D minor 7", seed: 0x3d_51_00_04 },
];

const written = [];

// --- building blocks ----------------------------------------------------------------------------

/**
 * Draws a run of white noise from a seeded generator, the raw material every thud and click is
 * filtered out of.
 * @param random - The generator to draw from.
 * @param count - How many samples to draw.
 * @returns The samples, each in `[-1, 1)`.
 */
function noise(random, count) {
  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 1) out[i] = random() * 2 - 1;
  return out;
}

/**
 * Applies a one-pole low-pass, which is what turns a hiss into a thud.
 * @param samples - The samples to filter, modified in place.
 * @param cutoffHz - The corner frequency, in hertz.
 * @param sampleRate - The rate the samples are at, in hertz.
 * @returns The same array.
 */
function lowPass(samples, cutoffHz, sampleRate) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let y = 0;
  for (let i = 0; i < samples.length; i += 1) {
    y += a * (samples[i] - y);
    samples[i] = y;
  }
  return samples;
}

/**
 * Scales a clip so its loudest sample sits at a chosen level. Every clip is levelled this way
 * rather than by ear, so nothing clips and the set is balanced.
 * @param samples - The samples to scale, modified in place.
 * @param peak - The level the loudest sample ends at, 0 to 1.
 * @returns The same array.
 */
function normalise(samples, peak) {
  let loudest = 0;
  for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
  if (loudest === 0) return samples;
  const gain = peak / loudest;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  return samples;
}

/**
 * A percussive envelope: a linear attack short enough to stay sharp but long enough not to click,
 * then an exponential decay.
 * @param t - The time since the onset, in seconds.
 * @param attack - The attack, in seconds.
 * @param decay - The decay rate; larger is shorter.
 * @returns The gain, 0 to 1.
 */
const strike = (t, attack, decay) => Math.min(1, t / attack) * Math.exp(-t * decay);

/**
 * A linear fade across a clip's final milliseconds, so a tail cut off by the clip's length cannot
 * click. It is applied to the effects and deliberately not to the pad, where it would break the
 * loop.
 * @param index - The sample's index.
 * @param count - How many samples the clip has.
 * @param seconds - How long the fade lasts.
 * @param sampleRate - The rate the samples are at, in hertz.
 * @returns The gain, 0 to 1.
 */
const fadeOut = (index, count, seconds, sampleRate) => Math.min(1, (count - 1 - index) / (seconds * sampleRate));

/**
 * Applies {@link fadeOut} across a whole clip.
 * @param samples - The samples, modified in place.
 * @param seconds - How long the fade lasts.
 * @param sampleRate - The rate the samples are at, in hertz.
 * @returns The same array.
 */
function taper(samples, seconds, sampleRate) {
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] *= fadeOut(i, samples.length, seconds, sampleRate);
  }
  return samples;
}

// --- the clips ----------------------------------------------------------------------------------

/**
 * A footstep: 110 ms of noise low-passed down to a body thump, with a sine an octave-and-a-half
 * below the root under it for weight.
 * @param rootHz - The template's root note, in hertz.
 * @param seed - The seed the noise is drawn from.
 * @returns The samples, each in `[-1, 1]`.
 */
function footstep(rootHz, seed) {
  const count = Math.round(SFX_RATE * 0.11);
  const body = lowPass(noise(rng(seed), count), rootHz * 1.6, SFX_RATE);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i / SFX_RATE;
    out[i] = strike(t, 0.001, 40) * (body[i] * 3 + 0.5 * Math.sin(2 * Math.PI * (rootHz / 4) * t));
  }
  return normalise(taper(out, 0.006, SFX_RATE), 0.7);
}

/**
 * A jump: 160 ms of a sine sweeping one octave up from the root, with a little second harmonic so
 * it reads over a busy mix.
 * @param rootHz - The template's root note, in hertz.
 * @returns The samples, each in `[-1, 1]`.
 */
function jump(rootHz) {
  const seconds = 0.16;
  const count = Math.round(SFX_RATE * seconds);
  const out = new Float64Array(count);
  let phase = 0;
  for (let i = 0; i < count; i += 1) {
    const t = i / SFX_RATE;
    const hz = rootHz * 2 ** (t / seconds);
    phase += (2 * Math.PI * hz) / SFX_RATE;
    out[i] = strike(t, 0.004, 16) * (Math.sin(phase) + 0.25 * Math.sin(2 * phase));
  }
  return normalise(taper(out, 0.01, SFX_RATE), 0.7);
}

/**
 * A landing: 200 ms, the footstep's heavier relative. The noise is low-passed twice at a much lower
 * corner and the sub-sine is three octaves under the root, so it is duller and longer.
 * @param rootHz - The template's root note, in hertz.
 * @param seed - The seed the noise is drawn from.
 * @returns The samples, each in `[-1, 1]`.
 */
function land(rootHz, seed) {
  const count = Math.round(SFX_RATE * 0.2);
  const hiss = noise(rng(seed), count);
  const body = lowPass(lowPass(hiss, rootHz * 0.7, SFX_RATE), rootHz * 0.7, SFX_RATE);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i / SFX_RATE;
    const sub = 0.9 * Math.sin(2 * Math.PI * (rootHz / 8) * t) * Math.exp(-t * 14);
    out[i] = strike(t, 0.002, 22) * (body[i] * 12 + sub);
  }
  return normalise(taper(out, 0.012, SFX_RATE), 0.7);
}

/**
 * A pickup: 320 ms, three bells struck 60 ms apart on the root, its major third and its octave.
 * The partials are stretched slightly off the harmonic series (2.01x, 3.02x), which is what makes a
 * struck bar sound struck rather than blown.
 * @param rootHz - The template's root note, in hertz.
 * @returns The samples, each in `[-1, 1]`.
 */
function pickup(rootHz) {
  const count = Math.round(SFX_RATE * 0.32);
  const out = new Float64Array(count);
  const notes = [
    { hz: rootHz, at: 0, gain: 1 },
    { hz: rootHz * 2 ** (4 / 12), at: 0.06, gain: 0.85 },
    { hz: rootHz * 2, at: 0.12, gain: 0.7 },
  ];
  for (const note of notes) {
    const start = Math.round(note.at * SFX_RATE);
    for (let i = start; i < count; i += 1) {
      const t = (i - start) / SFX_RATE;
      const partials =
        Math.sin(2 * Math.PI * note.hz * t) +
        0.4 * Math.sin(2 * Math.PI * note.hz * 2.01 * t) +
        0.15 * Math.sin(2 * Math.PI * note.hz * 3.02 * t);
      out[i] += note.gain * strike(t, 0.002, 11) * partials;
    }
  }
  return normalise(taper(out, 0.02, SFX_RATE), 0.7);
}

/**
 * A UI click: 55 ms, dry. Bright noise with a very fast decay over a sine an octave above the root,
 * so it cuts through without a tail.
 * @param rootHz - The template's root note, in hertz.
 * @param seed - The seed the noise is drawn from.
 * @returns The samples, each in `[-1, 1]`.
 */
function uiClick(rootHz, seed) {
  const count = Math.round(SFX_RATE * 0.055);
  const body = lowPass(noise(rng(seed), count), rootHz * 6, SFX_RATE);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i / SFX_RATE;
    out[i] = strike(t, 0.0005, 90) * (body[i] * 2 + 0.6 * Math.sin(2 * Math.PI * rootHz * 2 * t));
  }
  return normalise(taper(out, 0.005, SFX_RATE), 0.7);
}

/**
 * A UI hover: the click, 40 ms instead of 55, a fifth higher again and levelled to 0.4 rather than
 * 0.7 — a hover fires far more often than a click and has to sit under it.
 * @param rootHz - The template's root note, in hertz.
 * @param seed - The seed the noise is drawn from.
 * @returns The samples, each in `[-1, 1]`.
 */
function uiHover(rootHz, seed) {
  const count = Math.round(SFX_RATE * 0.04);
  const body = lowPass(noise(rng(seed), count), rootHz * 9, SFX_RATE);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i / SFX_RATE;
    out[i] = strike(t, 0.0004, 130) * (body[i] * 1.5 + 0.5 * Math.sin(2 * Math.PI * rootHz * 3 * t));
  }
  return normalise(taper(out, 0.004, SFX_RATE), 0.4);
}

/**
 * A seamlessly looping pad.
 *
 * Every oscillator is counted in **whole cycles per loop** rather than in hertz: a voice asked for
 * `f` hertz is rendered at `round(f * PAD_SECONDS) / PAD_SECONDS`, so it is back where it started
 * at the end of the buffer and the sample after the last one is the first one. The amplitude LFOs
 * are counted the same way. Nothing is faded, because a fade is exactly what would put a step at
 * the seam. Detuning is one cycle per loop, which beats at 1/`PAD_SECONDS` hertz and stays inside
 * the loop as well.
 * @param rootHz - The template's root note, in hertz.
 * @param chord - The chord's intervals above the root, in semitones.
 * @param seed - The seed the voice phases are drawn from.
 * @returns The samples, each in `[-1, 1]`.
 */
function pad(rootHz, chord, seed) {
  const count = Math.round(PAD_RATE * PAD_SECONDS);
  const random = rng(seed);
  const voices = [];
  chord.forEach((semitones, index) => {
    const cycles = Math.max(1, Math.round(rootHz * 2 ** (semitones / 12) * PAD_SECONDS));
    const weight = 1 / (index + 1);
    [
      [1, 1],
      [2, 0.3],
      [3, 0.1],
    ].forEach(([multiple, level]) => {
      voices.push(
        { cycles: cycles * multiple, gain: weight * level, phase: random(), lfo: 1 + (index % 3) },
        { cycles: cycles * multiple + 1, gain: weight * level * 0.6, phase: random(), lfo: 2 + (index % 2) },
      );
    });
  });
  // A sub an octave below the root, rounded to whole cycles like everything else, for a floor.
  const sub = Math.max(1, Math.round((rootHz / 2) * PAD_SECONDS));
  voices.push({ cycles: sub, gain: 0.5, phase: random(), lfo: 1 });

  // A six-decibel-per-octave tilt above 400 Hz, applied to each voice's gain rather than with a
  // filter: a filter has state and would not repeat across the seam, an arithmetic gain does.
  for (const voice of voices) {
    voice.gain /= 1 + (voice.cycles / PAD_SECONDS / 400) ** 2;
  }

  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    // One full turn of the loop, in [0, 1). Counting the loop rather than seconds is what keeps
    // every voice a whole number of cycles long.
    const turn = i / count;
    let value = 0;
    for (const voice of voices) {
      const breathe = 0.75 + 0.25 * Math.sin(2 * Math.PI * voice.lfo * turn);
      value += voice.gain * breathe * Math.sin(2 * Math.PI * (voice.cycles * turn + voice.phase));
    }
    out[i] = value;
  }
  return normalise(out, 0.35);
}

// --- verification and output --------------------------------------------------------------------

/**
 * Measures how cleanly a clip joins its own start, which is the whole question for a loop. A wrap
 * step no larger than the steps the clip already takes internally cannot be heard as a click.
 * @param samples - The clip.
 * @returns The wrap step, the largest and mean step inside the clip, and the wrap's ratio to the
 * largest. A ratio at or under one means the seam is indistinguishable from an ordinary sample.
 */
function wrapDiscontinuity(samples) {
  const wrap = Math.abs(samples[0] - samples.at(-1));
  let largest = 0;
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const step = Math.abs(samples[i] - samples[i - 1]);
    largest = Math.max(largest, step);
    total += step;
  }
  const mean = total / (samples.length - 1);
  return { wrap, largest, mean, ratio: largest === 0 ? 0 : wrap / largest };
}

/**
 * Writes one generated file into a template and records it for the closing report, refusing
 * anything over the per-file budget.
 * @param template - The template's directory name.
 * @param name - The file name.
 * @param bytes - The contents.
 * @param note - What the report should say about the file.
 */
function write(template, name, bytes, note) {
  if (bytes.length > MAX_BYTES) {
    throw new Error(`${template}/${name} is ${bytes.length} bytes, over the ${MAX_BYTES} byte budget`);
  }
  const directory = join(REPO, "templates", template, "assets");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), bytes);
  written.push({ path: `templates/${template}/assets/${name}`, bytes: bytes.length, note });
}

/**
 * Describes a rendered clip for the report.
 * @param samples - The clip.
 * @param sampleRate - The rate it is rendered at, in hertz.
 * @returns A short "rate, duration" string.
 */
const describe = (samples, sampleRate) => `${sampleRate} Hz  ${(samples.length / sampleRate).toFixed(3)} s`;

const loops = [];

for (const template of TEMPLATES) {
  const { name, rootHz, chord, chordName, seed } = template;
  const clips = [
    ["footstep.wav", footstep(rootHz, seed + 1), SFX_RATE],
    ["jump.wav", jump(rootHz), SFX_RATE],
    ["land.wav", land(rootHz, seed + 2), SFX_RATE],
    ["pickup.wav", pickup(rootHz), SFX_RATE],
    ["ui-click.wav", uiClick(rootHz, seed + 3), SFX_RATE],
    ["ui-hover.wav", uiHover(rootHz, seed + 4), SFX_RATE],
    ["ambient.wav", pad(rootHz, chord, seed + 5), PAD_RATE],
  ];
  for (const [file, samples, rate] of clips) {
    write(name, file, encodeWav(samples, rate), describe(samples, rate));
    if (file === "ambient.wav") {
      loops.push({ template: name, chord: chordName, ...wrapDiscontinuity(samples) });
    }
  }
  write(name, "game.audio.json", Buffer.from(AUDIO_BUSES, "utf8"), "Master / Music / SFX / UI");
}

for (const entry of written) {
  process.stdout.write(`${entry.path.padEnd(46)} ${String(entry.bytes).padStart(6)} bytes  ${entry.note}\n`);
}

process.stdout.write("\nambient.wav loop seams (wrap step against the largest step inside the clip):\n");
for (const loop of loops) {
  const wrap = loop.wrap.toExponential(3);
  const largest = loop.largest.toExponential(3);
  const mean = loop.mean.toExponential(3);
  const ratio = loop.ratio.toFixed(3);
  const head = `  ${loop.template.padEnd(18)}${loop.chord.padEnd(14)}`;
  process.stdout.write(`${head}wrap ${wrap}  mean ${mean}  max ${largest}  wrap/max ${ratio}\n`);
}
