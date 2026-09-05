import { inputError, InputErrorCode } from "../errors.js";

/**
 * Binding composites (`docs/architecture/08-input.md` §3): several controls read together as one
 * value. A composite declares named parts, and each part carries its own binding path.
 */

/**
 * The composites a binding may declare.
 *
 * @public
 */
export const CompositeKind = {
  /** Four buttons read as a `vector2`: `up`, `down`, `left`, `right`. */
  vector2D: "2DVector",
  /** Two buttons read as a signed `axis`: `negative`, `positive`. */
  axis1D: "1DAxis",
  /** A button that only counts while a modifier is held: `modifier`, `button`. */
  buttonWithModifier: "ButtonWithModifier",
} as const;

/**
 * The union of the composite names.
 *
 * @public
 */
export type CompositeKind = (typeof CompositeKind)[keyof typeof CompositeKind];

/** The part names of each composite, in evaluation order. */
const COMPOSITE_PARTS: Readonly<Record<CompositeKind, readonly string[]>> = Object.freeze({
  [CompositeKind.vector2D]: Object.freeze(["up", "down", "left", "right"]),
  [CompositeKind.axis1D]: Object.freeze(["negative", "positive"]),
  [CompositeKind.buttonWithModifier]: Object.freeze(["modifier", "button"]),
});

/**
 * The part names one composite declares, in evaluation order.
 *
 * @param kind - The composite.
 * @returns The part names.
 *
 * @example
 * ```ts
 * compositeParts("2DVector"); // ["up", "down", "left", "right"]
 * ```
 *
 * @public
 */
export function compositeParts(kind: CompositeKind): readonly string[] {
  return COMPOSITE_PARTS[kind];
}

/**
 * Turns a composite name from a file into its kind.
 *
 * @param name - The `composite` field of a binding.
 * @returns The kind.
 * @throws IgnifxError with code `IGX-0806` when no composite is spelled that way.
 *
 * @public
 */
export function parseComposite(name: string): CompositeKind {
  for (const kind of Object.keys(COMPOSITE_PARTS)) {
    if (kind === name) {
      // The keys of `COMPOSITE_PARTS` are exactly the members of `CompositeKind`, and the string
      // comparison above is what narrows this one to the matching member (coding standards §5.2).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return kind as CompositeKind;
    }
  }
  throw inputError(InputErrorCode.unknownComposite, `${name} is not a known binding composite.`, {
    context: { composite: name },
    hint: `Known composites are ${Object.keys(COMPOSITE_PARTS).join(", ")}.`,
  });
}

/**
 * What a composite produces before processors run.
 *
 * @param kind - The composite.
 * @returns `true` when the composite yields a two-component value.
 *
 * @public
 */
export function compositeIsVector(kind: CompositeKind): boolean {
  return kind === CompositeKind.vector2D;
}
