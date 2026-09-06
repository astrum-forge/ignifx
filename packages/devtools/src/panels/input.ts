import { RowList, heading } from "../dom/elements.js";
import { probeInput } from "../probes.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "../overlay/panel.js";

/**
 * The **Input** panel (`docs/architecture/15-devtools-and-diagnostics.md` §4: *"live action values,
 * devices, scheme"*).
 *
 * `@ignifx/input` is an optional peer, so every value comes through `probeInput`, which duck-types
 * `app.input` and answers `null` when the extension is absent. The panel then says so instead of
 * showing an empty table.
 */

/**
 * Builds the Input panel.
 *
 * @returns The panel.
 *
 * @internal
 */
export function createInputPanel(): DevtoolsPanel {
  let rows: RowList | null = null;

  return {
    name: "input",
    title: "Input",
    perFrame: false,

    mount(root: HTMLElement, host: DevtoolsPanelHost): void {
      root.append(heading(host.document, "actions"));
      rows = new RowList(host.document, root);
    },

    update(host: DevtoolsPanelHost): void {
      const list = rows;
      if (list === null) {
        return;
      }
      list.begin();
      const input = probeInput(host.app);
      if (input === null) {
        list.set("@ignifx/input", "not registered");
        list.truncate();
        return;
      }
      list.set("scheme", input.scheme === "" ? "-" : input.scheme);
      list.set("devices", input.devices.length === 0 ? "-" : input.devices.join(", "));
      for (let index = 0; index < input.actions.length; index += 1) {
        const action = input.actions[index];
        if (action === undefined) {
          continue;
        }
        list.set(`${action.map}/${action.action}`, `${action.value}${action.pressed ? " ▪" : ""}`);
      }
      list.truncate();
    },

    dispose(): void {
      rows = null;
    },
  };
}
