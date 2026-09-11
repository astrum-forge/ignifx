import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type { ServiceKey, ServiceRegistry } from "../app/types.js";

/**
 * The per-app service table (`docs/architecture/04-extensions.md` §1, §3). Extensions write to it
 * through `ExtensionContext.registerService`; scripts read from it through `app.services`, or
 * through the typed property `defineAppProperty` adds.
 */

/**
 * The human-readable name of a service key, for `IGX-0405` messages.
 *
 * @param key - A class token or a named token.
 * @returns The class name, or the name the token was created with.
 *
 * @internal
 */
export function serviceKeyName(key: ServiceKey<unknown>): string {
  return typeof key === "function" ? key.name : key.serviceName;
}

/**
 * The service table of one app.
 *
 * @internal
 */
export class ServiceRegistryImpl implements ServiceRegistry {
  readonly #entries = new Map<ServiceKey<unknown>, unknown>();

  /**
   * Looks a service up, requiring it to be present.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key.
   * @returns The registered instance.
   * @throws IgnifxError with code `IGX-0405` when no extension registered the service.
   */
  get<T>(key: ServiceKey<T>): T {
    const found = this.tryGet(key);
    if (found === null) {
      throw new IgnifxError(
        CoreErrorCode.serviceNotRegistered,
        `The service ${serviceKeyName(key)} is not registered.`,
        {
          context: { service: serviceKeyName(key) },
          hint: "Add the extension that registers it, and list that extension in `requires`.",
        },
      );
    }
    return found;
  }

  /**
   * Looks a service up, tolerating its absence.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key.
   * @returns The instance, or `null` when it is not registered.
   */
  tryGet<T>(key: ServiceKey<T>): T | null {
    const value = this.#entries.get(key);
    if (value === undefined) {
      return null;
    }
    // The invariant is enforced by
    // `set<T>(key: ServiceKey<T>, value: T)`, which is the only writer. A `Map` cannot carry the
    // relationship between a key's type parameter and its value.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value as T;
  }

  /**
   * Reports whether a service is registered.
   *
   * @param key - The class or named key.
   * @returns `true` when an instance is registered under the key.
   */
  has(key: ServiceKey<unknown>): boolean {
    return this.#entries.has(key);
  }

  /**
   * Registers an instance.
   *
   * @typeParam T - The service instance type.
   * @param key - The class or named key.
   * @param instance - The service.
   */
  set<T>(key: ServiceKey<T>, instance: T): void {
    this.#entries.set(key, instance);
  }

  /** Drops every registration, for app disposal. */
  clear(): void {
    this.#entries.clear();
  }
}
