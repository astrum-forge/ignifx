import { createFrameSample, PHASE_COUNT } from "@ignifx/core";
import { element, setText } from "../dom/elements.js";
import { formatMs } from "../dom/format.js";
import { DEVTOOLS_CLASS_NAMES } from "../dom/styles.js";
import { DEVTOOLS_PHASE_NAMES } from "../overlay/sampler.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "../overlay/panel.js";
import type { FrameSample } from "@ignifx/core";

/**
 * The **Timeline** panel (`docs/architecture/15-devtools-and-diagnostics.md` §4: *"phase timings
 * graph"*, over §3's three-hundred-frame ring buffer).
 *
 * Each column is one recorded frame and each band inside it is one phase's CPU milliseconds,
 * stacked in frame order, so a spike is attributable to the phase that caused it. The panel is the
 * only `perFrame` one: a graph that redraws ten times a second stutters, and the draw is a few
 * hundred `fillRect` calls into a 380-pixel-wide canvas.
 *
 * Outside a development build `FrameSample.cpuMs` is all zeroes — `app.diagnostics` only fills it
 * when `createApp({ mode: "development" })` — so the panel draws an empty grid and says so.
 */

/** The colour of each phase band, in `Phase` ordinal order. */
const PHASE_COLORS: readonly string[] = ["#4a5878", "#3f8f6b", "#8f6a3f", "#6d4a8f", "#8f3f5c", "#3f6d8f"];

/** The canvas's backing-store height, in pixels. */
const CANVAS_HEIGHT = 120;

/** The canvas's backing-store width. Three hundred frames plus a small margin. */
const CANVAS_WIDTH = 320;

/** The millisecond value the graph's full height stands for when the frames are all cheap. */
const MINIMUM_SCALE_MS = 4;

/**
 * Builds the Timeline panel.
 *
 * @returns The panel.
 *
 * @internal
 */
export function createTimelinePanel(): DevtoolsPanel {
  const scratch: FrameSample = createFrameSample();
  const columns: number[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let caption: HTMLElement | null = null;

  return {
    name: "timeline",
    title: "Timeline",
    perFrame: true,

    mount(root: HTMLElement, host: DevtoolsPanelHost): void {
      const node = element(host.document, "canvas", DEVTOOLS_CLASS_NAMES.canvas);
      node.width = CANVAS_WIDTH;
      node.height = CANVAS_HEIGHT;
      const legend = element(host.document, "div", DEVTOOLS_CLASS_NAMES.label);
      root.append(node, legend);
      canvas = node;
      caption = legend;
    },

    update(host: DevtoolsPanelHost): void {
      const node = canvas;
      if (node === null) {
        return;
      }
      const context = node.getContext("2d");
      const diagnostics = host.app.diagnostics;
      const frames = Math.min(diagnostics.historyLength, CANVAS_WIDTH);
      columns.length = 0;
      let peak = MINIMUM_SCALE_MS;
      let total = 0;
      for (let offset = frames - 1; offset >= 0; offset -= 1) {
        diagnostics.readFrame(offset, scratch);
        let frameTotal = 0;
        for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
          const value = scratch.cpuMs[phase] ?? 0;
          columns.push(value);
          frameTotal += value;
        }
        total += frameTotal;
        if (frameTotal > peak) {
          peak = frameTotal;
        }
      }
      if (caption !== null) {
        const mean = frames === 0 ? 0 : total / frames;
        setText(
          caption,
          total === 0
            ? 'no per-phase timings: build with mode "development"'
            : `${String(frames)} frames · mean ${formatMs(mean)} · peak ${formatMs(peak)}`,
        );
      }
      if (context === null) {
        return;
      }
      context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      const width = frames === 0 ? 0 : Math.max(1, Math.floor(CANVAS_WIDTH / frames));
      for (let index = 0; index < frames; index += 1) {
        let y = CANVAS_HEIGHT;
        for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
          const value = columns[index * PHASE_COUNT + phase] ?? 0;
          const height = (value / peak) * CANVAS_HEIGHT;
          if (height <= 0) {
            continue;
          }
          context.fillStyle = PHASE_COLORS[phase] ?? "#4a5878";
          context.fillRect(index * width, y - height, width, height);
          y -= height;
        }
      }
    },

    dispose(): void {
      columns.length = 0;
      canvas = null;
      caption = null;
    },
  };
}

/**
 * The phase name of each timeline band, in the order they stack from the bottom up. Exported so a
 * test can assert the legend and the colours line up with `Phase`.
 *
 * @internal
 */
export const TIMELINE_BANDS: readonly string[] = DEVTOOLS_PHASE_NAMES;
