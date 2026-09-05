import { assertNever } from "@ignifx/core";
import { inputError, InputErrorCode } from "../errors.js";

/**
 * Binding processors (`docs/architecture/08-input.md` §3). A processor is written as a string in
 * `.input.json` — `"deadzone(0.15)"`, `"scale(0.1)"` — and parsed **once**, at load time, into the
 * small struct below. Nothing on the per-frame path parses text (coding standards §7).
 */

/**
 * A two-component value carried through a processor chain. Scalar controls use `x` and leave `y`
 * at `0`.
 *
 * @public
 */
export interface ControlValue {
  /** The scalar value, or the vector's x component. */
  x: number;
  /** The vector's y component; `0` for scalar controls. */
  y: number;
}

/**
 * The processors a binding may declare.
 *
 * @public
 */
export const ProcessorKind = {
  /** Drops actuation below `min` and rescales `[min, max]` onto `[0, 1]`. Radial for vectors. */
  deadzone: "deadzone",
  /** Negates every component. */
  invert: "invert",
  /** Multiplies the components by a per-axis factor. */
  scale: "scale",
  /** Clamps every component into a range. */
  clamp: "clamp",
  /** Scales a vector to unit length; clamps a scalar into `[-1, 1]`. */
  normalize: "normalize",
} as const;

/**
 * The union of the processor names.
 *
 * @public
 */
export type ProcessorKind = (typeof ProcessorKind)[keyof typeof ProcessorKind];

/**
 * One parsed processor: its kind and its two numeric parameters, already defaulted.
 *
 * @public
 */
export interface Processor {
  /** Which processor this is. */
  readonly kind: ProcessorKind;
  /** The first parameter: `min` for `deadzone` and `clamp`, `x` for `scale`. */
  readonly first: number;
  /** The second parameter: `max` for `deadzone` and `clamp`, `y` for `scale`. */
  readonly second: number;
}

/** The processor names, for the `IGX-0802` hint. */
const PROCESSOR_NAMES: readonly ProcessorKind[] = Object.freeze([
  ProcessorKind.deadzone,
  ProcessorKind.invert,
  ProcessorKind.scale,
  ProcessorKind.clamp,
  ProcessorKind.normalize,
]);

/**
 * Turns a processor name into its kind.
 *
 * @param name - The text before the parenthesis.
 * @returns The kind, or `null` when no processor is spelled that way.
 */
function kindFor(name: string): ProcessorKind | null {
  for (const kind of PROCESSOR_NAMES) {
    if (kind === name) {
      return kind;
    }
  }
  return null;
}

/**
 * Reads the comma-separated numbers between the parentheses of a processor.
 *
 * @param source - The whole processor string, for the error message.
 * @param text - The text between the parentheses, possibly empty.
 * @returns The parsed numbers.
 * @throws IgnifxError with code `IGX-0802` when an argument is not a finite number.
 */
function parseArguments(source: string, text: string): readonly number[] {
  if (text.trim() === "") {
    return [];
  }
  const values: number[] = [];
  for (const part of text.split(",")) {
    const value = Number(part.trim());
    if (!Number.isFinite(value)) {
      throw inputError(InputErrorCode.unknownProcessor, `${source} has an argument that is not a number.`, {
        context: { processor: source, argument: part.trim() },
        hint: "Processor arguments are plain decimal numbers, as in deadzone(0.15, 0.9).",
      });
    }
    values.push(value);
  }
  return values;
}

/**
 * Parses one processor string.
 *
 * @param source - The processor, for example `deadzone(0.15)` or `invert`.
 * @returns The parsed processor with its parameters defaulted.
 * @throws IgnifxError with code `IGX-0802` when the name is unknown or an argument is not a number.
 *
 * @example
 * ```ts
 * parseProcessor("scale(0.1)"); // { kind: "scale", first: 0.1, second: 0.1 }
 * ```
 *
 * @public
 */
export function parseProcessor(source: string): Processor {
  const trimmed = source.trim();
  const open = trimmed.indexOf("(");
  const name = open < 0 ? trimmed : trimmed.slice(0, open);
  const kind = kindFor(name);
  if (kind === null) {
    throw inputError(InputErrorCode.unknownProcessor, `${name} is not a known input processor.`, {
      context: { processor: name },
      hint: `Known processors are ${PROCESSOR_NAMES.join(", ")}.`,
    });
  }
  if (open >= 0 && !trimmed.endsWith(")")) {
    throw inputError(InputErrorCode.unknownProcessor, `${trimmed} is missing its closing parenthesis.`, {
      context: { processor: trimmed },
      hint: "Write the arguments as deadzone(0.15) or scale(2, 3).",
    });
  }
  const values = open < 0 ? [] : parseArguments(trimmed, trimmed.slice(open + 1, -1));
  return defaulted(kind, values);
}

/**
 * Applies each processor's documented defaults to the arguments it was given.
 *
 * @param kind - The processor kind.
 * @param values - The parsed arguments.
 * @returns The processor.
 */
function defaulted(kind: ProcessorKind, values: readonly number[]): Processor {
  switch (kind) {
    case ProcessorKind.deadzone: {
      return { kind, first: values[0] ?? 0.125, second: values[1] ?? 1 };
    }
    case ProcessorKind.scale: {
      const x = values[0] ?? 1;
      return { kind, first: x, second: values[1] ?? x };
    }
    case ProcessorKind.clamp: {
      return { kind, first: values[0] ?? -1, second: values[1] ?? 1 };
    }
    case ProcessorKind.invert:
    case ProcessorKind.normalize: {
      return { kind, first: 0, second: 0 };
    }
    default: {
      return assertNever(kind, "input processor kind");
    }
  }
}

/**
 * Parses a binding's whole processor list.
 *
 * @param sources - The processor strings, in application order.
 * @returns The parsed chain.
 * @throws IgnifxError with code `IGX-0802` for the first unparseable entry.
 *
 * @public
 */
export function parseProcessors(sources: readonly string[]): readonly Processor[] {
  const chain: Processor[] = [];
  for (const source of sources) {
    chain.push(parseProcessor(source));
  }
  return chain;
}

/**
 * Runs one processor over a value, in place.
 *
 * @param processor - The processor.
 * @param value - The value to transform.
 * @param isVector - Whether the value has two meaningful components.
 */
function applyOne(processor: Processor, value: ControlValue, isVector: boolean): void {
  switch (processor.kind) {
    case ProcessorKind.deadzone: {
      applyDeadzone(processor, value, isVector);
      return;
    }
    case ProcessorKind.invert: {
      value.x = -value.x;
      value.y = -value.y;
      return;
    }
    case ProcessorKind.scale: {
      value.x *= processor.first;
      value.y *= processor.second;
      return;
    }
    case ProcessorKind.clamp: {
      value.x = Math.min(processor.second, Math.max(processor.first, value.x));
      value.y = Math.min(processor.second, Math.max(processor.first, value.y));
      return;
    }
    case ProcessorKind.normalize: {
      applyNormalize(value, isVector);
      return;
    }
    default: {
      assertNever(processor.kind, "input processor kind");
    }
  }
}

/**
 * Radial deadzone for vectors, axial for scalars
 * (`docs/architecture/08-input.md` §3: "deadzone(min, max) (radial for sticks)").
 *
 * @param processor - The deadzone parameters.
 * @param value - The value to transform.
 * @param isVector - Whether the value has two meaningful components.
 */
function applyDeadzone(processor: Processor, value: ControlValue, isVector: boolean): void {
  const min = processor.first;
  const max = processor.second;
  const span = max - min;
  if (!isVector) {
    const magnitude = Math.abs(value.x);
    if (magnitude <= min) {
      value.x = 0;
      return;
    }
    const scaled = span <= 0 ? 1 : Math.min(1, (magnitude - min) / span);
    value.x = Math.sign(value.x) * scaled;
    return;
  }
  const magnitude = Math.hypot(value.x, value.y);
  if (magnitude <= min || magnitude === 0) {
    value.x = 0;
    value.y = 0;
    return;
  }
  const scaled = span <= 0 ? 1 : Math.min(1, (magnitude - min) / span);
  value.x = (value.x / magnitude) * scaled;
  value.y = (value.y / magnitude) * scaled;
}

/**
 * Scales a vector to unit length, or clamps a scalar into `[-1, 1]`.
 *
 * @param value - The value to transform.
 * @param isVector - Whether the value has two meaningful components.
 */
function applyNormalize(value: ControlValue, isVector: boolean): void {
  if (!isVector) {
    value.x = Math.min(1, Math.max(-1, value.x));
    return;
  }
  const magnitude = Math.hypot(value.x, value.y);
  if (magnitude === 0) {
    return;
  }
  value.x /= magnitude;
  value.y /= magnitude;
}

/**
 * Runs a whole processor chain over a value, in place. Allocation-free: the chain and the value are
 * both owned by the caller.
 *
 * @param chain - The parsed processors, in application order.
 * @param value - The value to transform.
 * @param isVector - Whether the value has two meaningful components.
 *
 * @example
 * ```ts
 * const value = { x: 0.1, y: 0 };
 * applyProcessors(parseProcessors(["deadzone(0.15)"]), value, false);
 * value.x; // 0
 * ```
 *
 * @public
 */
export function applyProcessors(chain: readonly Processor[], value: ControlValue, isVector: boolean): void {
  for (let index = 0; index < chain.length; index += 1) {
    const processor = chain[index];
    if (processor !== undefined) {
      applyOne(processor, value, isVector);
    }
  }
}
