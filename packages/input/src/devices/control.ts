/**
 * The control model every device shares (`docs/architecture/08-input.md` §4): a fixed table of
 * named controls, each resolved once to a stable integer index and a slot in the device's
 * `Float32Array`, so that per-frame code never performs a string lookup (coding standards §7).
 */

/**
 * What one control produces: a pressed/released button, a signed scalar, or a two-component
 * vector.
 *
 * @public
 */
export const ControlKind = {
  /** A digital or analog button; the resting value is `0` and the actuated value is `1`. */
  button: "button",
  /** A signed scalar, normally in `[-1, 1]`. Triggers report `[0, 1]`. */
  axis: "axis",
  /** A two-component vector, such as a stick or a pointer position. */
  vector2: "vector2",
} as const;

/**
 * The union of the control kinds.
 *
 * @public
 */
export type ControlKind = (typeof ControlKind)[keyof typeof ControlKind];

/**
 * One control of a device, as the binding layer sees it after path resolution.
 *
 * @public
 */
export interface ControlDescriptor {
  /** The control's name inside its device, for example `leftStick` or `dpad/up`. */
  readonly name: string;
  /** The control's stable index inside its device's control table. */
  readonly index: number;
  /** Where the control's components start in the device's value array. */
  readonly offset: number;
  /** What the control produces. */
  readonly kind: ControlKind;
  /** How many `Float32Array` slots the control occupies: `1`, or `2` for a vector. */
  readonly components: number;
}

/**
 * A control declaration, before offsets are assigned.
 *
 * @public
 */
export interface ControlSpec {
  /** The control's name inside its device. */
  readonly name: string;
  /** What the control produces. */
  readonly kind: ControlKind;
}

/**
 * How many `Float32Array` slots a control of one kind occupies.
 *
 * @param kind - The control kind.
 * @returns `2` for `vector2`, otherwise `1`.
 */
function componentsOf(kind: ControlKind): number {
  return kind === ControlKind.vector2 ? 2 : 1;
}

/**
 * Assigns indices and value-array offsets to a device's control declarations.
 *
 * @param specs - The declarations, in the order they should be indexed.
 * @returns The descriptors, index `i` describing `specs[i]`.
 *
 * @example
 * ```ts
 * const controls = buildControls([
 *   { name: "leftStick", kind: ControlKind.vector2 },
 *   { name: "buttonSouth", kind: ControlKind.button },
 * ]);
 * controls[1].offset; // 2 — the stick took slots 0 and 1
 * ```
 *
 * @public
 */
export function buildControls(specs: readonly ControlSpec[]): readonly ControlDescriptor[] {
  const descriptors: ControlDescriptor[] = [];
  let offset = 0;
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    if (spec === undefined) {
      continue;
    }
    const components = componentsOf(spec.kind);
    descriptors.push({ name: spec.name, index, offset, kind: spec.kind, components });
    offset += components;
  }
  return descriptors;
}

/**
 * How many `Float32Array` slots a control table needs.
 *
 * @param controls - The descriptors from {@link buildControls}.
 * @returns The total slot count.
 *
 * @public
 */
export function controlSlotCount(controls: readonly ControlDescriptor[]): number {
  const last = controls.at(-1);
  return last === undefined ? 0 : last.offset + last.components;
}
