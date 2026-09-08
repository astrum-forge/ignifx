import { DeviceKind } from "../devices/device.js";
import { compositeIsVector, CompositeKind, compositeParts, parseComposite } from "./composites.js";
import { applyProcessors, parseProcessors } from "./processors.js";
import type { ControlValue, Processor } from "./processors.js";
import type { BindingDefinition } from "../asset/definition.js";
import type { ControlKind } from "../devices/control.js";
import type { ControlRef } from "../devices/devices.js";

/**
 * One binding of one action (`docs/architecture/08-input.md` §3): a control path or a composite,
 * a processor chain, and a control-scheme tag. Paths and processors are resolved and parsed once,
 * when the binding is created or its override changes; evaluation then touches only integers and
 * typed arrays (coding standards §7).
 */

/**
 * What a {@link Binding} needs from the rest of the engine: path resolution, and a way to tell the
 * service that its resolved controls changed.
 *
 * @public
 */
export interface BindingResolver {
  /**
   * Resolves a binding path to a device control.
   *
   * @param path - The binding path.
   * @param kind - The kind a `<Virtual>` control is created with when it does not exist yet.
   * @returns The resolved control.
   */
  resolveControl(path: string, kind?: ControlKind): ControlRef;
  /** Tells the owner that this binding's control set changed and subscriptions must be rebuilt. */
  invalidateBindings(): void;
}

/**
 * What evaluation needs to know about the frame.
 *
 * @public
 */
export interface BindingContext {
  /** `true` while a DOM text field has focus; keyboard controls then read as released. */
  readonly uiHasFocus: boolean;
  /**
   * `true` while a pointer is pressed on the UI overlay; pointing-device controls then read as
   * released, so a drag that started on a slider does not also turn the camera.
   */
  readonly uiHasPointer: boolean;
  /** `true` when bindings tagged with another control scheme must not resolve. */
  readonly strictSchemes: boolean;
  /** The control scheme in use this frame. */
  readonly currentScheme: string;
}

/**
 * One binding of one action.
 *
 * @remarks
 * A binding tagged with a control scheme still resolves when another scheme is active. Unity's
 * schemes filter device *pairing* and UI glyphs, not resolution, and a game that binds jump to both
 * the space bar and the south button expects both to work whichever scheme the player used last.
 * Set `input.strictSchemes` to make the tag a filter instead.
 *
 * @example
 * ```ts
 * const jump = app.input.actions.get("jump");
 * jump.bindings[0].overridePath = "<Keyboard>/enter";
 * ```
 *
 * @public
 */
export class Binding {
  /** The composite this binding uses, or `null` for a simple path binding. */
  readonly composite: CompositeKind | null;

  /** The path the binding was declared with; `""` for a composite. */
  readonly path: string;

  /** The control scheme this binding is tagged with; `""` when it belongs to every scheme. */
  readonly scheme: string;

  /** The processor strings the binding declared, in application order. */
  readonly processors: readonly string[];

  /** The composite part names, in evaluation order; empty for a simple binding. */
  readonly partNames: readonly string[];

  /** The path each composite part was declared with, in {@link Binding.partNames} order. */
  readonly partPaths: readonly string[];

  readonly #resolver: BindingResolver;

  readonly #chain: readonly Processor[];

  #refs: readonly ControlRef[];

  #overridePath: string | null = null;

  #isVector: boolean;

  /**
   * Builds a binding from its document form.
   *
   * @param definition - The binding as it appears in an `ignifx.inputactions` document.
   * @param resolver - How paths become controls, and how the owner is told they changed.
   * @throws IgnifxError with code `IGX-0802`, `IGX-0803`, or `IGX-0806` when the definition names
   * an unknown processor, an unresolvable path, or an unknown composite.
   */
  constructor(definition: BindingDefinition, resolver: BindingResolver) {
    this.#resolver = resolver;
    this.scheme = definition.scheme ?? "";
    this.processors = definition.processors ?? [];
    this.#chain = parseProcessors(this.processors);
    const compositeName = definition.composite ?? "";
    if (compositeName === "") {
      this.composite = null;
      this.path = definition.path ?? "";
      this.partNames = [];
      this.partPaths = [];
      this.#refs = [];
      this.#isVector = false;
      this.#resolve();
      return;
    }
    const composite = parseComposite(compositeName);
    this.composite = composite;
    this.path = "";
    const names = compositeParts(composite);
    this.partNames = names;
    const paths: string[] = [];
    for (const name of names) {
      paths.push(readPart(definition, name));
    }
    this.partPaths = paths;
    this.#refs = [];
    this.#isVector = compositeIsVector(composite);
    this.#resolve();
  }

  /**
   * The path that replaces {@link Binding.path} at run time, or `null` when the binding is not
   * overridden (`docs/architecture/08-input.md` §6).
   *
   * @remarks
   * Assigning re-resolves the binding: a path that does not resolve throws `IGX-0803` and the
   * previous override is kept. A composite binding cannot be overridden as a whole; override the
   * action's simple bindings instead.
   *
   * @returns The override, or `null`. Assign `null` to return to the declared path.
   */
  get overridePath(): string | null {
    return this.#overridePath;
  }

  // A second TSDoc block on the setter is API Extractor's `ae-setter-with-docs` warning, which
  // fails the non-local `api-report` run; the accessor pair is documented on the getter above.
  // eslint-disable-next-line jsdoc/require-jsdoc -- see the note above.
  set overridePath(path: string | null) {
    if (path === this.#overridePath) {
      return;
    }
    const previous = this.#overridePath;
    this.#overridePath = path;
    try {
      this.#resolve();
    } catch (error) {
      this.#overridePath = previous;
      this.#resolve();
      throw error;
    }
    this.#resolver.invalidateBindings();
  }

  /**
   * The path the binding actually reads: the override when there is one, otherwise the declared
   * path.
   *
   * @returns The effective path; `""` for a composite with no override.
   */
  get effectivePath(): string {
    return this.#overridePath ?? this.path;
  }

  /**
   * The controls this binding reads, after path resolution.
   *
   * @returns The resolved controls: one for a simple binding, one per part for a composite.
   *
   * @internal
   */
  get refs(): readonly ControlRef[] {
    return this.#refs;
  }

  /**
   * Whether the binding's value has two meaningful components before processors run.
   *
   * @returns `true` for a `2DVector` composite and for vector controls such as `<Mouse>/delta`.
   *
   * @internal
   */
  get isVector(): boolean {
    return this.#isVector;
  }

  /**
   * The device family this binding reads from, which is what `InputAction.activeDevice` reports
   * when this binding wins the frame. A composite answers with the device of its **first**
   * part: the four parts of a `2DVector` are one device in every sane binding, and a composite that
   * does mix devices has no single answer to give.
   *
   * @returns The device kind, or `null` when the binding resolved to no control at all.
   *
   * @internal
   */
  get deviceKind(): DeviceKind | null {
    return this.#refs[0]?.device.kind ?? null;
  }

  /**
   * Reads the binding's value for this frame.
   *
   * @param out - The value to write into.
   * @param context - Focus, scheme, and strictness for this frame.
   *
   * @internal
   */
  evaluate(out: ControlValue, context: BindingContext): void {
    out.x = 0;
    out.y = 0;
    if (context.strictSchemes && this.scheme !== "" && this.scheme !== context.currentScheme) {
      return;
    }
    const composite = this.composite;
    if (composite === null) {
      readRef(this.#refs[0], context, out);
    } else {
      this.#evaluateComposite(composite, context, out);
    }
    applyProcessors(this.#chain, out, this.#isVector);
  }

  /**
   * Combines the composite's parts into one value.
   *
   * @param composite - Which composite this is.
   * @param context - The frame's suppression flags.
   * @param out - The value to write into.
   */
  #evaluateComposite(composite: CompositeKind, context: SuppressionFlags, out: ControlValue): void {
    const refs = this.#refs;
    switch (composite) {
      case CompositeKind.vector2D: {
        const up = scalarOf(refs[0], context);
        const down = scalarOf(refs[1], context);
        const left = scalarOf(refs[2], context);
        const right = scalarOf(refs[3], context);
        out.x = right - left;
        out.y = up - down;
        return;
      }
      case CompositeKind.axis1D: {
        out.x = scalarOf(refs[1], context) - scalarOf(refs[0], context);
        return;
      }
      case CompositeKind.buttonWithModifier: {
        out.x = scalarOf(refs[0], context) > 0 ? scalarOf(refs[1], context) : 0;
        return;
      }
      default: {
        return;
      }
    }
  }

  /** Resolves the effective path (or every composite part) to controls. */
  #resolve(): void {
    if (this.composite === null) {
      const path = this.effectivePath;
      if (path === "") {
        this.#refs = [];
        this.#isVector = false;
        return;
      }
      const ref = this.#resolver.resolveControl(path);
      this.#refs = [ref];
      this.#isVector = ref.control.components > 1;
      return;
    }
    const refs: ControlRef[] = [];
    for (const partPath of this.partPaths) {
      refs.push(this.#resolver.resolveControl(partPath));
    }
    this.#refs = refs;
  }
}

/**
 * Reads one composite part path out of a binding definition.
 *
 * @param definition - The binding definition.
 * @param part - The part name.
 * @returns The declared path, or `""` when the part is absent.
 */
function readPart(definition: BindingDefinition, part: string): string {
  switch (part) {
    case "up": {
      return definition.up ?? "";
    }
    case "down": {
      return definition.down ?? "";
    }
    case "left": {
      return definition.left ?? "";
    }
    case "right": {
      return definition.right ?? "";
    }
    case "negative": {
      return definition.negative ?? "";
    }
    case "positive": {
      return definition.positive ?? "";
    }
    case "modifier": {
      return definition.modifier ?? "";
    }
    case "button": {
      return definition.button ?? "";
    }
    default: {
      return "";
    }
  }
}

/** The two UI suppression flags a frame carries (`docs/architecture/08-input.md` §5). */
type SuppressionFlags = Pick<BindingContext, "uiHasFocus" | "uiHasPointer">;

/**
 * Whether the UI owns a control's device this frame: the keyboard while a text field has focus, a
 * pointing device while a pointer is pressed on the overlay.
 *
 * @param ref - The resolved control.
 * @param context - The frame's suppression flags.
 * @returns `true` when the control must read as released.
 */
function isSuppressed(ref: ControlRef, context: SuppressionFlags): boolean {
  const kind = ref.device.kind;
  if (context.uiHasFocus && kind === DeviceKind.keyboard) {
    return true;
  }
  return (
    context.uiHasPointer && (kind === DeviceKind.pointer || kind === DeviceKind.mouse || kind === DeviceKind.touch)
  );
}

/**
 * Reads a resolved control into a value, honouring UI suppression.
 *
 * @param ref - The resolved control, or `undefined` when the binding resolved to nothing.
 * @param context - The frame's suppression flags.
 * @param out - The value to write into.
 */
function readRef(ref: ControlRef | undefined, context: SuppressionFlags, out: ControlValue): void {
  out.x = 0;
  out.y = 0;
  if (ref === undefined || !ref.device.isConnected) {
    return;
  }
  if (isSuppressed(ref, context)) {
    return;
  }
  out.x = ref.device.valueAt(ref.control.offset);
  if (ref.control.components > 1) {
    out.y = ref.device.valueAt(ref.control.offset + 1);
  }
}

/**
 * Reads the scalar value of a resolved control.
 *
 * @param ref - The resolved control, or `undefined`.
 * @param context - The frame's suppression flags.
 * @returns The control's first component.
 */
function scalarOf(ref: ControlRef | undefined, context: SuppressionFlags): number {
  if (ref === undefined || !ref.device.isConnected) {
    return 0;
  }
  if (isSuppressed(ref, context)) {
    return 0;
  }
  return ref.device.valueAt(ref.control.offset);
}
