/**
 * The panel a frame shows instead of a canvas when the browser has no WebGPU
 * (`website/plan/04-examples-platform.md` §4, `08-execution.md` §4.3).
 *
 * `createApp({ canvas })` rejects with `IGX-0701` when no adapter is available, and ignifx has no
 * fallback renderer by decision (ADR-0001). So every example frame ends the same way on such a
 * browser: the canvas is removed, this panel takes its place, and `ignifx:unsupported` goes to the
 * viewer, which keeps the poster and turns its support pill amber.
 *
 * The copy is the plan's, unchanged, and the version numbers are the ones `01-strategy-and-ia.md`
 * §6 rule 3 says must be stated exactly.
 */

/** The site page that explains the requirement in full. */
const BROWSER_SUPPORT_URL = "/docs/browser-support/";

/** The class the stylesheet styles the panel with; see `kit.css`. */
const FALLBACK_CLASS = "igx-fallback";

/**
 * Replaces the canvas with the "no WebGPU here" panel.
 *
 * @remarks
 * `role="alert"` rather than a plain region: the visitor asked to see something run and it will
 * not, which is exactly the case an assistive technology should interrupt for. The canvas is
 * removed rather than hidden, so no dead 16:9 box is left in the layout.
 *
 * @param canvas - The canvas the example would have drawn into.
 * @returns The panel that was mounted, so a caller can read it in a test.
 *
 * @example
 * ```ts
 * if (isIgnifxError(error) && error.code === "IGX-0701") {
 *   showFallback(canvas);
 * }
 * ```
 */
export function showFallback(canvas: HTMLCanvasElement): HTMLElement {
  const panel = document.createElement("div");
  panel.className = FALLBACK_CLASS;
  panel.setAttribute("role", "alert");

  const heading = document.createElement("h1");
  heading.textContent = "WebGPU is not available in this browser";
  panel.append(heading);

  const detail = document.createElement("p");
  detail.textContent =
    "ignifx renders through WebGPU only. Chrome and Edge 113 and later, Safari 26 and later, and " +
    "Firefox 141 on Windows or 145 on Apple Silicon can run this example.";
  panel.append(detail);

  const link = document.createElement("a");
  link.href = BROWSER_SUPPORT_URL;
  link.textContent = "Browser support";
  // The frame is embedded, and a link that navigated the frame would leave a page fragment sitting
  // inside a 16:9 box with no header on it.
  link.target = "_top";
  panel.append(link);

  document.body.dataset["webgpu"] = "unavailable";
  canvas.replaceWith(panel);
  return panel;
}
