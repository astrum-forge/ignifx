import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { serviceKeyName } from "./service-registry.js";
import type { ServiceRegistryImpl } from "./service-registry.js";
import type {
  App,
  Extension,
  ExtensionContext,
  RegisterComponentOptions,
  RegisterSystemOptions,
  ServiceKey,
  System,
} from "../app/types.js";
import type { AssetLoader, AssetTypeDefinition } from "../assets/types.js";
import type { ComponentRegistry } from "../component/component-registry.js";
import type { ConcreteComponentType } from "../component/component-type.js";
import type { ErrorCodeRegistry } from "../errors/error-code-registry.js";
import type { Logger } from "../log/logger.js";
import type { RenderingFeature } from "../render/renderer.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import type { Schema } from "../schema/types.js";
import type { SettingsStore } from "../settings/settings-store.js";

/**
 * What the context needs from the host that owns it.
 *
 * @internal
 */
export interface ExtensionContextHost {
  /**
   * The single `Object.defineProperty` call site of the engine.
   *
   * @param name - The property name.
   * @param getter - Returns the value on each read.
   * @param owner - The extension defining it, named in `IGX-0401`.
   */
  defineAppProperty(name: string, getter: () => unknown, owner: string): void;
  /**
   * Records a teardown callback to run when the app is disposed.
   *
   * @param callback - The teardown.
   */
  addDisposer(callback: () => void): void;
}

/**
 * Everything an {@link ExtensionContextImpl} writes into.
 *
 * @internal
 */
export interface ExtensionContextOptions {
  /** The app being built. */
  readonly app: App;
  /** The extension this context belongs to. */
  readonly extension: Extension;
  /** A logger scoped to the extension. */
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
  /** The host, for the two operations only it can perform. */
  readonly host: ExtensionContextHost;
}

/**
 * One extension's registration surface (`docs/architecture/04-extensions.md` §1). A fresh context is
 * built for each extension so that every contribution is attributed to its owner in diagnostics.
 *
 * @internal
 */
export class ExtensionContextImpl implements ExtensionContext {
  /** The app being built. */
  readonly app: App;

  /** A logger scoped to this extension. */
  readonly log: Logger;

  readonly #extension: Extension;

  readonly #registry: ComponentRegistry;

  readonly #services: ServiceRegistryImpl;

  readonly #settings: SettingsStore;

  readonly #errorCodes: ErrorCodeRegistry;

  readonly #scheduler: Scheduler;

  readonly #host: ExtensionContextHost;

  /**
   * Creates the context of one extension.
   *
   * @param options - The app and the tables the extension contributes to.
   */
  constructor(options: ExtensionContextOptions) {
    this.app = options.app;
    this.log = options.log;
    this.#extension = options.extension;
    this.#registry = options.registry;
    this.#services = options.services;
    this.#settings = options.settings;
    this.#errorCodes = options.errorCodes;
    this.#scheduler = options.scheduler;
    this.#host = options.host;
  }

  /**
   * Registers one component class, making its `typeId` known to the serializer and the inspector.
   *
   * @param type - The component class.
   * @param options - An explicit `typeId`, when the class does not declare one.
   */
  registerComponent(type: ConcreteComponentType, options?: RegisterComponentOptions): void {
    this.#registry.register(type, options?.typeId);
  }

  /**
   * Registers several component classes.
   *
   * @param types - The component classes.
   */
  registerComponents(types: readonly ConcreteComponentType[]): void {
    this.#registry.registerAll(types);
  }

  /**
   * Registers a system in a phase.
   *
   * @param system - The system.
   * @param options - The phase and the ascending order within it.
   */
  registerSystem(system: System, options: RegisterSystemOptions): void {
    this.#scheduler.registerSystem(system, options);
  }

  /**
   * Registers a service instance under a key.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key.
   * @param instance - The service.
   */
  registerService<T>(key: ServiceKey<T>, instance: T): void {
    this.#services.set(key, instance);
  }

  /**
   * Declares an asset type whose loader is registered separately, or not at all
   * (`docs/architecture/04-extensions.md` §1).
   *
   * @param type - The type name and the extensions that select it.
   */
  registerAssetType(type: AssetTypeDefinition): void {
    this.app.assets.registerType(type);
  }

  /**
   * Registers an asset loader (`docs/architecture/05-assets-and-loading.md` §5).
   *
   * @param loader - The loader, which also declares the extensions that select its type.
   * @throws IgnifxError with code `IGX-0506` when another extension already owns the type.
   */
  registerAssetLoader(loader: AssetLoader): void {
    this.app.assets.registerLoader(loader);
  }

  /**
   * Declares that this extension needs a rendering feature switched on
   * (`docs/architecture/07-rendering.md` §1.1).
   *
   * @param feature - The feature the extension needs.
   * @throws IgnifxError with code `IGX-0704` when the render scene has already been registered.
   */
  requireRenderingFeature(feature: RenderingFeature): void {
    this.app.renderer.requireFeature(feature);
  }

  /**
   * Defines a property on `App`, pairing with a module augmentation of the `App` interface
   * (`docs/architecture/03-scripting-and-components.md` §7).
   *
   * @param name - The property name, for example `"input"`.
   * @param getter - Returns the value each time the property is read.
   * @throws IgnifxError with code `IGX-0401` when the property already exists on the app.
   */
  defineAppProperty(name: string, getter: () => unknown): void {
    this.#host.defineAppProperty(name, getter, this.#extension.name);
  }

  /**
   * Registers a project settings section and resolves it immediately, so `ctx.settings(section)`
   * works inside the same `register` call.
   *
   * @typeParam S - The section's resolved shape.
   * @param section - The section name as it appears in `ignifx.config.ts`.
   * @param schema - The schema the section is validated against.
   * @param defaults - The values used when the project omits the section.
   * @throws IgnifxError with code `IGX-0408` in development when the project's values do not
   * validate against the schema.
   */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see `AppSettings.section`.
  registerSettings<S>(section: string, schema: Schema, defaults: S): void {
    this.#settings.register(section, schema, defaults, this.#extension.name);
  }

  /**
   * Adds diagnostic codes to the app's error-code registry.
   *
   * @param codes - `IGX-####` to one-line message template.
   */
  registerErrorCodes(codes: Readonly<Record<string, string>>): void {
    this.#errorCodes.register(codes, this.#extension.name);
  }

  /**
   * Registers a callback that runs when the app is disposed, in reverse registration order.
   *
   * @param callback - The teardown to run.
   */
  onDispose(callback: () => void): void {
    this.#host.addDisposer(callback);
  }

  /**
   * Looks up a service registered by an earlier extension.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key.
   * @returns The instance.
   * @throws IgnifxError with code `IGX-0405` when the service is not registered.
   */
  require<T>(key: ServiceKey<T>): T {
    const found = this.#services.tryGet(key);
    if (found === null) {
      throw new IgnifxError(
        CoreErrorCode.serviceNotRegistered,
        `The service ${serviceKeyName(key)} required by ${this.#extension.name} is not registered.`,
        {
          context: { service: serviceKeyName(key), extension: this.#extension.name },
          hint: "List the extension that registers it in `requires` so it registers first.",
        },
      );
    }
    return found;
  }

  /**
   * Looks up a service registered by an earlier extension, tolerating its absence.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key.
   * @returns The instance, or `null` when it is not registered.
   */
  tryGet<T>(key: ServiceKey<T>): T | null {
    return this.#services.tryGet(key);
  }

  /**
   * Reads a resolved settings section.
   *
   * @typeParam S - The section's resolved shape.
   * @param section - The section name.
   * @returns The resolved section.
   * @throws IgnifxError with code `IGX-0407` when the section was never registered.
   */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- see `AppSettings.section`.
  settings<S>(section: string): S {
    return this.#settings.section<S>(section);
  }
}
