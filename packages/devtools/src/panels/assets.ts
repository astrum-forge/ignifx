import { button, element, setText } from "../dom/elements.js";
import { formatBytes, formatCount } from "../dom/format.js";
import { DEVTOOLS_CLASS_NAMES } from "../dom/styles.js";
import { devtoolsError, DevtoolsErrorCode } from "../errors.js";
import { probeAssetReload } from "../probes.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "../overlay/panel.js";

/**
 * The **Assets** panel (`docs/architecture/15-devtools-and-diagnostics.md` §4: *"handles,
 * refcounts, sizes, force reload"*).
 *
 * ## What it can enumerate, and what it cannot
 *
 * `Assets` publishes `get(address)` but no listing of live handles
 * (`packages/core/api/core.api.md`, `Assets`), so the panel walks the **manifest** and asks for a
 * handle per address. That covers everything a build produced, which is what a developer looks for.
 * It does not cover a handle created by `app.assets.register(...)` at run time under an address the
 * manifest never carried; those rows are missing until core publishes a handle listing.
 *
 * ## Force reload
 *
 * `AssetsImpl.reload(address)` is the entry point `@ignifx/vite-plugin`'s HMR channel calls
 * (`packages/core/src/assets/assets-service.ts`), and it is not on the public `Assets` interface,
 * so the button reaches it structurally and reports `IGX-1555` on a build that has none.
 */

/** How many rows the panel will show. A manifest of ten thousand entries is a build problem, not a panel problem. */
const MAX_ROWS = 200;

/** One pooled asset row. */
interface AssetRow {
  /** The row element. */
  readonly row: HTMLElement;
  /** The address. */
  readonly address: HTMLElement;
  /** The state, refcount and size. */
  readonly detail: HTMLElement;
  /** The reload button. */
  readonly reload: HTMLButtonElement;
}

/**
 * Builds the Assets panel.
 *
 * @returns The panel.
 *
 * @internal
 */
export function createAssetsPanel(): DevtoolsPanel {
  const rows: AssetRow[] = [];
  const bound: string[] = [];
  let list: HTMLElement | null = null;
  let summary: HTMLElement | null = null;
  let host: DevtoolsPanelHost | null = null;
  let reloader: ((address: string) => void) | null = null;
  let probed = false;

  /**
   * Returns the pooled row at an index, creating it the first time.
   *
   * @param at - The pool slot.
   * @returns The row.
   */
  function rowAt(at: number): AssetRow {
    const existing = rows[at];
    if (existing !== undefined) {
      return existing;
    }
    const owner = host;
    const parent = list;
    if (owner === null || parent === null) {
      throw new TypeError("The assets panel was refreshed before it was mounted.");
    }
    const row = element(owner.document, "div", DEVTOOLS_CLASS_NAMES.row);
    const address = element(owner.document, "span", DEVTOOLS_CLASS_NAMES.label);
    const detail = element(owner.document, "span", DEVTOOLS_CLASS_NAMES.value);
    const reload = element(owner.document, "button", DEVTOOLS_CLASS_NAMES.button);
    reload.type = "button";
    reload.textContent = "reload";
    reload.addEventListener("click", (): void => {
      const target = bound[at] ?? "";
      if (target === "") {
        return;
      }
      if (reloader === null) {
        owner.report(
          devtoolsError(DevtoolsErrorCode.assetReloadUnsupported, `${target} cannot be reloaded by this build.`, {
            context: { address: target },
            hint: "Force reload needs an asset service with a reload entry point; use the Vite dev server instead.",
          }),
        );
        return;
      }
      reloader(target);
    });
    row.append(address, detail, reload);
    parent.append(row);
    const created: AssetRow = { row, address, detail, reload };
    rows.push(created);
    return created;
  }

  return {
    name: "assets",
    title: "Assets",
    perFrame: false,

    mount(root: HTMLElement, panelHost: DevtoolsPanelHost): void {
      host = panelHost;
      const bar = element(panelHost.document, "div", DEVTOOLS_CLASS_NAMES.toolbar);
      const total = element(panelHost.document, "span", DEVTOOLS_CLASS_NAMES.label);
      bar.append(
        total,
        button(panelHost.document, "collect", (): void => {
          panelHost.app.assets.gc();
        }),
      );
      const body = element(panelHost.document, "div", DEVTOOLS_CLASS_NAMES.panel);
      root.append(bar, body);
      summary = total;
      list = body;
    },

    update(panelHost: DevtoolsPanelHost): void {
      if (list === null) {
        return;
      }
      host = panelHost;
      if (!probed) {
        probed = true;
        reloader = probeAssetReload(panelHost.app);
      }
      const entries = panelHost.app.assets.manifest.entries;
      let used = 0;
      for (let index = 0; index < entries.length && used < MAX_ROWS; index += 1) {
        const entry = entries[index];
        if (entry === undefined) {
          continue;
        }
        const handle = panelHost.app.assets.get(entry.address);
        if (handle === null) {
          continue;
        }
        const row = rowAt(used);
        bound[used] = entry.address;
        used += 1;
        row.row.style.setProperty("display", "flex");
        setText(row.address, entry.address);
        setText(
          row.detail,
          `${handle.state} · ${formatCount(handle.refCount)} ref · ${formatBytes(entry.bytes ?? -1)}`,
        );
        row.reload.disabled = reloader === null;
      }
      for (let index = used; index < rows.length; index += 1) {
        rows[index]?.row.style.setProperty("display", "none");
        bound[index] = "";
      }
      setText(
        summary ?? list,
        `${formatCount(used)} live of ${formatCount(entries.length)} in manifest` +
          (reloader === null ? " · no reload in this build" : ""),
      );
    },

    dispose(): void {
      rows.length = 0;
      bound.length = 0;
      list = null;
      summary = null;
      host = null;
      reloader = null;
      probed = false;
    },
  };
}
