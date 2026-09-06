import { element, RowList } from "../dom/elements.js";
import { formatBytes, formatCount, formatMs } from "../dom/format.js";
import { DEVTOOLS_CLASS_NAMES } from "../dom/styles.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "../overlay/panel.js";

/**
 * The **Stats** panel (`docs/architecture/15-devtools-and-diagnostics.md` §4: *"FPS, frame/CPU/GPU
 * ms, draw calls, fixed steps, entities, components, assets, memory"*).
 *
 * Every number comes from the once-per-frame sample rather than from a fresh read, so opening the
 * panel does not change what the panel measures. `performance.memory` is Chromium-only and shows
 * `-` elsewhere; CPU milliseconds are `0` outside a development build, because that is when
 * `app.diagnostics` fills `FrameSample.cpuMs`.
 *
 * The panel also carries the two hot-reload controls §5 asks for: the `reloadScenes` toggle and the
 * last report the host applied.
 */

/**
 * Builds the Stats panel.
 *
 * @returns The panel.
 *
 * @internal
 */
export function createStatsPanel(): DevtoolsPanel {
  let rows: RowList | null = null;
  let toggle: HTMLInputElement | null = null;

  return {
    name: "stats",
    title: "Stats",
    perFrame: false,

    mount(root: HTMLElement, host: DevtoolsPanelHost): void {
      const bar = element(host.document, "div", DEVTOOLS_CLASS_NAMES.toolbar);
      const box = element(host.document, "input", DEVTOOLS_CLASS_NAMES.input);
      box.type = "checkbox";
      box.checked = host.reloadScenes;
      box.addEventListener("change", (): void => {
        host.setReloadScenes(box.checked);
      });
      const caption = element(host.document, "span", DEVTOOLS_CLASS_NAMES.label);
      caption.textContent = "reload scenes on change";
      bar.append(box, caption);
      root.append(bar);
      toggle = box;
      rows = new RowList(host.document, root);
    },

    update(host: DevtoolsPanelHost): void {
      const list = rows;
      if (list === null) {
        return;
      }
      const sample = host.sample;
      if (toggle !== null && toggle.checked !== host.reloadScenes) {
        toggle.checked = host.reloadScenes;
      }
      list.begin();
      list.set("fps", sample.fps.toFixed(1));
      list.set("frame", formatMs(sample.frameMs));
      list.set("cpu", sample.cpuMs > 0 ? formatMs(sample.cpuMs) : "- (production build)");
      list.set("gpu", sample.gpuMs > 0 ? formatMs(sample.gpuMs) : "-");
      list.set("draw calls", formatCount(sample.drawCalls));
      list.set("fixed steps", formatCount(sample.fixedSteps));
      list.set("scripts updated", formatCount(sample.scriptsUpdated));
      list.set("coroutines", formatCount(sample.coroutinesResumed));
      list.set("entities", formatCount(sample.entities));
      list.set("components", formatCount(sample.components));
      list.set("assets loaded", formatCount(sample.assetsLoaded));
      list.set("assets in flight", formatCount(sample.assetsInFlight));
      list.set("asset bytes", formatBytes(sample.assetBytes));
      list.set("js heap", formatBytes(sample.heapBytes));
      if (host.sceneReloadDelegated) {
        list.set("scene reload", "handled by app.hotReload");
      }
      const last = host.hotReloads.at(-1);
      if (last !== undefined) {
        list.set("hot reload", `${last.label}${last.detail === "" ? "" : ` · ${last.detail}`}`);
      }
      list.truncate();
    },

    dispose(): void {
      rows = null;
      toggle = null;
    },
  };
}
