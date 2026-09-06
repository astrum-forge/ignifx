import { element, heading, setText } from "../dom/elements.js";
import { DEVTOOLS_CLASS_NAMES } from "../dom/styles.js";
import { probeAudio } from "../probes.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "../overlay/panel.js";

/**
 * The **Audio** panel (`docs/architecture/15-devtools-and-diagnostics.md` §4: *"buses,
 * instances"*).
 *
 * Each bus gets a slider that writes `bus.volume` directly, which is the same property a game
 * writes; `effectiveVolume` next to it is the value after the parents' volumes, so a muted parent
 * is visible without opening the tree. `@ignifx/audio` is an optional peer and is reached through
 * `probeAudio`.
 */

/** One pooled bus row. */
interface BusRow {
  /** The row element. */
  readonly row: HTMLElement;
  /** The bus name. */
  readonly label: HTMLElement;
  /** The volume slider. */
  readonly slider: HTMLInputElement;
  /** The effective volume readout. */
  readonly value: HTMLElement;
}

/** How finely the volume slider steps. */
const VOLUME_STEP = "0.01";

/**
 * Builds the Audio panel.
 *
 * @returns The panel.
 *
 * @internal
 */
export function createAudioPanel(): DevtoolsPanel {
  const rows: BusRow[] = [];
  const setters: ((value: number) => void)[] = [];
  let list: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let host: DevtoolsPanelHost | null = null;

  /**
   * Returns the pooled row at an index, creating it the first time.
   *
   * @param at - The pool slot.
   * @returns The row.
   */
  function rowAt(at: number): BusRow {
    const existing = rows[at];
    if (existing !== undefined) {
      return existing;
    }
    const owner = host;
    const parent = list;
    if (owner === null || parent === null) {
      throw new TypeError("The audio panel was refreshed before it was mounted.");
    }
    const row = element(owner.document, "div", DEVTOOLS_CLASS_NAMES.row);
    const label = element(owner.document, "span", DEVTOOLS_CLASS_NAMES.label);
    const slider = element(owner.document, "input", DEVTOOLS_CLASS_NAMES.input);
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = VOLUME_STEP;
    slider.addEventListener("input", (): void => {
      const parsed = Number(slider.value);
      if (Number.isFinite(parsed)) {
        setters[at]?.(parsed);
      }
    });
    const value = element(owner.document, "span", DEVTOOLS_CLASS_NAMES.value);
    row.append(label, slider, value);
    parent.append(row);
    const created: BusRow = { row, label, slider, value };
    rows.push(created);
    return created;
  }

  return {
    name: "audio",
    title: "Audio",
    perFrame: false,

    mount(root: HTMLElement, panelHost: DevtoolsPanelHost): void {
      host = panelHost;
      const caption = heading(panelHost.document, "buses");
      const body = element(panelHost.document, "div", DEVTOOLS_CLASS_NAMES.panel);
      root.append(caption, body);
      status = caption;
      list = body;
    },

    update(panelHost: DevtoolsPanelHost): void {
      if (list === null) {
        return;
      }
      host = panelHost;
      const audio = probeAudio(panelHost.app);
      if (audio === null) {
        setText(status ?? list, "@ignifx/audio is not registered");
        for (let index = 0; index < rows.length; index += 1) {
          rows[index]?.row.style.setProperty("display", "none");
        }
        return;
      }
      setText(status ?? list, `buses · master ${audio.masterVolume.toFixed(2)}`);
      for (let index = 0; index < audio.buses.length; index += 1) {
        const bus = audio.buses[index];
        if (bus === undefined) {
          continue;
        }
        const row = rowAt(index);
        setters[index] = bus.setVolume;
        row.row.style.setProperty("display", "flex");
        setText(row.label, bus.muted ? `${bus.name} (muted)` : bus.name);
        const text = bus.volume.toFixed(2);
        if (row.slider.value !== text) {
          row.slider.value = text;
        }
        setText(row.value, bus.effectiveVolume.toFixed(2));
      }
      for (let index = audio.buses.length; index < rows.length; index += 1) {
        rows[index]?.row.style.setProperty("display", "none");
      }
    },

    dispose(): void {
      rows.length = 0;
      setters.length = 0;
      list = null;
      status = null;
      host = null;
    },
  };
}
