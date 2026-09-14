import type { App } from "@ignifx/core";

/**
 * Structural reach into the optional extensions (`docs/architecture/04-extensions.md` §1).
 *
 * ## Why nothing here is imported
 *
 * `@ignifx/devtools` lists `@ignifx/ui`, `@ignifx/input`, `@ignifx/audio`, `@ignifx/physics` and
 * `@ignifx/physics-2d` as **optional** peers. A game that installs only `@ignifx/core` must still
 * be able to open the overlay, so `src/**` imports none of them — not even for types. Every read is
 * a `Reflect.get` plus a shape check, exactly the way `@ignifx/ui` reaches
 * `app.input.uiHasFocus` (`packages/ui/src/extension.ts` `inputFlagSetter`).
 *
 * The interfaces below are the *narrow* views devtools needs, not restatements of the real APIs:
 * each one names the members a panel reads and nothing else, so a later release of an optional
 * package cannot break the probe by changing something devtools never touches.
 */

/**
 * Reads a property off an object-ish value.
 *
 * @param target - The value to read from.
 * @param key - The property name.
 * @returns The value, or `undefined` when the target is not an object or has no such property.
 */
function read(target: unknown, key: string): unknown {
  if (target === null || typeof target !== "object") {
    return undefined;
  }
  return Reflect.get(target, key);
}

/**
 * Reports whether a value is an object carrying every named member.
 *
 * @param value - The candidate.
 * @param keys - The member names that must be present.
 * @returns `true` when the value is a non-null object with all of them.
 */
function hasAll(value: unknown, keys: readonly string[]): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] ?? "";
    if (!(key in value)) {
      return false;
    }
  }
  return true;
}

/**
 * A DOM layer of `@ignifx/ui`'s overlay host, as devtools uses it.
 *
 * @internal
 */
export interface UiLayerProbe {
  /** The layer's element, or `null` under a headless app. */
  readonly element: HTMLElement | null;
}

/**
 * The options `@ignifx/ui`'s `layer` accepts, narrowed to the one member devtools passes.
 *
 * @internal
 */
export interface UiLayerProbeOptions {
  /** The stacking order the layer is created at. */
  readonly zIndex?: number;
}

/**
 * `app.ui`, as devtools uses it: one call that returns a layer to mount into.
 *
 * @internal
 */
export interface UiProbe {
  /** Whether the host built a DOM overlay at all. */
  readonly isActive: boolean;
  /**
   * Returns the named layer, creating it on first use.
   *
   * @param name - The layer name.
   * @param options - The stacking order.
   * @returns The layer.
   */
  layer(name: string, options?: UiLayerProbeOptions): UiLayerProbe;
}

/**
 * Finds `@ignifx/ui`'s overlay host, when the game registered it.
 *
 * @param app - The app to probe.
 * @returns The host, or `null` when `@ignifx/ui` is absent or its overlay is inert.
 *
 * @internal
 */
export function probeUi(app: App): UiProbe | null {
  const ui: unknown = Reflect.get(app, "ui");
  if (!hasAll(ui, ["layer", "isActive"]) || typeof read(ui, "layer") !== "function") {
    return null;
  }
  if (read(ui, "isActive") !== true) {
    return null;
  }
  // The shape checks above are the narrowing.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
  return ui as UiProbe;
}

/**
 * One live action, as the Input panel shows it.
 *
 * @internal
 */
export interface InputActionProbe {
  /** The map the action belongs to. */
  readonly map: string;
  /** The action name. */
  readonly action: string;
  /** `"button"`, `"axis"` or `"vector2"`. */
  readonly type: string;
  /** The value, already formatted for display. */
  readonly value: string;
  /** Whether the action reads as pressed this frame. */
  readonly pressed: boolean;
}

/**
 * The whole Input panel's data, sampled once.
 *
 * @internal
 */
export interface InputProbe {
  /** The active control scheme. */
  readonly scheme: string;
  /** The connected devices, as `kind #index` strings. */
  readonly devices: readonly string[];
  /** Every action of every map. */
  readonly actions: readonly InputActionProbe[];
}

/**
 * Formats one action's value without allocating a nested structure the panel would have to walk.
 *
 * @param value - Whatever `InputAction.value` answered.
 * @returns A short display string.
 */
function formatActionValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return value.toFixed(3);
  }
  const x = read(value, "x");
  const y = read(value, "y");
  if (typeof x === "number" && typeof y === "number") {
    return `${x.toFixed(3)}, ${y.toFixed(3)}`;
  }
  return "-";
}

/**
 * Samples `app.input`, when the game registered `@ignifx/input`.
 *
 * @param app - The app to probe.
 * @returns The sample, or `null` when the extension is absent.
 *
 * @internal
 */
export function probeInput(app: App): InputProbe | null {
  const input: unknown = Reflect.get(app, "input");
  if (!hasAll(input, ["actions", "devices", "currentScheme"])) {
    return null;
  }
  const scheme = read(input, "currentScheme");
  const devices: string[] = [];
  const all = read(read(input, "devices"), "all");
  if (Array.isArray(all)) {
    for (let index = 0; index < all.length; index += 1) {
      const device: unknown = all[index];
      const kind = read(device, "kind");
      const at = read(device, "deviceIndex");
      const connected = read(device, "isConnected");
      if (typeof kind !== "string" || connected !== true) {
        continue;
      }
      devices.push(typeof at === "number" && at > 0 ? `${kind} #${String(at)}` : kind);
    }
  }
  const actions: InputActionProbe[] = [];
  const maps = read(read(input, "actions"), "maps");
  if (maps instanceof Map) {
    for (const [mapName, map] of maps) {
      const entries = read(map, "actions");
      if (typeof mapName !== "string" || !(entries instanceof Map)) {
        continue;
      }
      for (const [actionName, action] of entries) {
        if (typeof actionName !== "string") {
          continue;
        }
        const type = read(action, "type");
        actions.push({
          map: mapName,
          action: actionName,
          type: typeof type === "string" ? type : "button",
          value: formatActionValue(read(action, "value")),
          pressed: read(action, "isPressed") === true,
        });
      }
    }
  }
  return { scheme: typeof scheme === "string" ? scheme : "", devices, actions };
}

/**
 * One audio bus, as the Audio panel shows and edits it.
 *
 * @internal
 */
export interface AudioBusProbe {
  /** The bus name. */
  readonly name: string;
  /** Its own volume, `0`–`1`. */
  readonly volume: number;
  /** Its volume after its parents', `0`–`1`. */
  readonly effectiveVolume: number;
  /** Whether it is muted. */
  readonly muted: boolean;
  /**
   * Writes the bus's own volume. A property rather than a method, so a panel can hold it without
   * unbinding it from its bus.
   */
  readonly setVolume: (value: number) => void;
}

/**
 * The whole Audio panel's data, sampled once.
 *
 * @internal
 */
export interface AudioProbe {
  /** The master volume, `0`–`1`. */
  readonly masterVolume: number;
  /** Every bus in the tree. */
  readonly buses: readonly AudioBusProbe[];
}

/**
 * Samples `app.audio`, when the game registered `@ignifx/audio`.
 *
 * @param app - The app to probe.
 * @returns The sample, or `null` when the extension is absent.
 *
 * @internal
 */
export function probeAudio(app: App): AudioProbe | null {
  const audio: unknown = Reflect.get(app, "audio");
  if (!hasAll(audio, ["buses", "masterVolume"])) {
    return null;
  }
  const master = read(audio, "masterVolume");
  const buses: AudioBusProbe[] = [];
  const table = read(audio, "buses");
  if (table instanceof Map) {
    for (const [name, bus] of table) {
      const volume = read(bus, "volume");
      const effective = read(bus, "effectiveVolume");
      if (typeof name !== "string" || typeof volume !== "number") {
        continue;
      }
      buses.push({
        name,
        volume,
        effectiveVolume: typeof effective === "number" ? effective : volume,
        muted: read(bus, "muted") === true,
        setVolume: (value: number): void => {
          if (bus !== null && typeof bus === "object") {
            Reflect.set(bus, "volume", value);
          }
        },
      });
    }
  }
  return { masterVolume: typeof master === "number" ? master : 1, buses };
}

/**
 * `app.physics.debugViewer`, as the Physics panel toggles it (`docs/architecture/09-physics.md`
 * §9).
 *
 * @internal
 */
export interface PhysicsDebugProbe {
  /** Whether Babylon Lite's physics viewer is drawing. */
  readonly enabled: boolean;
  /** Turns the viewer on or off. A property for the same reason {@link AudioBusProbe.setVolume} is. */
  readonly setEnabled: (value: boolean) => void;
}

/**
 * Finds `app.physics.debugViewer`, when the game registered `@ignifx/physics`.
 *
 * @param app - The app to probe.
 * @returns The toggle, or `null` when 3D physics is absent.
 *
 * @internal
 */
export function probePhysicsDebug(app: App): PhysicsDebugProbe | null {
  const viewer: unknown = read(Reflect.get(app, "physics"), "debugViewer");
  if (!hasAll(viewer, ["enabled"])) {
    return null;
  }
  return {
    enabled: read(viewer, "enabled") === true,
    setEnabled: (value: boolean): void => {
      if (viewer !== null && typeof viewer === "object") {
        Reflect.set(viewer, "enabled", value);
      }
    },
  };
}

/**
 * Reports whether the app has a 2D physics service at all, so the Physics panel can say "2D
 * physics is not registered" rather than showing an empty table.
 *
 * @param app - The app to probe.
 * @returns `true` when `app.physics2d` is present.
 *
 * @internal
 */
export function hasPhysics2D(app: App): boolean {
  const service: unknown = Reflect.get(app, "physics2d");
  return service !== null && service !== undefined && typeof service === "object";
}

/**
 * The asset service's hot-reload entry point.
 *
 * @remarks
 * `AssetsImpl.reload(address)` exists and is what `@ignifx/vite-plugin`'s HMR channel calls
 * (`packages/core/src/assets/assets-service.ts` `reload`), but it is **not** on the public `Assets`
 * interface, so it is reached structurally and the Assets panel disables its button when the build
 * has no such method.
 *
 * @param app - The app to probe.
 * @returns The reloader, or `null` when this build's asset service has none.
 *
 * @internal
 */
export function probeAssetReload(app: App): ((address: string) => void) | null {
  if (typeof Reflect.get(app.assets, "reload") !== "function") {
    return null;
  }
  // Looked up again at call time rather than captured: the panel resolves the probe once, on its
  // first refresh, and a service whose method is replaced afterwards — a test's spy, a devtools
  // build that swaps the asset service — must still be the thing that runs.
  return (address: string): void => {
    const reload: unknown = Reflect.get(app.assets, "reload");
    if (typeof reload === "function") {
      Reflect.apply(reload, app.assets, [address]);
    }
  };
}
