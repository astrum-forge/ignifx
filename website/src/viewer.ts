// The viewer bridge: the site's half of the `postMessage` protocol the shared example kit speaks
// (`website/plan/04-examples-platform.md` §3, contract fixed in `08-execution.md` §4.3).
//
// Loaded as a chunk from `main.ts`, and only on a page that embeds an example. The markup contract
// is documented on `scripts/frame.ts`; nothing here is example-specific, because the parameter
// panel lives inside the frame.

/** What the frame sends the viewer. */
type FrameMessage =
  | { readonly type: "ignifx:ready" }
  | { readonly type: "ignifx:stats"; readonly frameMs: number; readonly drawCalls: number }
  | { readonly type: "ignifx:unsupported"; readonly code: string };

/**
 * Narrows an untrusted `message` payload to the kit's protocol.
 *
 * The frame is same-origin, but a message can still come from anywhere, so both the origin and the
 * source window are checked by the caller and the shape is checked here.
 *
 * @param data - The `MessageEvent.data`.
 * @returns The message, or `null` when it is not one of ours.
 */
function asFrameMessage(data: unknown): FrameMessage | null {
  if (typeof data !== "object" || data === null || !("type" in data) || typeof data.type !== "string") {
    return null;
  }
  if (data.type === "ignifx:ready") {
    return { type: "ignifx:ready" };
  }
  if (data.type === "ignifx:unsupported") {
    const code = "code" in data && typeof data.code === "string" ? data.code : "IGX-0701";
    return { type: "ignifx:unsupported", code };
  }
  if (data.type === "ignifx:stats") {
    const frameMs = "frameMs" in data && typeof data.frameMs === "number" ? data.frameMs : 0;
    const drawCalls = "drawCalls" in data && typeof data.drawCalls === "number" ? data.drawCalls : 0;
    return { type: "ignifx:stats", frameMs, drawCalls };
  }
  return null;
}

/**
 * Wires one frame.
 *
 * @param frame - The element carrying `data-viewer`.
 */
function installViewer(frame: HTMLElement): void {
  const iframe = frame.querySelector<HTMLIFrameElement>("[data-frame]");
  if (iframe === null) {
    return;
  }
  const stats = frame.querySelector<HTMLElement>("[data-frame-stats]");
  const toggle = frame.querySelector<HTMLButtonElement>("[data-frame-toggle]");
  const full = frame.querySelector<HTMLButtonElement>("[data-frame-full]");
  const start = frame.querySelector<HTMLButtonElement>("[data-frame-start]");
  const bridged = frame.dataset["bridge"] === "on";

  /** Whether the visitor pressed Pause, as opposed to the tab going away. */
  let paused = false;

  /**
   * Sends one message into the frame.
   *
   * @param type - The message type.
   */
  const send = (type: "ignifx:pause" | "ignifx:resume"): void => {
    iframe.contentWindow?.postMessage({ type }, window.location.origin);
  };

  /**
   * Paints the Play/Pause button for the current state.
   */
  const paintToggle = (): void => {
    frame.classList.toggle("is-paused", paused);
    if (toggle !== null) {
      const label = paused ? "Play" : "Pause";
      const text = toggle.querySelector(".btn-text");
      if (text !== null) {
        text.textContent = label;
      }
      toggle.setAttribute("aria-label", paused ? "Resume the example" : "Pause the example");
    }
  };

  // A template's run page is its own Vite build, not a kit example, so there is no bridge: the
  // poster comes off when the document loads and there are no metrics to show (`08` §4.3).
  if (!bridged) {
    if (iframe.contentDocument?.readyState === "complete") {
      frame.classList.add("is-ready");
    }
    iframe.addEventListener("load", () => {
      frame.classList.add("is-ready");
    });
  }

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== iframe.contentWindow) {
      return;
    }
    const message = asFrameMessage(event.data);
    if (message === null) {
      return;
    }
    if (message.type === "ignifx:ready") {
      frame.classList.add("is-ready");
      if (start !== null) {
        start.hidden = true;
      }
      return;
    }
    if (message.type === "ignifx:unsupported") {
      // The frame draws its own fallback panel and the support pill on the page explains why; all
      // the viewer does is stop offering controls that cannot work.
      frame.classList.add("is-ready", "is-unsupported");
      if (stats !== null) {
        stats.textContent = message.code;
      }
      return;
    }
    if (stats !== null && !paused) {
      // "engine CPU", not "frame": the kit reports the sum of the frame's phase CPU samples, median
      // of the last 30 frames (`website/examples/_kit/bridge.ts`). The element's `title` says so.
      stats.textContent = `${message.frameMs.toFixed(1)} ms engine CPU · ${message.drawCalls.toLocaleString("en-GB")} draw calls`;
    }
  });

  toggle?.addEventListener("click", () => {
    paused = !paused;
    send(paused ? "ignifx:pause" : "ignifx:resume");
    if (paused && stats !== null) {
      stats.textContent = "paused";
    }
    paintToggle();
  });

  full?.addEventListener("click", () => {
    void iframe.requestFullscreen().catch(() => {
      // Fullscreen can be refused (an iframe without permission, a browser policy). Nothing to do.
    });
  });

  // A reduced-motion visitor gets the poster and a Play button; the kit's `?autoplay=0` creates the
  // app but waits for a resume before it starts the loop (`08` §4.3).
  if (bridged && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const url = new URL(iframe.src, window.location.href);
    url.searchParams.set("autoplay", "0");
    iframe.src = url.pathname + url.search;
    if (start !== null) {
      start.hidden = false;
      start.addEventListener("click", () => {
        send("ignifx:resume");
        start.hidden = true;
      });
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!bridged || paused) {
      return;
    }
    send(document.visibilityState === "hidden" ? "ignifx:pause" : "ignifx:resume");
  });
}

/**
 * Wires every example frame on the page.
 */
export function installViewers(): void {
  for (const frame of document.querySelectorAll<HTMLElement>("[data-viewer]")) {
    installViewer(frame);
  }
}
