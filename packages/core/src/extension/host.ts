import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { ExtensionContextImpl } from "./extension-context.js";
import { satisfiesRange } from "./semver-range.js";
import type { ExtensionContextHost } from "./extension-context.js";
import type { ServiceRegistryImpl } from "./service-registry.js";
import type { App, ErrorReport, Extension } from "../app/types.js";
import type { ComponentRegistry } from "../component/component-registry.js";
import type { ErrorCodeRegistry } from "../errors/error-code-registry.js";
import type { ErrorFormatMode } from "../errors/ignifx-error.js";
import type { Logger } from "../log/logger.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import type { SettingsStore } from "../settings/settings-store.js";

/**
 * Register and start extensions in dependency order; stop and dispose them in reverse order.
 * Unrelated extensions keep declaration order. Registration and startup failures propagate;
 * teardown failures go to `app.onError` so remaining cleanup can continue.
 */

/** The DFS colour of an extension while the list is being sorted. */
const Visit = {
  /** Not yet reached. */
  unvisited: 0,
  /** On the current DFS stack. */
  visiting: 1,
  /** Placed in the sorted list. */
  placed: 2,
} as const;

/** The union of {@link Visit} states. */
type Visit = (typeof Visit)[keyof typeof Visit];

/**
 * What the host needs from the app.
 *
 * @internal
 */
export interface ExtensionHostOptions {
  /** The app being built; `defineAppProperty` writes onto this object. */
  readonly app: App;
  /** The app logger; each extension gets a child of it. */
  readonly log: Logger;
  /** The component-class table shared with the world. */
  readonly registry: ComponentRegistry;
  /** The service table. */
  readonly services: ServiceRegistryImpl;
  /** The project settings table. */
  readonly settings: SettingsStore;
  /** The diagnostic-code table. */
  readonly errorCodes: ErrorCodeRegistry;
  /** The frame function systems are registered with. */
  readonly scheduler: Scheduler;
  /** The running `@ignifx/core` version, checked against each `engine` range. */
  readonly version: string;
  /** `"development"` throws on a validation failure; `"production"` warns where §2 allows it. */
  readonly mode: ErrorFormatMode;
  /**
   * Reports a teardown failure.
   *
   * @param report - What failed, and where.
   */
  report(report: ErrorReport): void;
}

/**
 * The extension host of one app.
 *
 * @internal
 */
export class ExtensionHost implements ExtensionContextHost {
  readonly #options: ExtensionHostOptions;

  readonly #sorted: Extension[] = [];

  readonly #disposers: (() => void)[] = [];
  #isDisposing = false;

  readonly #properties = new Set<string>();

  /**
   * Creates the host of one app.
   *
   * @param options - The app and the tables extensions contribute to.
   */
  constructor(options: ExtensionHostOptions) {
    this.#options = options;
  }

  /**
   * The extensions in the order they were registered in.
   *
   * @returns The sorted list.
   */
  get extensions(): readonly Extension[] {
    return this.#sorted;
  }

  /**
   * Sorts, validates, and registers every extension (§2 rules 1–4).
   *
   * @param list - The implicit core extension followed by the game's list.
   * @returns A promise that settles once every `register` hook has finished.
   * @throws IgnifxError with code `IGX-0406` on a duplicate name, `IGX-0403` on a missing required
   * extension, `IGX-0402` on a `requires` cycle, or `IGX-0404` on an `engine` mismatch in
   * development.
   */
  async register(list: readonly Extension[]): Promise<void> {
    const sorted = this.#sort(list);
    for (let index = 0; index < sorted.length; index += 1) {
      const extension = sorted[index];
      if (extension !== undefined) {
        this.#checkEngineRange(extension);
      }
    }
    this.#sorted.push(...sorted);
    for (let index = 0; index < sorted.length; index += 1) {
      const extension = sorted[index];
      if (extension === undefined) {
        continue;
      }
      const context = new ExtensionContextImpl({
        app: this.#options.app,
        extension,
        log: this.#options.log.child(extension.name),
        registry: this.#options.registry,
        services: this.#options.services,
        settings: this.#options.settings,
        errorCodes: this.#options.errorCodes,
        scheduler: this.#options.scheduler,
        host: this,
      });
      const result = extension.register(context);
      if (result !== undefined) {
        // Sequential on purpose (§2 rule 4): an extension's `register` may `ctx.require` a service
        // an earlier one registered, so running them in parallel would break the contract.
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above
        await result;
      }
    }
  }

  /**
   * Runs every `onStart` hook in registration order (§2 rule 5).
   *
   * @returns A promise that settles once every hook has finished.
   */
  async start(): Promise<void> {
    const app = this.#options.app;
    for (let index = 0; index < this.#sorted.length; index += 1) {
      const result = this.#sorted[index]?.onStart?.(app);
      if (result !== undefined) {
        // Sequential on purpose (§2 rule 5): `onStart` runs "in order", and a later extension may
        // depend on what an earlier one loaded.
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above
        await result;
      }
    }
  }

  /** Runs every `onStop` hook in reverse registration order (§2 rule 6), guarded. */
  stop(): void {
    const app = this.#options.app;
    for (let index = this.#sorted.length - 1; index >= 0; index -= 1) {
      const extension = this.#sorted[index];
      if (extension === undefined) {
        continue;
      }
      try {
        extension.onStop?.(app);
      } catch (error) {
        this.#reportTeardown(error);
      }
    }
  }

  /** Runs every `dispose` hook and `onDispose` callback in reverse order, guarded. */
  dispose(): void {
    this.#isDisposing = true;
    const app = this.#options.app;
    for (let index = this.#sorted.length - 1; index >= 0; index -= 1) {
      const extension = this.#sorted[index];
      if (extension === undefined) {
        continue;
      }
      try {
        extension.dispose?.(app);
      } catch (error) {
        this.#reportTeardown(error);
      }
    }
    for (let index = this.#disposers.length - 1; index >= 0; index -= 1) {
      try {
        this.#disposers[index]?.();
      } catch (error) {
        this.#reportTeardown(error);
      }
    }
    this.#disposers.length = 0;
  }

  /**
   * Whether {@link ExtensionHost.dispose} has begun, for the context's dispose-time checks.
   *
   * @returns `true` from the first line of `dispose()` onwards.
   */
  get isDisposing(): boolean {
    return this.#isDisposing;
  }

  /**
   * Defines a typed service property on the app object.
   *
   * @remarks
   * Coding standards §5.3 bans `Object.defineProperty` tricks *except* this call site, which
   * `docs/architecture/04-extensions.md` §1 requires: `ctx.defineAppProperty("input", () => service)`
   * is the runtime half of the module augmentation that makes `this.app.input` typed. The property
   * is an accessor rather than a value so that a service replaced during hot reload is picked up on
   * the next read, and `configurable: false` is what makes a second definition impossible even
   * outside the guard below.
   *
   * @param name - The property name.
   * @param getter - Returns the value on each read.
   * @param owner - The extension defining it, named in the error.
   * @throws IgnifxError with code `IGX-0401` when the name is already taken, whether by another
   * extension or by the `App` surface itself.
   */
  defineAppProperty(name: string, getter: () => unknown, owner: string): void {
    const app = this.#options.app;
    if (this.#properties.has(name) || name in app) {
      throw new IgnifxError(CoreErrorCode.appPropertyAlreadyDefined, `The app property ${name} is already defined.`, {
        context: { property: name, owner },
        hint: "Pick a name no other extension and no core App member uses.",
      });
    }
    this.#properties.add(name);
    Object.defineProperty(app, name, { get: getter, enumerable: true, configurable: false });
  }

  /**
   * Records a teardown callback.
   *
   * @param callback - The teardown to run at disposal.
   */
  addDisposer(callback: () => void): void {
    this.#disposers.push(callback);
  }

  /**
   * Checks an extension's `engine` range against the running core version (§2 rule 3).
   *
   * @param extension - The extension to check.
   * @throws IgnifxError with code `IGX-0404` in development when the range does not match.
   */
  #checkEngineRange(extension: Extension): void {
    const range = extension.engine;
    if (range === undefined || satisfiesRange(this.#options.version, range)) {
      return;
    }
    const message = `${extension.name} supports engine ${range} but the running core is ${this.#options.version}.`;
    if (this.#options.mode === "development") {
      throw new IgnifxError(CoreErrorCode.extensionEngineMismatch, message, {
        context: { extension: extension.name, range, version: this.#options.version },
        hint: "Upgrade the extension, or widen its `engine` range if it really does support this core.",
      });
    }
    this.#options.log.warn(message);
  }

  /**
   * Topologically sorts the extension list (§2 rule 2).
   *
   * @param list - The extensions in the order the game wrote them.
   * @returns A new list in which every extension follows everything it requires.
   * @throws IgnifxError with code `IGX-0406`, `IGX-0403`, or `IGX-0402`.
   */
  #sort(list: readonly Extension[]): Extension[] {
    const byName = new Map<string, Extension>();
    for (let index = 0; index < list.length; index += 1) {
      const extension = list[index];
      if (extension === undefined) {
        continue;
      }
      if (byName.has(extension.name)) {
        throw new IgnifxError(
          CoreErrorCode.duplicateExtensionName,
          `The extension name ${extension.name} is registered twice.`,
          { context: { extension: extension.name }, hint: "Every extension name must be unique within one app." },
        );
      }
      byName.set(extension.name, extension);
    }
    const state = new Map<string, Visit>();
    const stack: string[] = [];
    const sorted: Extension[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const extension = list[index];
      if (extension !== undefined) {
        this.#visit(extension, byName, state, stack, sorted);
      }
    }
    return sorted;
  }

  /**
   * Places one extension after everything it depends on.
   *
   * @param extension - The extension to place.
   * @param byName - Every extension in the app, by name.
   * @param state - The DFS colour of each extension.
   * @param stack - The names on the current DFS stack, for the cycle message.
   * @param sorted - The list being built.
   */
  #visit(
    extension: Extension,
    byName: ReadonlyMap<string, Extension>,
    state: Map<string, Visit>,
    stack: string[],
    sorted: Extension[],
  ): void {
    if (state.get(extension.name) === Visit.placed) {
      return;
    }
    state.set(extension.name, Visit.visiting);
    stack.push(extension.name);
    const required = extension.requires ?? [];
    for (let index = 0; index < required.length; index += 1) {
      const name = required[index];
      if (name === undefined) {
        continue;
      }
      const dependency = byName.get(name);
      if (dependency === undefined) {
        throw new IgnifxError(
          CoreErrorCode.extensionMissing,
          `${extension.name} requires ${name}, which is not registered.`,
          {
            context: { extension: extension.name, required: name },
            hint: "Add the extension to the `extensions` list passed to createApp().",
          },
        );
      }
      if (state.get(name) === Visit.visiting) {
        throw new IgnifxError(
          CoreErrorCode.extensionRequiresCycle,
          `The extension requires graph contains a cycle: ${stack.join(" -> ")} -> ${name}.`,
          {
            context: { cycle: `${stack.join(" -> ")} -> ${name}` },
            hint: "Turn one of the edges into an `optional` dependency resolved lazily in onStart.",
          },
        );
      }
      this.#visit(dependency, byName, state, stack, sorted);
    }
    const optional = extension.optional ?? [];
    for (let index = 0; index < optional.length; index += 1) {
      const name = optional[index];
      if (name === undefined) {
        continue;
      }
      const dependency = byName.get(name);
      if (dependency === undefined) {
        continue;
      }
      if (state.get(name) === Visit.visiting) {
        // §2 rule 2: two extensions that optionally integrate with each other are legal. The edge
        // is dropped, the pair registers in list order, and each resolves the other lazily through
        // `ctx.tryGet` in `onStart`.
        if (this.#options.mode === "development") {
          this.#options.log.debug(
            "Dropped the optional dependency {extension} -> {optional} because it would form a cycle.",
            extension.name,
            name,
          );
        }
        continue;
      }
      this.#visit(dependency, byName, state, stack, sorted);
    }
    stack.pop();
    state.set(extension.name, Visit.placed);
    sorted.push(extension);
  }

  /**
   * Reports a teardown failure through `app.onError`.
   *
   * @param error - Whatever the hook threw.
   */
  #reportTeardown(error: unknown): void {
    this.#options.report({ error, source: "extension", phase: null, entity: null, component: null });
  }
}
