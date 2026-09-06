/**
 * The one stylesheet the overlay injects (`docs/architecture/15-devtools-and-diagnostics.md` §4).
 *
 * It is a single `<style>` element with a fixed id, appended once per document, so two apps on one
 * page share it and a disposed app leaves nothing behind that a second `mount` would duplicate. No
 * class name is generated at runtime: every rule is in the constant below, which is what keeps the
 * panels' own code down to `element.className = DEVTOOLS_CLASS_NAMES.row`.
 */

/**
 * The id of the injected `<style>` element.
 *
 * @public
 */
export const DEVTOOLS_STYLE_ELEMENT_ID = "ignifx-devtools-styles";

/**
 * Every class name the overlay writes, so a game that wants to restyle the panels has names to
 * target and the source has no string literals scattered through it.
 *
 * @public
 */
export const DEVTOOLS_CLASS_NAMES = {
  /** The overlay root, docked to one edge of the canvas. */
  root: "ignifx-devtools",
  /** The tab strip along the top of the root. */
  tabs: "ignifx-devtools-tabs",
  /** One tab button. */
  tab: "ignifx-devtools-tab",
  /** The active tab button. */
  tabActive: "ignifx-devtools-tab-active",
  /** The panel body under the tab strip. */
  body: "ignifx-devtools-body",
  /** One panel's own container. */
  panel: "ignifx-devtools-panel",
  /** A label/value row. */
  row: "ignifx-devtools-row",
  /** The label half of a row. */
  label: "ignifx-devtools-label",
  /** The value half of a row. */
  value: "ignifx-devtools-value",
  /** A tree row in the scene panel. */
  node: "ignifx-devtools-node",
  /** The selected tree row. */
  nodeSelected: "ignifx-devtools-node-selected",
  /** A small push button. */
  button: "ignifx-devtools-button",
  /** A text input, number input, or select. */
  input: "ignifx-devtools-input",
  /** A section heading inside a panel. */
  heading: "ignifx-devtools-heading",
  /** A toolbar strip inside a panel. */
  toolbar: "ignifx-devtools-toolbar",
  /** One console line. */
  line: "ignifx-devtools-line",
  /** The timeline canvas. */
  canvas: "ignifx-devtools-canvas",
} as const;

/** The stylesheet itself. One string, so injection is one `textContent` write. */
const DEVTOOLS_CSS = `
.${DEVTOOLS_CLASS_NAMES.root}{position:absolute;top:0;bottom:0;right:0;width:380px;max-width:100%;
display:flex;flex-direction:column;z-index:2147483000;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
color:#e8eaf0;background:rgba(16,18,24,.92);border-left:1px solid #2b3040;pointer-events:auto;overflow:hidden}
.${DEVTOOLS_CLASS_NAMES.tabs}{display:flex;flex-wrap:wrap;gap:2px;padding:4px;background:#0e1016;border-bottom:1px solid #2b3040}
.${DEVTOOLS_CLASS_NAMES.tab}{appearance:none;border:0;padding:3px 7px;border-radius:3px;background:#1b1f2b;color:#9aa3b8;cursor:pointer;font:inherit}
.${DEVTOOLS_CLASS_NAMES.tabActive}{background:#2f3a55;color:#fff}
.${DEVTOOLS_CLASS_NAMES.body}{flex:1;overflow:auto;padding:6px}
.${DEVTOOLS_CLASS_NAMES.panel}{display:flex;flex-direction:column;gap:2px}
.${DEVTOOLS_CLASS_NAMES.row}{display:flex;justify-content:space-between;gap:8px;padding:1px 2px}
.${DEVTOOLS_CLASS_NAMES.label}{color:#9aa3b8;white-space:nowrap}
.${DEVTOOLS_CLASS_NAMES.value}{color:#e8eaf0;text-align:right;overflow:hidden;text-overflow:ellipsis}
.${DEVTOOLS_CLASS_NAMES.node}{display:flex;gap:4px;align-items:center;padding:1px 2px;border-radius:2px;cursor:pointer;white-space:nowrap}
.${DEVTOOLS_CLASS_NAMES.nodeSelected}{background:#2f3a55}
.${DEVTOOLS_CLASS_NAMES.button}{appearance:none;border:1px solid #2b3040;border-radius:3px;background:#1b1f2b;color:#c8cfdd;cursor:pointer;font:inherit;padding:1px 5px}
.${DEVTOOLS_CLASS_NAMES.input}{background:#0e1016;border:1px solid #2b3040;border-radius:3px;color:#e8eaf0;font:inherit;padding:1px 4px;min-width:0;width:100%}
.${DEVTOOLS_CLASS_NAMES.heading}{color:#7f8aa3;text-transform:uppercase;letter-spacing:.06em;margin-top:6px}
.${DEVTOOLS_CLASS_NAMES.toolbar}{display:flex;gap:4px;align-items:center;margin-bottom:4px}
.${DEVTOOLS_CLASS_NAMES.line}{white-space:pre-wrap;word-break:break-word;padding:1px 2px}
.${DEVTOOLS_CLASS_NAMES.canvas}{width:100%;height:120px;display:block;background:#0e1016;border:1px solid #2b3040;border-radius:3px}
`;

/**
 * Injects the stylesheet into a document, once.
 *
 * @param document - The document to inject into.
 *
 * @internal
 */
export function ensureDevtoolsStyles(document: Document): void {
  // `getElementById` rather than `querySelector`: the id is the whole query, and the node test's
  // fake document then needs one method instead of a selector parser.
  // oxlint-disable-next-line unicorn/prefer-query-selector
  if (document.getElementById(DEVTOOLS_STYLE_ELEMENT_ID) !== null) {
    return;
  }
  const style = document.createElement("style");
  style.id = DEVTOOLS_STYLE_ELEMENT_ID;
  style.textContent = DEVTOOLS_CSS;
  document.head.append(style);
}
