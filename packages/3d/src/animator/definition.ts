import { threeDError, ThreeDErrorCode } from "../errors.js";

/**
 * The `ignifx.animator` document — the `.animator.json` file that declares an animation state
 * machine (`docs/architecture/06-serialization-and-scene-format.md` §6, `12-3d-toolkit.md` §3).
 *
 * The document is pure data. It names clips by the animation-group names a `.glb` declares, never
 * by index, so re-exporting a model with the clips in a different order does not silently change
 * what plays. Everything the state machine needs to run — parameters, layers, states, transitions,
 * and 1D blend trees — is in here, which is what lets `AnimatorStateMachine` be a headless module
 * with no Babylon Lite in sight (`12-3d-toolkit.md` §3, "the state machine must be pure").
 */

/**
 * The `format` discriminator every `.animator.json` document carries.
 *
 * @public
 */
export const ANIMATOR_FORMAT = "ignifx.animator";

/**
 * The document version this build reads and writes.
 *
 * @public
 */
export const ANIMATOR_FORMAT_VERSION = 1;

/**
 * The asset type name the loader registers.
 *
 * @public
 */
export const ANIMATOR_ASSET_TYPE = "animator";

/**
 * The address suffixes that select the animator loader.
 *
 * @public
 */
export const ANIMATOR_FILE_EXTENSIONS: readonly string[] = Object.freeze([".animator.json"]);

/**
 * Every parameter kind a document can declare, in the order an inspector should list them.
 *
 * @public
 */
export const ANIMATOR_PARAMETER_KINDS = ["float", "int", "bool", "trigger"] as const;

/**
 * The union of {@link ANIMATOR_PARAMETER_KINDS}.
 *
 * @public
 */
export type AnimatorParameterKind = (typeof ANIMATOR_PARAMETER_KINDS)[number];

/**
 * Every comparison a transition condition can make.
 *
 * @remarks
 * `trigger` is the odd one out: it has no value, it passes while the named trigger is set, and
 * taking the transition consumes it — which is what makes `setTrigger("jump")` fire exactly once.
 *
 * @public
 */
export const ANIMATOR_CONDITION_OPS = ["gt", "gte", "lt", "lte", "eq", "neq", "trigger"] as const;

/**
 * The union of {@link ANIMATOR_CONDITION_OPS}.
 *
 * @public
 */
export type AnimatorConditionOp = (typeof ANIMATOR_CONDITION_OPS)[number];

/**
 * How a layer's pose combines with the layers under it.
 *
 * @public
 */
export const ANIMATOR_MASK_MODES = ["include", "exclude"] as const;

/**
 * The union of {@link ANIMATOR_MASK_MODES}.
 *
 * @public
 */
export type AnimatorMaskMode = (typeof ANIMATOR_MASK_MODES)[number];

/**
 * The name `from` takes for a transition that can fire from any state on its layer.
 *
 * @public
 */
export const ANY_STATE = "any";

/** The default crossfade a transition that declares none uses, in seconds. */
const DEFAULT_TRANSITION_SECONDS = 0.2;

/** The playback rate a state that declares none uses. */
const DEFAULT_STATE_SPEED = 1;

/** The weight a layer that declares none carries. */
const DEFAULT_LAYER_WEIGHT = 1;

/**
 * One declared parameter.
 *
 * @public
 */
export interface AnimatorParameterDefinition {
  /** The name `setFloat` and a condition's `param` use. */
  readonly name: string;
  /** What kind of value it holds. */
  readonly kind: AnimatorParameterKind;
  /** The value it starts at. Ignored for `trigger`, which always starts clear. */
  readonly value: number;
}

/**
 * An animation event: a name emitted on `Animator.onEvent` when the clip passes a point.
 *
 * @public
 */
export interface AnimatorEventDefinition {
  /** Where in the clip the event sits, as a fraction of the clip's length in `[0, 1]`. */
  readonly time: number;
  /** The name emitted on `Animator.onEvent`. */
  readonly name: string;
}

/**
 * One state of one layer.
 *
 * @public
 */
export interface AnimatorStateDefinition {
  /** The state's name, unique in the document; what `play` and a transition's `to` take. */
  readonly name: string;
  /** The layer the state belongs to; the first layer when the document omits it. */
  readonly layer: string;
  /** The animation-group name this state plays. Empty when `blendTree` names one instead. */
  readonly clip: string;
  /** The 1D blend tree this state plays. Empty when `clip` names a single clip. */
  readonly blendTree: string;
  /** A multiplier on the clip's own rate. Negative values play the state backwards. */
  readonly speed: number;
  /** Whether the state restarts at its end. */
  readonly loop: boolean;
  /** The events fired as the state plays. */
  readonly events: readonly AnimatorEventDefinition[];
}

/**
 * One condition of one transition.
 *
 * @public
 */
export interface AnimatorConditionDefinition {
  /** The parameter to test. */
  readonly param: string;
  /** The comparison. */
  readonly op: AnimatorConditionOp;
  /** What to compare against. Booleans are `1` and `0`; ignored by `trigger`. */
  readonly value: number;
}

/**
 * One transition.
 *
 * @public
 */
export interface AnimatorTransitionDefinition {
  /** The state this leaves, or {@link ANY_STATE}. */
  readonly from: string;
  /** The state this enters. */
  readonly to: string;
  /** Every condition, all of which must pass. An empty list passes. */
  readonly conditions: readonly AnimatorConditionDefinition[];
  /** How long the crossfade takes, in seconds. `0` cuts. */
  readonly duration: number;
  /**
   * The earliest normalized time the source state may be left at, in `[0, 1]`, or `null` for "any
   * time". A looping state's normalized time wraps, so an exit time fires once per loop.
   */
  readonly exitTime: number | null;
  /** Whether the transition may start while another transition is already in flight. */
  readonly interruptible: boolean;
}

/**
 * One layer: an independent state machine whose pose is blended over the layers below it.
 *
 * @public
 */
export interface AnimatorLayerDefinition {
  /** The layer's name; what `play({ layer })` and `currentState(layer)` take. */
  readonly name: string;
  /** How much of this layer's pose reaches the result, in `[0, 1]`. */
  readonly weight: number;
  /** The bone names the layer's mask lists. Empty means "no mask". */
  readonly mask: readonly string[];
  /** Whether `mask` lists the bones that animate or the bones that do not. */
  readonly maskMode: AnimatorMaskMode;
  /** Whether the layer adds to the pose beneath it rather than replacing it. */
  readonly additive: boolean;
  /** The state the layer starts in; the layer's first state when the document omits it. */
  readonly defaultState: string;
}

/**
 * One child of a 1D blend tree.
 *
 * @public
 */
export interface AnimatorBlendChildDefinition {
  /** The animation-group name this child plays. */
  readonly clip: string;
  /** The parameter value at which this child reaches full weight. */
  readonly threshold: number;
}

/**
 * A 1D blend tree: a run of clips laid out along one parameter.
 *
 * @public
 */
export interface AnimatorBlendTreeDefinition {
  /** The tree's name; what a state's `blendTree` takes. */
  readonly name: string;
  /** The parameter the tree reads. */
  readonly param: string;
  /** The children, sorted ascending by threshold. */
  readonly children: readonly AnimatorBlendChildDefinition[];
}

/**
 * The parsed `.animator.json` document.
 *
 * @public
 */
export interface AnimatorDefinition {
  /** Always `"ignifx.animator"`. */
  readonly format: typeof ANIMATOR_FORMAT;
  /** Always `1` in this build. */
  readonly formatVersion: number;
  /** Every parameter, in declaration order. */
  readonly parameters: readonly AnimatorParameterDefinition[];
  /** Every layer, in blend order: the first is the base. */
  readonly layers: readonly AnimatorLayerDefinition[];
  /** Every state, in declaration order. */
  readonly states: readonly AnimatorStateDefinition[];
  /** Every transition, in declaration order — which is also priority order. */
  readonly transitions: readonly AnimatorTransitionDefinition[];
  /** Every 1D blend tree. */
  readonly blendTrees1D: readonly AnimatorBlendTreeDefinition[];
}

/** What a document looks like before {@link defineAnimator} fills in its defaults. */
interface RawParameter {
  readonly name?: unknown;
  readonly kind?: unknown;
  readonly value?: unknown;
  readonly default?: unknown;
}

/** A raw event entry. */
interface RawEvent {
  readonly time?: unknown;
  readonly name?: unknown;
}

/** A raw state entry. */
interface RawState {
  readonly name?: unknown;
  readonly layer?: unknown;
  readonly clip?: unknown;
  readonly blendTree?: unknown;
  readonly speed?: unknown;
  readonly loop?: unknown;
  readonly events?: unknown;
}

/** A raw condition entry. */
interface RawCondition {
  readonly param?: unknown;
  readonly op?: unknown;
  readonly value?: unknown;
}

/** A raw transition entry. */
interface RawTransition {
  readonly from?: unknown;
  readonly to?: unknown;
  readonly conditions?: unknown;
  readonly duration?: unknown;
  readonly exitTime?: unknown;
  readonly interruptible?: unknown;
}

/** A raw layer entry. */
interface RawLayer {
  readonly name?: unknown;
  readonly weight?: unknown;
  readonly mask?: unknown;
  readonly maskMode?: unknown;
  readonly additive?: unknown;
  readonly defaultState?: unknown;
}

/** A raw blend-tree entry. */
interface RawBlendTree {
  readonly name?: unknown;
  readonly param?: unknown;
  readonly children?: unknown;
}

/**
 * What {@link defineAnimator} accepts: the document as authored, with every optional key omitted.
 *
 * @public
 */
export interface AnimatorInput {
  /** Always `"ignifx.animator"` when present. */
  readonly format?: string;
  /** The document version. */
  readonly formatVersion?: number;
  /** The parameters. */
  readonly parameters?: readonly unknown[];
  /** The layers; a document that declares none gets one base layer. */
  readonly layers?: readonly unknown[];
  /** The states. */
  readonly states?: readonly unknown[];
  /** The transitions. */
  readonly transitions?: readonly unknown[];
  /** The 1D blend trees. */
  readonly blendTrees1D?: readonly unknown[];
}

/**
 * Builds the failure an invalid document produces.
 *
 * @param address - What to name in the message.
 * @param reason - The specific problem, as a sentence fragment.
 * @returns The error to throw.
 */
function invalid(address: string, reason: string): Error {
  return threeDError(
    ThreeDErrorCode.invalidAnimatorFile,
    `${address} is not a valid ignifx.animator document: ${reason}.`,
    {
      context: { file: address, reason },
      hint: "See skills/ignifx/references/formats/ignifx-animator.md for the document shape.",
    },
  );
}

/**
 * Reads a required non-empty string.
 *
 * @param value - The raw value.
 * @param address - The document address, for the error.
 * @param what - What the field is, for the error.
 * @returns The string.
 */
function requireName(value: unknown, address: string, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(address, `${what} must be a non-empty string`);
  }
  return value;
}

/**
 * Reads an optional string, defaulting when absent.
 *
 * @param value - The raw value.
 * @param fallback - What to use when the key is absent.
 * @returns The string.
 */
function optionalString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Reads an optional finite number, defaulting when absent or unusable.
 *
 * @param value - The raw value.
 * @param fallback - What to use when the key is absent.
 * @returns The number.
 */
function optionalNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Reads an optional boolean.
 *
 * @param value - The raw value.
 * @param fallback - What to use when the key is absent.
 * @returns The boolean.
 */
function optionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Reads a raw array, treating an absent key as empty.
 *
 * @param value - The raw value.
 * @param address - The document address, for the error.
 * @param what - What the field is, for the error.
 * @returns The entries.
 */
function readArray(value: unknown, address: string, what: string): readonly unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalid(address, `${what} must be an array`);
  }
  return value as readonly unknown[];
}

/**
 * Narrows a raw entry to an object.
 *
 * @param value - The raw entry.
 * @param address - The document address, for the error.
 * @param what - What the entry is, for the error.
 * @returns The entry.
 */
function readObject(value: unknown, address: string, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalid(address, `each ${what} must be an object`);
  }
  return value;
}

/**
 * Whether a JSON value is an object rather than an array, a primitive, or absent.
 *
 * @param value - The value read out of the document.
 * @returns `true` when the value can be read as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a string is one of the declared parameter kinds.
 *
 * @param value - The string read out of the document.
 * @returns `true` when the kind is declared.
 */
function isParameterKind(value: string): value is AnimatorParameterKind {
  const names: readonly string[] = ANIMATOR_PARAMETER_KINDS;
  return names.includes(value);
}

/**
 * Whether a string is one of the declared mask modes.
 *
 * @param value - The string read out of the document.
 * @returns `true` when the mode is declared.
 */
function isMaskMode(value: string): value is AnimatorMaskMode {
  const names: readonly string[] = ANIMATOR_MASK_MODES;
  return names.includes(value);
}

/**
 * Whether a string is one of the declared condition operators.
 *
 * @param value - The string read out of the document.
 * @returns `true` when the operator is declared.
 */
function isConditionOp(value: string): value is AnimatorConditionOp {
  const names: readonly string[] = ANIMATOR_CONDITION_OPS;
  return names.includes(value);
}

/**
 * Reads the parameters section.
 *
 * @param raw - The raw entries.
 * @param address - The document address, for errors.
 * @returns The parameters.
 */
function readParameters(raw: readonly unknown[], address: string): readonly AnimatorParameterDefinition[] {
  const out: AnimatorParameterDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const record = readObject(entry, address, "parameter") as RawParameter;
    const name = requireName(record.name, address, "a parameter name");
    if (seen.has(name)) {
      throw invalid(address, `the parameter ${name} is declared twice`);
    }
    seen.add(name);
    const kind = optionalString(record.kind, "float");
    if (!isParameterKind(kind)) {
      throw invalid(address, `${name} declares the parameter kind ${kind}`);
    }
    const declared = record.value ?? record.default;
    const value = typeof declared === "boolean" ? (declared ? 1 : 0) : optionalNumber(declared, 0);
    out.push({ name, kind, value: kind === "trigger" ? 0 : value });
  }
  return Object.freeze(out);
}

/**
 * Reads the layers section, synthesising a base layer when the document declares none.
 *
 * @param raw - The raw entries.
 * @param address - The document address, for errors.
 * @returns The layers.
 */
function readLayers(raw: readonly unknown[], address: string): readonly AnimatorLayerDefinition[] {
  if (raw.length === 0) {
    return Object.freeze([
      { name: "Base", weight: 1, mask: Object.freeze([]), maskMode: "include", additive: false, defaultState: "" },
    ] satisfies AnimatorLayerDefinition[]);
  }
  const out: AnimatorLayerDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const record = readObject(entry, address, "layer") as RawLayer;
    const name = requireName(record.name, address, "a layer name");
    if (seen.has(name)) {
      throw invalid(address, `the layer ${name} is declared twice`);
    }
    seen.add(name);
    const maskMode = optionalString(record.maskMode, "include");
    if (!isMaskMode(maskMode)) {
      throw invalid(address, `the layer ${name} declares the mask mode ${maskMode}`);
    }
    const mask = readArray(record.mask, address, `the mask of layer ${name}`).map((bone, index) =>
      requireName(bone, address, `bone ${String(index)} of the mask of layer ${name}`),
    );
    out.push({
      name,
      weight: optionalNumber(record.weight, DEFAULT_LAYER_WEIGHT),
      mask: Object.freeze(mask),
      maskMode,
      additive: optionalBoolean(record.additive, false),
      defaultState: optionalString(record.defaultState, ""),
    });
  }
  return Object.freeze(out);
}

/**
 * Reads the events of one state.
 *
 * @param raw - The raw entries.
 * @param address - The document address, for errors.
 * @param state - The owning state's name, for errors.
 * @returns The events, sorted by time.
 */
function readEvents(raw: readonly unknown[], address: string, state: string): readonly AnimatorEventDefinition[] {
  const out: AnimatorEventDefinition[] = [];
  for (const entry of raw) {
    const record = readObject(entry, address, `event of state ${state}`) as RawEvent;
    const time = optionalNumber(record.time, 0);
    if (time < 0 || time > 1) {
      throw invalid(address, `an event of ${state} sits at normalized time ${String(time)}, outside [0, 1]`);
    }
    out.push({ time, name: requireName(record.name, address, `an event name of state ${state}`) });
  }
  out.sort((a, b) => a.time - b.time);
  return Object.freeze(out);
}

/**
 * Reads the states section.
 *
 * @param raw - The raw entries.
 * @param address - The document address, for errors.
 * @param layers - The layers already read, so a state can default to the first.
 * @returns The states.
 */
function readStates(
  raw: readonly unknown[],
  address: string,
  layers: readonly AnimatorLayerDefinition[],
): readonly AnimatorStateDefinition[] {
  const baseLayer = layers[0]?.name ?? "Base";
  const known = new Set(layers.map((layer) => layer.name));
  const out: AnimatorStateDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const record = readObject(entry, address, "state") as RawState;
    const name = requireName(record.name, address, "a state name");
    if (seen.has(name)) {
      throw invalid(address, `the state ${name} is declared twice`);
    }
    seen.add(name);
    const layer = optionalString(record.layer, baseLayer);
    if (!known.has(layer)) {
      throw invalid(address, `the state ${name} names the layer ${layer}, which is not declared`);
    }
    const clip = optionalString(record.clip, "");
    const blendTree = optionalString(record.blendTree, "");
    if (clip === "" && blendTree === "") {
      throw invalid(address, `the state ${name} names neither a clip nor a blendTree`);
    }
    if (clip !== "" && blendTree !== "") {
      throw invalid(address, `the state ${name} names both a clip and a blendTree`);
    }
    out.push({
      name,
      layer,
      clip,
      blendTree,
      speed: optionalNumber(record.speed, DEFAULT_STATE_SPEED),
      loop: optionalBoolean(record.loop, true),
      events: readEvents(readArray(record.events, address, `the events of state ${name}`), address, name),
    });
  }
  return Object.freeze(out);
}

/**
 * Reads the transitions section.
 *
 * @param raw - The raw entries.
 * @param address - The document address, for errors.
 * @param states - The states already read, so `from`/`to` can be checked.
 * @returns The transitions.
 */
function readTransitions(
  raw: readonly unknown[],
  address: string,
  states: readonly AnimatorStateDefinition[],
): readonly AnimatorTransitionDefinition[] {
  const known = new Set(states.map((state) => state.name));
  const out: AnimatorTransitionDefinition[] = [];
  for (const entry of raw) {
    const record = readObject(entry, address, "transition") as RawTransition;
    const from = requireName(record.from, address, "a transition's from");
    const to = requireName(record.to, address, "a transition's to");
    if (from !== ANY_STATE && !known.has(from)) {
      throw invalid(address, `a transition leaves ${from}, which is not a declared state`);
    }
    if (!known.has(to)) {
      throw invalid(address, `a transition enters ${to}, which is not a declared state`);
    }
    const conditions: AnimatorConditionDefinition[] = [];
    for (const rawCondition of readArray(record.conditions, address, `the conditions of ${from} -> ${to}`)) {
      const condition = readObject(rawCondition, address, "condition") as RawCondition;
      const op = optionalString(condition.op, "eq");
      if (!isConditionOp(op)) {
        throw invalid(address, `a condition of ${from} -> ${to} declares the operator ${op}`);
      }
      const value = condition.value;
      conditions.push({
        param: requireName(condition.param, address, `a condition parameter of ${from} -> ${to}`),
        op,
        value: typeof value === "boolean" ? (value ? 1 : 0) : optionalNumber(value, 0),
      });
    }
    const exitTime = record.exitTime;
    out.push({
      from,
      to,
      conditions: Object.freeze(conditions),
      duration: Math.max(0, optionalNumber(record.duration, DEFAULT_TRANSITION_SECONDS)),
      exitTime: typeof exitTime === "number" && Number.isFinite(exitTime) ? exitTime : null,
      interruptible: optionalBoolean(record.interruptible, false),
    });
  }
  return Object.freeze(out);
}

/**
 * Reads the blend-tree section.
 *
 * @param raw - The raw entries.
 * @param address - The document address, for errors.
 * @returns The trees, each with its children sorted ascending by threshold.
 */
function readBlendTrees(raw: readonly unknown[], address: string): readonly AnimatorBlendTreeDefinition[] {
  const out: AnimatorBlendTreeDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const record = readObject(entry, address, "blend tree") as RawBlendTree;
    const name = requireName(record.name, address, "a blend tree name");
    if (seen.has(name)) {
      throw invalid(address, `the blend tree ${name} is declared twice`);
    }
    seen.add(name);
    const children: AnimatorBlendChildDefinition[] = [];
    for (const rawChild of readArray(record.children, address, `the children of blend tree ${name}`)) {
      const child = readObject(rawChild, address, `child of blend tree ${name}`);
      children.push({
        clip: requireName(child["clip"], address, `a clip of blend tree ${name}`),
        threshold: optionalNumber(child["threshold"], 0),
      });
    }
    if (children.length === 0) {
      throw invalid(address, `the blend tree ${name} has no children`);
    }
    children.sort((a, b) => a.threshold - b.threshold);
    out.push({
      name,
      param: requireName(record.param, address, `the parameter of blend tree ${name}`),
      children: Object.freeze(children),
    });
  }
  return Object.freeze(out);
}

/**
 * Fills in the defaults of an animator document and checks every invariant the state machine
 * relies on: unique names, resolvable layers, states that name exactly one source of clips,
 * transitions between declared states, and conditions on declared parameters.
 *
 * @param input - The document, as authored.
 * @param address - What to name in an error; defaults to `"<inline>"`.
 * @returns The complete document.
 * @throws IgnifxError with code `IGX-1201` when the document is not readable.
 *
 * @example
 * ```ts
 * const definition = defineAnimator(JSON.parse(text) as AnimatorInput, "3d/hero.animator.json");
 * ```
 *
 * @public
 */
export function defineAnimator(input: AnimatorInput, address: string = "<inline>"): AnimatorDefinition {
  if (input.format !== undefined && input.format !== ANIMATOR_FORMAT) {
    throw invalid(address, `format is ${input.format}, not ${ANIMATOR_FORMAT}`);
  }
  const version = input.formatVersion ?? ANIMATOR_FORMAT_VERSION;
  if (version !== ANIMATOR_FORMAT_VERSION) {
    throw invalid(
      address,
      `formatVersion is ${String(version)}, and this build reads ${String(ANIMATOR_FORMAT_VERSION)}`,
    );
  }
  const parameters = readParameters(readArray(input.parameters, address, "parameters"), address);
  const layers = readLayers(readArray(input.layers, address, "layers"), address);
  const states = readStates(readArray(input.states, address, "states"), address, layers);
  if (states.length === 0) {
    throw invalid(address, "a document declares at least one state");
  }
  const transitions = readTransitions(readArray(input.transitions, address, "transitions"), address, states);
  const blendTrees1D = readBlendTrees(readArray(input.blendTrees1D, address, "blendTrees1D"), address);
  checkReferences(address, parameters, layers, states, transitions, blendTrees1D);
  return Object.freeze({
    format: ANIMATOR_FORMAT,
    formatVersion: ANIMATOR_FORMAT_VERSION,
    parameters,
    layers,
    states,
    transitions,
    blendTrees1D,
  });
}

/**
 * Checks the cross-section references the individual readers cannot see.
 *
 * @param address - The document address, for errors.
 * @param parameters - The parameters.
 * @param layers - The layers.
 * @param states - The states.
 * @param transitions - The transitions.
 * @param trees - The blend trees.
 */
function checkReferences(
  address: string,
  parameters: readonly AnimatorParameterDefinition[],
  layers: readonly AnimatorLayerDefinition[],
  states: readonly AnimatorStateDefinition[],
  transitions: readonly AnimatorTransitionDefinition[],
  trees: readonly AnimatorBlendTreeDefinition[],
): void {
  const parameterNames = new Set(parameters.map((parameter) => parameter.name));
  const treeNames = new Set(trees.map((tree) => tree.name));
  const stateNames = new Map(states.map((state) => [state.name, state]));
  for (const state of states) {
    if (state.blendTree !== "" && !treeNames.has(state.blendTree)) {
      throw invalid(address, `the state ${state.name} names the blend tree ${state.blendTree}, which is not declared`);
    }
  }
  for (const tree of trees) {
    if (!parameterNames.has(tree.param)) {
      throw invalid(address, `the blend tree ${tree.name} reads ${tree.param}, which is not a declared parameter`);
    }
  }
  for (const transition of transitions) {
    for (const condition of transition.conditions) {
      if (!parameterNames.has(condition.param)) {
        throw invalid(address, `a condition reads ${condition.param}, which is not a declared parameter`);
      }
    }
    const source = stateNames.get(transition.from);
    const target = stateNames.get(transition.to);
    if (source !== undefined && target !== undefined && source.layer !== target.layer) {
      throw invalid(address, `the transition ${transition.from} -> ${transition.to} crosses layers`);
    }
  }
  for (const layer of layers) {
    if (layer.defaultState !== "" && stateNames.get(layer.defaultState)?.layer !== layer.name) {
      throw invalid(
        address,
        `the layer ${layer.name} defaults to ${layer.defaultState}, which is not one of its states`,
      );
    }
    if (layer.defaultState === "" && !states.some((state) => state.layer === layer.name)) {
      throw invalid(address, `the layer ${layer.name} has no states`);
    }
  }
}

/**
 * The state a layer starts in.
 *
 * @param definition - The document.
 * @param layer - The layer.
 * @returns The state's name.
 *
 * @public
 */
export function defaultStateOf(definition: AnimatorDefinition, layer: AnimatorLayerDefinition): string {
  if (layer.defaultState !== "") {
    return layer.defaultState;
  }
  return definition.states.find((state) => state.layer === layer.name)?.name ?? "";
}
