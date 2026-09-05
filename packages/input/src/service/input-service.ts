import { Phase, Signal } from "@ignifx/core";
import { ActionMap } from "../actions/action-map.js";
import { InputActionsView } from "../actions/actions-view.js";
import { pinToDeviceSlot } from "../actions/device-slot.js";
import { ControlSchemes } from "../actions/schemes.js";
import { InputActionsAsset } from "../asset/input-actions-asset.js";
import { ControlKind } from "../devices/control.js";
import { DeviceKind } from "../devices/device.js";
import { InputDevices } from "../devices/devices.js";
import { GamepadDevice } from "../devices/gamepad.js";
import { Cursor } from "../dom/cursor.js";
import { DomBridge } from "../dom/dom-bridge.js";
import { asDomCanvas } from "../dom/dom-target.js";
import { InputEventQueue } from "../dom/event-queue.js";
import { createNavigatorGamepadReader, GamepadPoller } from "../dom/gamepad-source.js";
import { PointerLock } from "../dom/pointer-lock.js";
import { inputError, InputErrorCode } from "../errors.js";
import { applyOverrides, clearOverrides, collectOverrides } from "../rebinding/overrides.js";
import { RebindOperation } from "../rebinding/rebind.js";
import { DeviceWriter } from "./device-writer.js";
import type { InputAction } from "../actions/action.js";
import type { ControlSchemeDefinition, InputActionsDefinition } from "../asset/definition.js";
import type { BindingContext, BindingResolver } from "../bindings/binding.js";
import type { ControlDescriptor } from "../devices/control.js";
import type { InputDevice } from "../devices/device.js";
import type { ControlRef } from "../devices/devices.js";
import type { InputEventRecord, MutableInputEvent, InputEventType } from "../dom/event-queue.js";
import type { GamepadReader } from "../dom/gamepad-source.js";
import type { InputOverridesJson } from "../rebinding/overrides.js";
import type { InteractiveRebindOptions, InteractiveRebindResult } from "../rebinding/rebind.js";
import type { InputSettings } from "../settings.js";
import type { App, AssetHandle, DiagnosticsGroup, SignalLike, Vec2Like } from "@ignifx/core";

/**
 * The input service, reached as `app.input` (`docs/architecture/08-input.md` §1). It owns the
 * devices, the queued event stream, the installed action maps, the control schemes, pointer lock,
 * the cursor, and the once-per-frame resolution that makes every read in a frame agree.
 *
 * ## Where the frame's work happens
 *
 * {@link InputService.resolveFrame} is called by the `PreUpdate` system at order `-950`, before the
 * asset delivery system at `-900` (`01-lifecycle-and-time.md` §3 step 2). It resets the per-frame
 * deltas, polls gamepads, drains the queue in arrival order, resolves actions, advances an
 * interactive rebind, and publishes diagnostics. Nothing else in the frame writes device or action
 * state, which is what makes `wasPressedThisFrame` stable across every fixed step.
 *
 * ## The order actions resolve in
 *
 * Applying a queued event marks the actions bound to the control it changed, in the order the
 * events arrived; those actions resolve — and emit — first, in that order. Everything else resolves
 * afterwards in map and then declaration order, so an action whose value did not change emits
 * nothing and the frame is fully deterministic (`08-input.md` §1).
 */

/**
 * The counters the `input` diagnostics group publishes, in index order.
 *
 * @public
 */
export const INPUT_DIAGNOSTICS_COUNTERS: readonly string[] = Object.freeze([
  "eventsThisFrame",
  "gamepadsConnected",
  "activeScheme",
  "pointerLocked",
]);

/**
 * The diagnostics group name (`docs/architecture/08-input.md` §9).
 *
 * @public
 */
export const INPUT_DIAGNOSTICS_GROUP = "input";

/** The magnitude a gamepad control must reach to count as "the player used the pad". */
const SCHEME_ACTUATION_THRESHOLD = 0.5;

/**
 * What {@link InputService} is constructed with.
 *
 * @public
 */
export interface InputServiceOptions {
  /** The app the service belongs to. */
  readonly app: App;
  /** The resolved `input` settings section. */
  readonly settings: InputSettings;
  /** The gamepad reader; defaults to `navigator.getGamepads()` when the host has it. */
  readonly gamepadReader?: GamepadReader | null;
}

/**
 * What a value passed to {@link InputService.simulate} may be.
 *
 * @public
 */
export type SimulatedValue = number | boolean | Vec2Like;

/**
 * What {@link InputService.simulateEvent} accepts: an event record with everything but `type`
 * optional.
 *
 * @public
 */
export interface SimulatedEvent {
  /** Which kind of event to queue. */
  readonly type: InputEventType;
  /** The control name a key event names, for example `w` — not the raw `KeyboardEvent.code`. */
  readonly code?: string;
  /** The layout-dependent key, or the composed text of a `textinput` event. */
  readonly key?: string;
  /** Whether a key event is an auto-repeat. */
  readonly repeat?: boolean;
  /** The pointer x, in CSS pixels from the canvas's left edge. */
  readonly x?: number;
  /** The pointer y, in CSS pixels from the canvas's top edge. */
  readonly y?: number;
  /** The pointer movement x, or the wheel's horizontal delta. */
  readonly deltaX?: number;
  /** The pointer movement y, or the wheel's vertical delta. */
  readonly deltaY?: number;
  /** The `PointerEvent.button` index. */
  readonly button?: number;
  /** The `PointerEvent.pointerId`. */
  readonly pointerId?: number;
  /** The `PointerEvent.pointerType`: `mouse`, `pen`, or `touch`. Defaults to `mouse`. */
  readonly pointerType?: string;
}

/**
 * How a private action set differs from the document it is built from.
 *
 * @public
 */
export interface ActionSetOptions {
  /** The gamepad slot every `<Gamepad>/…` path is pinned to. Defaults to `0`. */
  readonly deviceSlot?: number;
  /** The control scheme to keep; `""` keeps every binding whatever its tag. */
  readonly scheme?: string;
}

/**
 * The input service (`docs/architecture/08-input.md` §1).
 *
 * @example
 * ```ts
 * const app = await createApp({ headless: true, extensions: [input()] });
 * app.input.loadActions(
 *   defineInputActions({
 *     maps: [{ name: "Player", actions: [{ name: "jump", bindings: [{ path: "<Keyboard>/space" }] }] }],
 *   }),
 * );
 * app.input.simulate({ "<Keyboard>/space": 1 });
 * app.step(1 / 60);
 * app.input.actions.get("jump").wasPressedThisFrame; // true
 * ```
 *
 * @public
 */
export class InputService implements BindingResolver {
  /** Every input device this app has. */
  readonly devices: InputDevices;

  /** Pointer lock (`docs/architecture/08-input.md` §4). */
  readonly pointerLock: PointerLock;

  /** Cursor visibility over the canvas. */
  readonly cursor: Cursor;

  /** The magnitude at which an analog value counts as pressed. Defaults to the `input` setting. */
  pressPoint: number;

  /**
   * Whether a binding tagged with a control scheme resolves only while that scheme is active.
   * Defaults to the `input.strictSchemes` setting.
   */
  strictSchemes: boolean;

  readonly #app: App;

  readonly #settings: InputSettings;

  readonly #maps = new Map<string, ActionMap>();

  readonly #view: InputActionsView;

  readonly #schemes = new ControlSchemes();

  readonly #queue = new InputEventQueue();

  readonly #writer: DeviceWriter;

  readonly #poller = new GamepadPoller();

  readonly #sets = new Set<InputActionSet>();

  readonly #actions: InputAction[] = [];

  readonly #dirty: boolean[] = [];

  readonly #pending: number[] = [];

  readonly #schemeChanged = new Signal<string>();

  readonly #deviceConnected = new Signal<InputDevice>();

  readonly #deviceDisconnected = new Signal<InputDevice>();

  readonly #padActuated: boolean[] = [];

  readonly #context: { uiHasFocus: boolean; strictSchemes: boolean; currentScheme: string } = {
    uiHasFocus: false,
    strictSchemes: false,
    currentScheme: "",
  };

  #counters: DiagnosticsGroup | null = null;

  #bridge: DomBridge | null = null;

  #uiHasFocus = false;

  #currentScheme = "";

  #subscriptionsDirty = true;

  #rebind: RebindOperation | null = null;

  #rebindResolve: ((result: InteractiveRebindResult) => void) | null = null;

  #actionsHandle: AssetHandle<InputActionsAsset> | null = null;

  #isDisposed = false;

  /**
   * Builds the service. The extension constructs exactly one per app.
   *
   * @param options - The app, the resolved settings, and an optional gamepad reader.
   */
  constructor(options: InputServiceOptions) {
    this.#app = options.app;
    this.#settings = options.settings;
    this.pressPoint = options.settings.pressPoint;
    this.strictSchemes = options.settings.strictSchemes;
    this.devices = new InputDevices();
    this.#writer = new DeviceWriter(this.devices);
    this.#view = new InputActionsView(this.#maps);
    this.pointerLock = new PointerLock();
    this.cursor = new Cursor();
    this.#currentScheme = options.settings.defaultScheme;
    const reader = options.gamepadReader === undefined ? createNavigatorGamepadReader() : options.gamepadReader;
    this.#poller.setReader(reader);
    for (let slot = 0; slot < this.devices.gamepads.length; slot += 1) {
      this.#padActuated.push(false);
    }
    this.devices.setTouchHandler((actions: readonly number[]): void => {
      this.#markDirty(actions);
    });
  }

  /**
   * The installed action maps and the two lookups over them.
   *
   * @returns The action lookup.
   */
  get actions(): InputActionsView {
    return this.#view;
  }

  /**
   * The gamepad slots, connected or not.
   *
   * @returns The four slots, in slot order.
   */
  get gamepads(): readonly GamepadDevice[] {
    return this.devices.gamepads;
  }

  /**
   * The control schemes the loaded document declared.
   *
   * @returns The schemes, in document order.
   */
  get controlSchemes(): readonly ControlSchemeDefinition[] {
    return this.#schemes.all;
  }

  /**
   * The current frame's raw events, in arrival order
   * (`docs/architecture/08-input.md` §5). The array and its records are reused each frame.
   *
   * @returns The frame's event list.
   */
  get events(): readonly InputEventRecord[] {
    return this.#queue.events;
  }

  /**
   * The control scheme in use, chosen by the device that produced input last.
   *
   * @returns The scheme name, or `""` before any input arrives.
   */
  get currentScheme(): string {
    return this.#currentScheme;
  }

  /**
   * Emitted with the new scheme name whenever the active control scheme changes.
   *
   * @returns The signal.
   */
  get onControlSchemeChanged(): SignalLike<string> {
    return this.#schemeChanged;
  }

  /**
   * Emitted when a gamepad appears in a slot.
   *
   * @returns The signal.
   */
  get onDeviceConnected(): SignalLike<InputDevice> {
    return this.#deviceConnected;
  }

  /**
   * Emitted when a gamepad leaves a slot.
   *
   * @returns The signal.
   */
  get onDeviceDisconnected(): SignalLike<InputDevice> {
    return this.#deviceDisconnected;
  }

  /**
   * Whether a DOM text field has focus (`docs/architecture/08-input.md` §5). While it is `true`,
   * keyboard actions read as released and keyboard events are still published on
   * {@link InputService.events}; pointer actions keep working.
   *
   * @returns `true` while the UI owns the keyboard. `@ignifx/ui` assigns it.
   */
  get uiHasFocus(): boolean {
    return this.#uiHasFocus;
  }

  // A second TSDoc block on the setter is API Extractor's `ae-setter-with-docs` warning, which
  // fails the non-local `api-report` run; the accessor pair is documented on the getter above.
  // eslint-disable-next-line jsdoc/require-jsdoc -- see the note above.
  set uiHasFocus(value: boolean) {
    this.#uiHasFocus = value;
  }

  /**
   * The handle of the `.input.json` document the `input.actions` setting named, or `null` when the
   * project named none.
   *
   * @remarks
   * The extension starts the load in `onStart` and installs the maps at delivery, which is the
   * `PreUpdate` of the first stepped frame. Awaiting the handle inside `onStart` would deadlock: a
   * headless app has not been stepped yet and a canvas app has not started its loop
   * (`05-assets-and-loading.md` §4). Game code that must wait awaits this handle's `promise`.
   *
   * @returns The handle, or `null`.
   */
  get actionsHandle(): AssetHandle<InputActionsAsset> | null {
    return this.#actionsHandle;
  }

  /**
   * Resolves a binding path to a device control, creating a `<Virtual>` control on demand.
   *
   * @param path - The binding path.
   * @param kind - The kind a new `<Virtual>` control is created with.
   * @returns The resolved control.
   * @throws IgnifxError with code `IGX-0803` when the path does not resolve.
   */
  resolveControl(path: string, kind?: ControlKind): ControlRef {
    return this.devices.resolve(path, kind);
  }

  /** Marks the control-to-actions index stale, so the next frame rebuilds it. */
  invalidateBindings(): void {
    this.#subscriptionsDirty = true;
  }

  /**
   * Installs the maps and control schemes of a document, merging by map name: a map whose name is
   * already installed is replaced, and every other installed map is kept
   * (`docs/architecture/08-input.md` §3).
   *
   * @param source - A loaded asset, its handle, or a definition built by `defineInputActions`.
   * @throws IgnifxError with code `IGX-0802`, `IGX-0803`, `IGX-0806`, or `IGX-0810` when a binding
   * or a name in the document cannot be used.
   */
  loadActions(source: InputActionsAsset | InputActionsDefinition | AssetHandle<InputActionsAsset>): void {
    const definition = toDefinition(source);
    const report = (error: unknown): void => {
      this.#reportHandlerError(error);
    };
    for (const map of definition.maps) {
      this.#maps.set(map.name, new ActionMap(map, this, report));
    }
    if (definition.controlSchemes.length > 0) {
      this.#schemes.install(definition.controlSchemes);
    }
    if (this.#currentScheme === "" || !this.#schemes.has(this.#currentScheme)) {
      this.#currentScheme =
        this.#settings.defaultScheme !== "" && this.#schemes.has(this.#settings.defaultScheme)
          ? this.#settings.defaultScheme
          : (this.#schemes.all[0]?.name ?? "");
    }
    this.#rebuildActions();
  }

  /**
   * Builds a private copy of a document's maps, bound to one gamepad slot
   * (`docs/architecture/08-input.md` §7). `PlayerInput` uses it so that two players can hold the
   * same action names without sharing state; the copy resolves in the same `PreUpdate` pass as
   * `app.input.actions`.
   *
   * @param source - A loaded asset, its handle, or a definition built by `defineInputActions`.
   * @param options - The gamepad slot to pin to and the control scheme to keep.
   * @returns The private set. Dispose it when the owner goes away.
   *
   * @example
   * ```ts
   * const set = app.input.createActionSet(asset, { deviceSlot: 1, scheme: "Gamepad" });
   * set.actions.get("move").vector.x;
   * ```
   */
  createActionSet(
    source: InputActionsAsset | InputActionsDefinition | AssetHandle<InputActionsAsset>,
    options?: ActionSetOptions,
  ): InputActionSet {
    const definition = pinToDeviceSlot(toDefinition(source), options?.deviceSlot ?? 0, options?.scheme ?? "");
    const report = (error: unknown): void => {
      this.#reportHandlerError(error);
    };
    const maps = new Map<string, ActionMap>();
    for (const map of definition.maps) {
      maps.set(map.name, new ActionMap(map, this, report));
    }
    const set = new InputActionSet(maps, (): void => {
      this.#releaseActionSet(set);
    });
    this.#sets.add(set);
    this.#rebuildActions();
    return set;
  }

  /**
   * Forgets a private action set.
   *
   * @param set - The set being disposed.
   */
  #releaseActionSet(set: InputActionSet): void {
    if (this.#sets.delete(set)) {
      this.#rebuildActions();
    }
  }

  /**
   * Removes every installed map and control scheme.
   */
  clearActions(): void {
    this.#maps.clear();
    this.#schemes.install([]);
    this.#rebuildActions();
  }

  /**
   * Queues synthetic control values, resolved by the same pipeline as real input
   * (`docs/architecture/08-input.md` §8). This is how headless tests drive the engine.
   *
   * @param values - Binding paths to the value each control takes, held until changed again.
   * @throws IgnifxError with code `IGX-0803` when a path does not resolve.
   *
   * @example
   * ```ts
   * app.input.simulate({ "<Keyboard>/w": 1, "<Gamepad>/leftStick": { x: 0.5, y: 0 } });
   * ```
   */
  simulate(values: Readonly<Record<string, SimulatedValue>>): void {
    for (const path of Object.keys(values)) {
      const value = values[path];
      if (value === undefined) {
        continue;
      }
      const isVector = typeof value === "object";
      const ref = this.devices.resolve(path, isVector ? ControlKind.vector2 : ControlKind.axis);
      if (ref.device instanceof GamepadDevice && !ref.device.isConnected) {
        ref.device.setConnected(true);
        this.#deviceConnected.emit(ref.device);
      }
      const entry = this.#queue.push("control");
      entry.device = ref.device;
      entry.controlIndex = ref.control.index;
      if (isVector) {
        entry.valueX = value.x;
        entry.valueY = value.y;
      } else {
        entry.valueX = typeof value === "boolean" ? (value ? 1 : 0) : value;
        entry.valueY = 0;
      }
    }
  }

  /**
   * Queues a release of every control, which is what `blur` and `visibilitychange` do
   * (`docs/architecture/08-input.md` §4). A game that opens a modal outside the canvas can call it
   * so a key held at that moment does not stay stuck.
   *
   * @example
   * ```ts
   * app.input.releaseAll();
   * ```
   */
  releaseAll(): void {
    this.#queue.push("releaseAll");
  }

  /**
   * Queues one synthetic raw event, as if the DOM had delivered it.
   *
   * @param event - The event to queue; `code` names a control, not a `KeyboardEvent.code`.
   *
   * @example
   * ```ts
   * app.input.simulateEvent({ type: "pointerdown", x: 10, y: 20, button: 0 });
   * ```
   */
  simulateEvent(event: SimulatedEvent): void {
    const entry = this.#queue.push(event.type);
    entry.code = event.code ?? "";
    entry.key = event.key ?? "";
    entry.repeat = event.repeat ?? false;
    entry.x = event.x ?? 0;
    entry.y = event.y ?? 0;
    entry.deltaX = event.deltaX ?? 0;
    entry.deltaY = event.deltaY ?? 0;
    entry.button = event.button ?? 0;
    entry.pointerId = event.pointerId ?? 1;
    entry.pointerType = event.pointerType ?? "mouse";
  }

  /**
   * Listens for the next control the player actuates and writes its path into one of an action's
   * bindings as an override (`docs/architecture/08-input.md` §6).
   *
   * @param action - The action to rebind.
   * @param options - Binding index, exclusions, cancel path, timeout, and threshold.
   * @returns What the player chose, or a cancelled or timed-out result. The promise settles from the
   * `PreUpdate` resolution, the same delivery point an asset handle settles at.
   * @throws IgnifxError with code `IGX-0807` when a rebind is already listening.
   *
   * @example
   * ```ts
   * const result = await app.input.performInteractiveRebind(app.input.actions.get("jump"), {
   *   cancelPath: "<Keyboard>/escape",
   *   timeoutSeconds: 5,
   * });
   * ```
   */
  performInteractiveRebind(action: InputAction, options?: InteractiveRebindOptions): Promise<InteractiveRebindResult> {
    if (this.#rebind !== null) {
      return Promise.reject(
        inputError(
          InputErrorCode.rebindInProgress,
          `An interactive rebind of ${this.#rebind.action.name} is already listening.`,
          {
            context: { action: this.#rebind.action.name },
            hint: "Await or cancel the rebind in flight before starting another.",
          },
        ),
      );
    }
    this.#rebind = new RebindOperation(action, options ?? {});
    return new Promise<InteractiveRebindResult>((resolve) => {
      this.#rebindResolve = resolve;
    });
  }

  /** Cancels the interactive rebind in flight, if there is one. */
  cancelInteractiveRebind(): void {
    const rebind = this.#rebind;
    if (rebind === null) {
      return;
    }
    this.#finishRebind(rebind.cancel());
  }

  /**
   * Collects every binding override currently applied.
   *
   * @returns The document to persist.
   */
  saveOverrides(): InputOverridesJson {
    return collectOverrides(this.#maps);
  }

  /**
   * Applies a saved override document, clearing whatever was applied before.
   *
   * @param json - The document from {@link InputService.saveOverrides}.
   * @throws IgnifxError with code `IGX-0808` when the document cannot be applied.
   */
  loadOverrides(json: InputOverridesJson): void {
    applyOverrides(this.#maps, json);
  }

  /** Returns every binding to its declared path. */
  clearOverrides(): void {
    clearOverrides(this.#maps);
  }

  /**
   * Resolves this frame's input. Called by the `PreUpdate` system; game code never calls it.
   *
   * @param unscaledDeltaTime - Seconds since the previous frame, unaffected by `timeScale`.
   *
   * @internal
   */
  resolveFrame(unscaledDeltaTime: number): void {
    if (this.#isDisposed) {
      return;
    }
    this.#pending.length = 0;
    this.#dirty.fill(false);
    this.#writer.beginFrame();
    if (this.#settings.gamepadPolling && this.#poller.isEnabled) {
      this.#pollGamepads();
    }
    const drained = this.#queue.drain((entry: MutableInputEvent): void => {
      this.#writer.apply(entry);
      this.#attributeScheme(entry);
    });
    this.#context.uiHasFocus = this.#uiHasFocus;
    this.#context.strictSchemes = this.strictSchemes;
    this.#context.currentScheme = this.#currentScheme;
    this.#resolveActions(this.#context);
    this.#updateRebind(unscaledDeltaTime);
    this.#publishDiagnostics(drained);
  }

  /**
   * Attaches the DOM adapters, if the app has a canvas to attach them to.
   *
   * @param surface - The engine's render surface.
   *
   * @internal
   */
  attachDom(surface: unknown): void {
    const canvas = asDomCanvas(surface);
    if (canvas === null || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const bridge = new DomBridge({
      target: { canvas, window, document },
      queue: this.#queue,
      pointerLock: this.pointerLock,
      cursor: this.cursor,
    });
    bridge.attach();
    this.#bridge = bridge;
  }

  /**
   * Records the handle of the document the `input.actions` setting named.
   *
   * @param handle - The handle, or `null`.
   *
   * @internal
   */
  setActionsHandle(handle: AssetHandle<InputActionsAsset> | null): void {
    this.#actionsHandle = handle;
  }

  /**
   * Registers the `input` diagnostics group.
   *
   * @param group - The group `app.diagnostics.registerGroup` returned.
   *
   * @internal
   */
  setDiagnostics(group: DiagnosticsGroup): void {
    this.#counters = group;
  }

  /**
   * Detaches the DOM, cancels a rebind in flight, and stops resolving.
   *
   * @internal
   */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.cancelInteractiveRebind();
    this.#bridge?.detach();
    this.#bridge = null;
    this.devices.setTouchHandler(null);
    this.#queue.clear();
    this.#schemeChanged.clear();
    this.#deviceConnected.clear();
    this.#deviceDisconnected.clear();
  }

  /**
   * How many records the event pool holds. The allocation test watches it stabilise.
   *
   * @returns The free-list length.
   *
   * @internal
   */
  get eventPoolSize(): number {
    return this.#queue.poolSize;
  }

  /** Rebuilds the flat action list and the per-control subscriptions every map contributes. */
  #rebuildActions(): void {
    this.#actions.length = 0;
    this.#dirty.length = 0;
    this.#collect(this.#maps);
    for (const set of this.#sets) {
      this.#collect(set.maps);
    }
    this.#rebuildSubscriptions();
  }

  /**
   * Appends one map table's actions to the flat resolution list.
   *
   * @param maps - The maps to collect from.
   */
  #collect(maps: ReadonlyMap<string, ActionMap>): void {
    for (const map of maps.values()) {
      for (const action of map.actions.values()) {
        this.#actions.push(action);
        this.#dirty.push(false);
      }
    }
  }

  /** Rebuilds the control-to-actions index every device consults when a value changes. */
  #rebuildSubscriptions(): void {
    this.devices.clearSubscribers();
    const perDevice = new Map<InputDevice, Map<number, number[]>>();
    for (let index = 0; index < this.#actions.length; index += 1) {
      const action = this.#actions[index];
      if (action === undefined) {
        continue;
      }
      for (const binding of action.bindings) {
        for (const ref of binding.refs) {
          let controls = perDevice.get(ref.device);
          if (controls === undefined) {
            controls = new Map<number, number[]>();
            perDevice.set(ref.device, controls);
          }
          const list = controls.get(ref.control.index) ?? [];
          if (!list.includes(index)) {
            list.push(index);
          }
          controls.set(ref.control.index, list);
        }
      }
    }
    for (const [device, controls] of perDevice) {
      for (const [controlIndex, actions] of controls) {
        device.setSubscribers(controlIndex, actions);
      }
    }
    this.#subscriptionsDirty = false;
  }

  /**
   * Records that a control change touched a set of actions, keeping arrival order.
   *
   * @param actions - The action indices bound to the control that changed.
   */
  #markDirty(actions: readonly number[]): void {
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      if (action === undefined || this.#dirty[action] === true) {
        continue;
      }
      this.#dirty[action] = true;
      this.#pending.push(action);
    }
  }

  /**
   * Resolves the actions the frame's events touched, in arrival order, then everything else.
   *
   * @param context - Focus, scheme, and strictness for this frame.
   */
  #resolveActions(context: BindingContext): void {
    if (this.#subscriptionsDirty) {
      this.#rebuildSubscriptions();
    }
    const pressPoint = this.pressPoint;
    const pending = this.#pending;
    for (let index = 0; index < pending.length; index += 1) {
      const slot = pending[index];
      if (slot === undefined) {
        continue;
      }
      this.#actions[slot]?.resolve(context, pressPoint);
    }
    const actions = this.#actions;
    for (let index = 0; index < actions.length; index += 1) {
      if (this.#dirty[index] === true) {
        continue;
      }
      actions[index]?.resolve(context, pressPoint);
    }
  }

  /** Reads every gamepad slot and switches the scheme when a pad is actuated afresh. */
  #pollGamepads(): void {
    this.#poller.poll(
      this.devices.gamepads,
      (device: GamepadDevice): void => {
        this.#deviceConnected.emit(device);
      },
      (device: GamepadDevice): void => {
        this.#deviceDisconnected.emit(device);
      },
    );
    for (let slot = 0; slot < this.devices.gamepads.length; slot += 1) {
      const device = this.devices.gamepads[slot];
      if (device === undefined) {
        continue;
      }
      const actuated = device.isConnected && isActuated(device);
      if (actuated && this.#padActuated[slot] !== true) {
        this.#switchScheme(DeviceKind.gamepad);
      }
      this.#padActuated[slot] = actuated;
    }
  }

  /**
   * Attributes one queued event to the control scheme its device belongs to.
   *
   * @param entry - The queued entry.
   */
  #attributeScheme(entry: MutableInputEvent): void {
    switch (entry.kind) {
      case "keydown":
      case "keyup": {
        this.#switchScheme(DeviceKind.keyboard);
        return;
      }
      case "wheel": {
        this.#switchScheme(DeviceKind.mouse);
        return;
      }
      case "pointerdown":
      case "pointermove":
      case "pointerup": {
        this.#switchScheme(entry.pointerType === "touch" ? DeviceKind.touch : DeviceKind.mouse);
        return;
      }
      case "textinput":
      case "releaseAll":
      case "control": {
        // Text entry, focus loss, and simulated writes name no device, so they change no scheme.
        return;
      }
    }
  }

  /**
   * Switches the active control scheme to the one that lists a device family.
   *
   * @param device - The family that produced input.
   */
  #switchScheme(device: DeviceKind): void {
    const scheme = this.#schemes.forDevice(device);
    if (scheme === "" || scheme === this.#currentScheme) {
      return;
    }
    this.#currentScheme = scheme;
    this.#schemeChanged.emit(scheme);
  }

  /**
   * Advances an interactive rebind and applies its result.
   *
   * @param unscaledDeltaTime - Seconds since the previous frame.
   */
  #updateRebind(unscaledDeltaTime: number): void {
    const rebind = this.#rebind;
    if (rebind === null) {
      return;
    }
    const result = rebind.update(this.devices, unscaledDeltaTime);
    if (result === null) {
      return;
    }
    if (result.path !== null) {
      const binding = result.action.bindings[result.bindingIndex];
      if (binding !== undefined) {
        binding.overridePath = result.path;
      }
    }
    this.#finishRebind(result);
  }

  /**
   * Settles the rebind promise and forgets the operation.
   *
   * @param result - What to resolve with.
   */
  #finishRebind(result: InteractiveRebindResult): void {
    const resolve = this.#rebindResolve;
    this.#rebind = null;
    this.#rebindResolve = null;
    resolve?.(result);
  }

  /**
   * Writes this frame's counters.
   *
   * @param drained - How many queued entries were applied.
   */
  #publishDiagnostics(drained: number): void {
    const counters = this.#counters;
    if (counters === null) {
      return;
    }
    let connected = 0;
    for (const pad of this.devices.gamepads) {
      if (pad.isConnected) {
        connected += 1;
      }
    }
    counters.set(0, drained);
    counters.set(1, connected);
    counters.set(2, this.#schemeIndex());
    counters.set(3, this.pointerLock.locked ? 1 : 0);
  }

  /**
   * The active scheme's index in the declared table.
   *
   * @returns The index, or `-1` when no scheme is active.
   */
  #schemeIndex(): number {
    const schemes = this.#schemes.all;
    for (let index = 0; index < schemes.length; index += 1) {
      if (schemes[index]?.name === this.#currentScheme) {
        return index;
      }
    }
    return -1;
  }

  /**
   * Reports a signal handler's exception through the app's error boundary.
   *
   * @param error - Whatever the handler threw.
   */
  #reportHandlerError(error: unknown): void {
    this.#app.onError.emit({ error, source: "system", phase: Phase.PreUpdate, entity: null, component: null });
  }
}

/**
 * Whether any of a gamepad's controls is actuated past the scheme-switch threshold.
 *
 * @param device - The pad to test.
 * @returns `true` when the player is using it.
 */
function isActuated(device: InputDevice): boolean {
  for (const control of device.controls) {
    if (magnitudeOfControl(device, control) >= SCHEME_ACTUATION_THRESHOLD) {
      return true;
    }
  }
  return false;
}

/**
 * How far one control is actuated.
 *
 * @param device - The control's device.
 * @param control - The control.
 * @returns The absolute value, or the vector's length.
 */
function magnitudeOfControl(device: InputDevice, control: ControlDescriptor): number {
  if (control.kind === ControlKind.vector2) {
    return Math.hypot(device.valueAt(control.offset), device.valueAt(control.offset + 1));
  }
  return Math.abs(device.valueAt(control.offset));
}

/**
 * Narrows whatever `loadActions` was handed to the document inside it.
 *
 * @param source - An asset, a handle, or a definition.
 * @returns The document.
 */
function toDefinition(
  source: InputActionsAsset | InputActionsDefinition | AssetHandle<InputActionsAsset>,
): InputActionsDefinition {
  if (source instanceof InputActionsAsset) {
    return source.definition;
  }
  if ("maps" in source) {
    return source;
  }
  return source.value.definition;
}

/**
 * A private copy of a document's action maps, owned by one {@link PlayerInput} or by game code that
 * asked for one (`docs/architecture/08-input.md` §7).
 *
 * @public
 */
export class InputActionSet {
  /** The set's maps, keyed by name. */
  readonly maps: ReadonlyMap<string, ActionMap>;

  /** The lookups over the set's maps. */
  readonly actions: InputActionsView;

  readonly #release: () => void;

  #isDisposed = false;

  /**
   * Wraps a freshly built map table.
   *
   * @param maps - The private maps.
   * @param release - What to call to unregister the set from the service.
   *
   * @internal
   */
  constructor(maps: Map<string, ActionMap>, release: () => void) {
    this.maps = maps;
    this.actions = new InputActionsView(maps);
    this.#release = release;
  }

  /**
   * Whether {@link InputActionSet.dispose} has run.
   *
   * @returns `true` once the set has been disposed.
   */
  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /** Unregisters the set so its actions stop resolving. Disposing twice is a no-op. */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#release();
  }
}
