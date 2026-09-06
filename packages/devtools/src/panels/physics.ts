import { element, heading, RowList } from "../dom/elements.js";
import { DEVTOOLS_CLASS_NAMES } from "../dom/styles.js";
import { hasPhysics2D, probePhysicsDebug } from "../probes.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "../overlay/panel.js";
import type { DiagnosticsGroup } from "@ignifx/core";

/**
 * The **Physics** panel (`docs/architecture/15-devtools-and-diagnostics.md` §4: *"Lite physics
 * viewer toggle, counts"*, with `09-physics.md` §9 and `11-2d-toolkit.md` §8).
 *
 * The counts are read from the diagnostics groups the two physics extensions register — `physics`
 * and `physics2d` — rather than from their services, so the panel shows whatever counters a future
 * release adds without being changed. Only the debug-viewer toggle is service-specific, and it is
 * duck-typed like every other optional reach.
 */

/**
 * Writes one diagnostics group's counters into a row list.
 *
 * @param rows - The list to write into.
 * @param prefix - The label prefix.
 * @param group - The group, or `null` when nothing registered it.
 * @param absent - What to show when the group is absent.
 */
function appendGroup(rows: RowList, prefix: string, group: DiagnosticsGroup | null, absent: string): void {
  if (group === null) {
    rows.set(prefix, absent);
    return;
  }
  const names = group.counterNames;
  for (let index = 0; index < names.length; index += 1) {
    rows.set(`${prefix}.${names[index] ?? ""}`, String(group.get(index)));
  }
}

/**
 * Builds the Physics panel.
 *
 * @returns The panel.
 *
 * @internal
 */
export function createPhysicsPanel(): DevtoolsPanel {
  let rows: RowList | null = null;
  let toggle: HTMLInputElement | null = null;

  return {
    name: "physics",
    title: "Physics",
    perFrame: false,

    mount(root: HTMLElement, host: DevtoolsPanelHost): void {
      const bar = element(host.document, "div", DEVTOOLS_CLASS_NAMES.toolbar);
      const box = element(host.document, "input", DEVTOOLS_CLASS_NAMES.input);
      box.type = "checkbox";
      box.addEventListener("change", (): void => {
        probePhysicsDebug(host.app)?.setEnabled(box.checked);
      });
      const caption = element(host.document, "span", DEVTOOLS_CLASS_NAMES.label);
      caption.textContent = "debug viewer";
      bar.append(box, caption);
      root.append(bar, heading(host.document, "counters"));
      toggle = box;
      rows = new RowList(host.document, root);
    },

    update(host: DevtoolsPanelHost): void {
      const list = rows;
      if (list === null) {
        return;
      }
      const viewer = probePhysicsDebug(host.app);
      if (toggle !== null) {
        toggle.disabled = viewer === null;
        const enabled = viewer?.enabled ?? false;
        if (toggle.checked !== enabled) {
          toggle.checked = enabled;
        }
      }
      const diagnostics = host.app.diagnostics;
      list.begin();
      appendGroup(list, "physics", diagnostics.group("physics"), "@ignifx/physics is not registered");
      appendGroup(
        list,
        "physics2d",
        diagnostics.group("physics2d"),
        hasPhysics2D(host.app) ? "no counters yet" : "@ignifx/physics-2d is not registered",
      );
      list.truncate();
    },

    dispose(): void {
      rows = null;
      toggle = null;
    },
  };
}
