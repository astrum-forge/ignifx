import { button, element, setText, textInput, toggleClass } from "../dom/elements.js";
import { formatCount } from "../dom/format.js";
import { DEVTOOLS_CLASS_NAMES } from "../dom/styles.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "../overlay/panel.js";
import type { Entity } from "@ignifx/core";

/**
 * The **Scene tree** panel (`docs/architecture/15-devtools-and-diagnostics.md` §4: *"search,
 * select, toggle active, destroy"*).
 *
 * ## Virtualisation
 *
 * §4's list has to hold ten thousand entities, so the panel keeps a fixed pool of row elements —
 * as many as fit on screen plus a few — and moves the window over the flattened index rather than
 * building a row per entity. Two spacer `<div>`s above and below give the scroller the height it
 * would have had, so the scrollbar is the real one. Nothing about this is per frame: the flattened
 * index rebuilds only when the world publishes a change, and the window only moves when the
 * developer scrolls or types.
 */

/** The height of one row, in CSS pixels. It is a constant because the rows are single-line. */
const ROW_HEIGHT = 18;

/** How many rows are rendered beyond the visible window, so a fast scroll shows no gap. */
const OVERSCAN = 4;

/**
 * How many rows are rendered when the scroller reports no height. A node test's fake DOM has no
 * layout, and so does a panel that is measured before its first paint; sixty-four rows is more than
 * a screenful and still a constant, which is the property the virtualisation test asserts.
 */
const FALLBACK_ROWS = 64;

/** One pooled row of the tree. */
interface TreeRow {
  /** The row element. */
  readonly row: HTMLElement;
  /** The disclosure triangle. */
  readonly caret: HTMLElement;
  /** The entity name. */
  readonly name: HTMLElement;
}

/**
 * Builds the Scene tree panel.
 *
 * @returns The panel.
 *
 * @internal
 */
export function createSceneTreePanel(): DevtoolsPanel {
  const rows: TreeRow[] = [];
  const bound: (Entity | null)[] = [];
  const visible: number[] = [];
  let search = "";
  let scroller: HTMLElement | null = null;
  let above: HTMLElement | null = null;
  let below: HTMLElement | null = null;
  let list: HTMLElement | null = null;
  let count: HTMLElement | null = null;
  let host: DevtoolsPanelHost | null = null;

  /**
   * Returns the pooled row at an index, creating it the first time.
   *
   * @param at - The pool slot.
   * @returns The row.
   */
  function rowAt(at: number): TreeRow {
    const existing = rows[at];
    if (existing !== undefined) {
      return existing;
    }
    const owner = host;
    const parent = list;
    if (owner === null || parent === null) {
      throw new TypeError("The scene tree panel was refreshed before it was mounted.");
    }
    const row = element(owner.document, "div", DEVTOOLS_CLASS_NAMES.node);
    row.style.setProperty("height", `${String(ROW_HEIGHT)}px`);
    const caret = element(owner.document, "span");
    const name = element(owner.document, "span");
    row.append(caret, name);
    caret.addEventListener("click", (event: Event): void => {
      event.stopPropagation();
      const entity = bound[at];
      if (entity !== null && entity !== undefined) {
        owner.index.toggleCollapsed(entity);
      }
    });
    row.addEventListener("click", (): void => {
      owner.select(bound[at] ?? null);
    });
    parent.append(row);
    const created: TreeRow = { row, caret, name };
    rows.push(created);
    return created;
  }

  return {
    name: "scene",
    title: "Scene",
    perFrame: false,

    mount(root: HTMLElement, panelHost: DevtoolsPanelHost): void {
      host = panelHost;
      const bar = element(panelHost.document, "div", DEVTOOLS_CLASS_NAMES.toolbar);
      bar.append(
        textInput(panelHost.document, "search", (value: string): void => {
          search = value;
        }),
        button(panelHost.document, "active", (): void => {
          const entity = panelHost.selected;
          if (entity !== null && !entity.isDestroyed) {
            entity.active = !entity.active;
          }
        }),
        button(panelHost.document, "destroy", (): void => {
          const entity = panelHost.selected;
          if (entity !== null && !entity.isDestroyed) {
            entity.destroy();
            panelHost.select(null);
            panelHost.index.invalidate();
          }
        }),
      );
      const total = element(panelHost.document, "span", DEVTOOLS_CLASS_NAMES.label);
      bar.append(total);
      count = total;
      const box = element(panelHost.document, "div");
      box.style.setProperty("overflow", "auto");
      box.style.setProperty("max-height", "45vh");
      const top = element(panelHost.document, "div");
      const body = element(panelHost.document, "div");
      const bottom = element(panelHost.document, "div");
      box.append(top, body, bottom);
      root.append(bar, box);
      scroller = box;
      above = top;
      below = bottom;
      list = body;
    },

    update(panelHost: DevtoolsPanelHost): void {
      const box = scroller;
      const top = above;
      const bottom = below;
      if (box === null || top === null || bottom === null) {
        return;
      }
      host = panelHost;
      panelHost.index.refresh(true);
      panelHost.index.filter(search, visible);
      setText(count ?? top, `${formatCount(visible.length)} shown`);
      const height = box.clientHeight > 0 ? box.clientHeight : FALLBACK_ROWS * ROW_HEIGHT;
      const windowSize = Math.min(visible.length, Math.ceil(height / ROW_HEIGHT) + OVERSCAN);
      const maxFirst = Math.max(0, visible.length - windowSize);
      const first = Math.min(maxFirst, Math.floor(box.scrollTop / ROW_HEIGHT));
      top.style.setProperty("height", `${String(first * ROW_HEIGHT)}px`);
      bottom.style.setProperty("height", `${String((visible.length - first - windowSize) * ROW_HEIGHT)}px`);
      const selected = panelHost.selected;
      for (let slot = 0; slot < windowSize; slot += 1) {
        const entry = panelHost.index.at(visible[slot + first] ?? -1);
        const row = rowAt(slot);
        row.row.style.setProperty("display", "flex");
        if (entry === null) {
          bound[slot] = null;
          setText(row.name, "");
          continue;
        }
        bound[slot] = entry.entity;
        row.row.style.setProperty("padding-left", `${String(entry.depth * 10)}px`);
        setText(row.caret, entry.childCount === 0 ? " " : panelHost.index.isCollapsed(entry.entity) ? "▸" : "▾");
        setText(row.name, entry.entity.activeInHierarchy ? entry.entity.name : `${entry.entity.name} (inactive)`);
        toggleClass(row.row, DEVTOOLS_CLASS_NAMES.nodeSelected, entry.entity === selected);
      }
      for (let slot = windowSize; slot < rows.length; slot += 1) {
        rows[slot]?.row.style.setProperty("display", "none");
        bound[slot] = null;
      }
    },

    dispose(): void {
      rows.length = 0;
      bound.length = 0;
      visible.length = 0;
      scroller = null;
      above = null;
      below = null;
      list = null;
      count = null;
      host = null;
    },
  };
}
