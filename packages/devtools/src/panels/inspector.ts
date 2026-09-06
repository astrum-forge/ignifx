import { serializeScene } from "@ignifx/core";
import { button, element, heading, setText } from "../dom/elements.js";
import { DEVTOOLS_CLASS_NAMES } from "../dom/styles.js";
import { devtoolsError, DevtoolsErrorCode } from "../errors.js";
import { createFieldEditor, encodeForDisplay, readField } from "../inspector/fields.js";
import type { FieldEditor } from "../inspector/fields.js";
import type { DevtoolsPanel, DevtoolsPanelHost } from "../overlay/panel.js";
import type { Component, ComponentType, Entity, MutableVec3, Schema, Transform } from "@ignifx/core";

/**
 * The **Inspector** panel (`docs/architecture/15-devtools-and-diagnostics.md` §4: *"schema-driven
 * editing of any component's fields live; copy component/entity as JSON; 'select in world' via GPU
 * pick"*).
 *
 * ## Why the editors are rebuilt rarely and refreshed often
 *
 * Building an editor means creating DOM; refreshing one means writing a string. The panel rebuilds
 * only when the selection changes or the selected entity gains or loses a component, and refreshes
 * every tick — which is what makes *"inspector edits reflect immediately"* cheap in both
 * directions: a value typed into a box is on the component before the next frame runs, and a value
 * a script writes is in the box on the next refresh.
 */

/** How many components the panel will build editors for before it stops, so a pathological entity cannot lock the browser. */
const MAX_COMPONENTS = 64;

/** The three vectors the transform section edits, and the accessor each one writes through. */
const TRANSFORM_ROWS = [
  { label: "position", read: (transform: Transform): MutableVec3 => transform.localPosition },
  { label: "rotation", read: (transform: Transform): MutableVec3 => transform.localEulerAngles },
  { label: "scale", read: (transform: Transform): MutableVec3 => transform.localScale },
] as const;

/** The component names of a vector row, in order. */
const AXES = ["x", "y", "z"] as const;

/** How many decimals a transform component is shown with. */
const TRANSFORM_DECIMALS = 4;

/**
 * Builds the always-present transform section.
 *
 * @remarks
 * `Transform` declares no schema — the scene format writes it as a first-class record rather than
 * as `props` (`packages/core/src/transform/transform.ts` has no `Component.define` call), so the
 * schema-driven editor has nothing to build from. It is also the one component every entity has and
 * the first thing anyone opens the inspector to change, so the panel builds it by hand and writes
 * through the documented accessors: `transform.localPosition` and friends are *live views over the
 * Lite node*, which is why an edit moves the entity in the same frame rather than at the next sync.
 *
 * `localEulerAngles` is a computed value rather than a live view, so its row assigns the whole
 * vector; the other two are mutated in place.
 *
 * @param host - The panel host.
 * @param parent - Where the rows go.
 * @param entity - The entity being inspected.
 * @returns The refresh function.
 */
function appendTransform(host: DevtoolsPanelHost, parent: HTMLElement, entity: Entity): () => void {
  parent.append(heading(host.document, "ignifx/Transform"));
  const inputs: HTMLInputElement[][] = [];
  for (let row = 0; row < TRANSFORM_ROWS.length; row += 1) {
    const spec = TRANSFORM_ROWS[row];
    if (spec === undefined) {
      continue;
    }
    const line = element(host.document, "div", DEVTOOLS_CLASS_NAMES.row);
    const label = element(host.document, "span", DEVTOOLS_CLASS_NAMES.label);
    label.textContent = spec.label;
    const holder = element(host.document, "span", DEVTOOLS_CLASS_NAMES.value);
    const fields: HTMLInputElement[] = [];
    for (let axis = 0; axis < AXES.length; axis += 1) {
      const key = AXES[axis] ?? "x";
      const input = element(host.document, "input", DEVTOOLS_CLASS_NAMES.input);
      input.type = "number";
      input.step = "any";
      input.title = `${spec.label}.${key}`;
      input.addEventListener("change", (): void => {
        const parsed = Number(input.value);
        if (!Number.isFinite(parsed) || entity.isDestroyed) {
          return;
        }
        const vector = spec.read(entity.transform);
        vector[key] = parsed;
        if (spec.label === "rotation") {
          entity.transform.localEulerAngles = vector;
        }
      });
      fields.push(input);
      holder.append(input);
    }
    inputs.push(fields);
    line.append(label, holder);
    parent.append(line);
  }
  return (): void => {
    if (entity.isDestroyed) {
      return;
    }
    for (let row = 0; row < TRANSFORM_ROWS.length; row += 1) {
      const spec = TRANSFORM_ROWS[row];
      const fields = inputs[row];
      if (spec === undefined || fields === undefined) {
        continue;
      }
      const vector = spec.read(entity.transform);
      for (let axis = 0; axis < AXES.length; axis += 1) {
        const input = fields[axis];
        const text = String(Number(vector[AXES[axis] ?? "x"].toFixed(TRANSFORM_DECIMALS)));
        if (input !== undefined && input.value !== text) {
          input.value = text;
        }
      }
    }
  };
}

/**
 * Reads a component's registered schema and display name.
 *
 * @param host - The panel host, for the component registry.
 * @param component - The component.
 * @returns The schema (or `null` when the class declares none) and the label to show.
 */
function describe(host: DevtoolsPanelHost, component: Component): { schema: Schema | null; label: string } {
  const type: unknown = Reflect.get(component, "constructor");
  if (type === null || typeof type !== "function" || !("prototype" in type)) {
    return { schema: null, label: "component" };
  }
  // Boundary assertion (coding standards §5.2): every component instance's constructor is a
  // component class, which is exactly the `ComponentType` shape the registry describes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
  const componentType = type as ComponentType;
  const registry = host.app.world.registry;
  const info = registry.isRegistered(componentType) ? registry.describe(componentType) : null;
  const named: unknown = Reflect.get(componentType, "name");
  const label = info?.typeId ?? (typeof named === "string" && named !== "" ? named : "component");
  return { schema: info?.schema ?? componentType.schema ?? null, label };
}

/**
 * Serializes one component the way a scene file would carry it.
 *
 * @param component - The component.
 * @param schema - Its schema, or `null`.
 * @param label - Its display name.
 * @returns The JSON text.
 */
function componentJson(component: Component, schema: Schema | null, label: string): string {
  if (schema === null) {
    return JSON.stringify({ type: label, props: {} }, null, 2);
  }
  const props: Record<string, string> = {};
  for (const [name, field] of Object.entries(schema)) {
    props[name] = encodeForDisplay(field, readField(component, name));
  }
  const lines: string[] = [];
  for (const [name, json] of Object.entries(props)) {
    lines.push(`    ${JSON.stringify(name)}: ${json}`);
  }
  return `{\n  ${JSON.stringify("type")}: ${JSON.stringify(label)},\n  ${JSON.stringify("props")}: {\n${lines.join(",\n")}\n  }\n}`;
}

/**
 * Builds the Inspector panel.
 *
 * @returns The panel.
 *
 * @internal
 */
export function createInspectorPanel(): DevtoolsPanel {
  const editors: FieldEditor[] = [];
  let body: HTMLElement | null = null;
  let header: HTMLElement | null = null;
  let output: HTMLTextAreaElement | null = null;
  let builtFor: Entity | null = null;
  let builtCount = -1;
  let built = false;
  let transformRefresh: (() => void) | null = null;
  let detachPick: (() => void) | null = null;

  /**
   * Writes a JSON blob into the panel's output box and, when the host has a clipboard, onto it.
   *
   * @param host - The panel host.
   * @param json - The text to publish.
   */
  function publish(host: DevtoolsPanelHost, json: string): void {
    const box = output;
    if (box !== null) {
      box.value = json;
    }
    const clipboard: unknown = Reflect.get(host.document.defaultView?.navigator ?? {}, "clipboard");
    const write: unknown =
      clipboard === null || typeof clipboard !== "object" ? null : Reflect.get(clipboard, "writeText");
    if (typeof write === "function") {
      const result: unknown = Reflect.apply(write, clipboard, [json]);
      if (result instanceof Promise) {
        result.catch((error: unknown): void => {
          host.report(error);
        });
      }
    }
  }

  /**
   * Arms a one-shot canvas click that selects whatever `renderer.pickAsync` finds under it.
   *
   * @param host - The panel host.
   */
  function armPick(host: DevtoolsPanelHost): void {
    detachPick?.();
    detachPick = null;
    const surface = host.app.renderer.surface;
    if (surface === null || typeof HTMLCanvasElement === "undefined" || !(surface instanceof HTMLCanvasElement)) {
      host.report(
        devtoolsError(DevtoolsErrorCode.pickUnavailable, "Select in world needs a DOM canvas to click on.", {
          hint: "GPU picking is a browser-only facility; a headless app has nothing to pick from.",
        }),
      );
      return;
    }
    const canvas = surface;
    const onClick = (event: MouseEvent): void => {
      detachPick?.();
      detachPick = null;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
      host.app.renderer
        .pickAsync(x, y)
        .then((pick): void => {
          host.select(pick === null ? null : pick.entity);
        })
        .catch((error: unknown): void => {
          host.report(error);
        });
    };
    canvas.addEventListener("click", onClick, { once: true });
    detachPick = (): void => {
      canvas.removeEventListener("click", onClick);
    };
  }

  /**
   * Rebuilds every editor for the selected entity.
   *
   * @param host - The panel host.
   * @param entity - The entity to inspect, or `null`.
   */
  function rebuild(host: DevtoolsPanelHost, entity: Entity | null): void {
    const parent = body;
    if (parent === null) {
      return;
    }
    editors.length = 0;
    transformRefresh = null;
    parent.replaceChildren();
    builtFor = entity;
    builtCount = entity === null ? -1 : entity.components.length;
    if (entity === null) {
      parent.append(heading(host.document, "no selection"));
      return;
    }
    transformRefresh = appendTransform(host, parent, entity);
    const components = entity.components;
    const limit = Math.min(components.length, MAX_COMPONENTS);
    for (let index = 0; index < limit; index += 1) {
      const component = components[index];
      if (component === undefined) {
        continue;
      }
      const { schema, label } = describe(host, component);
      if (schema === null && label === "ignifx/Transform") {
        // Already drawn by hand above; drawing an empty second section for it would only confuse.
        continue;
      }
      const title = element(host.document, "div", DEVTOOLS_CLASS_NAMES.toolbar);
      title.append(
        heading(host.document, label),
        button(host.document, "copy", (): void => {
          publish(host, componentJson(component, schema, label));
        }),
      );
      parent.append(title);
      if (schema === null) {
        continue;
      }
      appendFields(host, parent, component, label, schema);
    }
  }

  /**
   * Builds one component's field rows, folded under their `group` headings.
   *
   * @param host - The panel host.
   * @param parent - Where the rows go.
   * @param component - The component being edited.
   * @param label - Its display name.
   * @param schema - Its declared fields.
   */
  function appendFields(
    host: DevtoolsPanelHost,
    parent: HTMLElement,
    component: Component,
    label: string,
    schema: Schema,
  ): void {
    const groups = new Set<string>();
    for (const [name, field] of Object.entries(schema)) {
      const editor = createFieldEditor({ host, component, label, name, field });
      if (editor === null) {
        continue;
      }
      if (editor.group !== "" && !groups.has(editor.group)) {
        groups.add(editor.group);
        parent.append(heading(host.document, editor.group));
      }
      parent.append(editor.row);
      editors.push(editor);
    }
  }

  return {
    name: "inspector",
    title: "Inspector",
    perFrame: false,

    mount(root: HTMLElement, host: DevtoolsPanelHost): void {
      const bar = element(host.document, "div", DEVTOOLS_CLASS_NAMES.toolbar);
      const name = element(host.document, "span", DEVTOOLS_CLASS_NAMES.label);
      bar.append(
        name,
        button(host.document, "copy entity", (): void => {
          const entity = host.selected;
          if (entity !== null && !entity.isDestroyed) {
            publish(host, JSON.stringify(serializeScene([entity]), null, 2));
          }
        }),
        button(host.document, "select in world", (): void => {
          armPick(host);
        }),
      );
      const fields = element(host.document, "div", DEVTOOLS_CLASS_NAMES.panel);
      const json = element(host.document, "textarea", DEVTOOLS_CLASS_NAMES.input);
      json.readOnly = true;
      json.rows = 4;
      root.append(bar, fields, json);
      header = name;
      body = fields;
      output = json;
    },

    update(host: DevtoolsPanelHost): void {
      const entity = host.selected;
      const alive = entity !== null && !entity.isDestroyed;
      const current = alive ? entity : null;
      if (!built || current !== builtFor || (current !== null && current.components.length !== builtCount)) {
        built = true;
        rebuild(host, current);
      }
      if (header !== null) {
        setText(header, current === null ? "-" : `${current.name} · ${current.uid}`);
      }
      transformRefresh?.();
      for (let index = 0; index < editors.length; index += 1) {
        editors[index]?.refresh();
      }
    },

    dispose(): void {
      detachPick?.();
      detachPick = null;
      editors.length = 0;
      body = null;
      header = null;
      output = null;
      builtFor = null;
      builtCount = -1;
      built = false;
      transformRefresh = null;
    },
  };
}
