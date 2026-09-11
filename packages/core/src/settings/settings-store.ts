import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { createDefaults } from "../schema/schema.js";
import { validateProps } from "../schema/validate.js";
import type { SettingsInput } from "./settings-input.js";
import type { AppSettings, LayersSettings, SortingLayersSettings, TimeSettings } from "../app/types.js";
import type { ErrorFormatMode } from "../errors/ignifx-error.js";
import type { Logger } from "../log/logger.js";
import type { Schema } from "../schema/types.js";

/**
 * Merge project values over each extension's schema defaults, validate, then freeze.
 * Single-field sections accept a non-object value as shorthand, such as `layers: ["Default"]`;
 * multi-field sections use named properties.
 */

/** One registered section. */
interface Section {
  /** The schema the section is validated against. */
  readonly schema: Schema;
  /** The extension that registered it. */
  readonly owner: string;
  /** The resolved, frozen value. */
  value: Readonly<Record<string, unknown>>;
}

/**
 * Reports whether a value is a plain object rather than an array, a primitive, or `null`.
 *
 * @param value - The candidate.
 * @returns `true` when the value can be read as a bag of named props.
 */
function isPropertyBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The per-app settings table.
 *
 * @internal
 */
export class SettingsStore implements AppSettings {
  readonly #sections = new Map<string, Section>();

  readonly #input: SettingsInput;

  readonly #mode: ErrorFormatMode;

  readonly #log: Logger;

  #isFrozen = false;

  /**
   * Creates the settings table of one app.
   *
   * @param input - What the project supplied, keyed by section name.
   * @param mode - `"development"` throws on an invalid or unknown section; `"production"` logs and
   * falls back to the registered defaults (§5).
   * @param log - Where the production-mode complaints go.
   */
  constructor(input: SettingsInput, mode: ErrorFormatMode, log: Logger) {
    this.#input = input;
    this.#mode = mode;
    this.#log = log;
  }

  /**
   * The core `layers` section.
   *
   * @returns The project's layer names.
   */
  get layers(): LayersSettings {
    return this.section<LayersSettings>("layers");
  }

  /**
   * The core `sortingLayers` section.
   *
   * @returns The project's sorting-layer names.
   */
  get sortingLayers(): SortingLayersSettings {
    return this.section<SortingLayersSettings>("sortingLayers");
  }

  /**
   * The core `time` section.
   *
   * @returns The initial clock settings.
   */
  get time(): TimeSettings {
    return this.section<TimeSettings>("time");
  }

  /**
   * Reads a resolved section.
   *
   * @typeParam S - The section's resolved shape, as its owner declared it.
   * @param name - The section name.
   * @returns The frozen resolved section.
   * @throws IgnifxError with code `IGX-0407` when the section was never registered.
   */
  // The type parameter is the caller's declaration of what the section holds; there is no value to
  // infer it from. Same escape hatch as `AppSettings.section`.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  section<S>(name: string): S {
    const section = this.#sections.get(name);
    if (section === undefined) {
      throw new IgnifxError(CoreErrorCode.unknownSettingsSection, `${name} is not a registered settings section.`, {
        context: { section: name },
        hint: "A section exists once the extension that owns it has run its register() hook.",
      });
    }
    // The invariant is that the resolved value was
    // built from the owner's own schema and defaults, so it has exactly the shape the owner
    // declared. Nothing in the type system connects a section name to a shape.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return section.value as S;
  }

  /**
   * Registers and immediately resolves a section, so `ctx.settings(name)` works inside the same
   * `register` call that declared it (`04-extensions.md` §1).
   *
   * @param name - The section name as it appears in `ignifx.config.ts`.
   * @param schema - The schema the project's values are validated against.
   * @param defaults - The values used for everything the project omits, as a bag of named props.
   * @param owner - The extension registering the section, named in diagnostics.
   * @throws IgnifxError with code `IGX-0408` in development when the project's values do not
   * validate.
   */
  register(name: string, schema: Schema, defaults: unknown, owner: string): void {
    const base = isPropertyBag(defaults) ? defaults : createDefaults(schema);
    const value = this.#resolve(name, schema, base);
    this.#sections.set(name, { schema, owner, value: Object.freeze(value) });
  }

  /**
   * Reports whether a section has been registered.
   *
   * @param name - The section name.
   * @returns `true` when an extension owns the section.
   */
  has(name: string): boolean {
    return this.#sections.has(name);
  }

  /**
   * Checks that every section the project supplied is owned by some extension (§5) and closes the
   * table to further registration.
   *
   * @throws IgnifxError with code `IGX-0407` in development when the project declares a section no
   * extension registered.
   */
  freeze(): void {
    for (const name of Object.keys(this.#input)) {
      if (this.#sections.has(name)) {
        continue;
      }
      if (this.#mode === "development") {
        throw new IgnifxError(CoreErrorCode.unknownSettingsSection, `${name} is not a registered settings section.`, {
          context: { section: name },
          hint: "Register the extension that owns the section, or remove it from the project settings.",
        });
      }
      this.#log.warn(`Ignoring the unknown settings section ${name}.`);
    }
    this.#isFrozen = true;
  }

  /**
   * Whether {@link SettingsStore.freeze} has run.
   *
   * @returns `true` once the table is closed.
   */
  get isFrozen(): boolean {
    return this.#isFrozen;
  }

  /**
   * Merges the project's values for one section over its defaults, validating them first.
   *
   * @param name - The section name.
   * @param schema - The owner's schema.
   * @param defaults - The owner's defaults.
   * @returns The resolved section.
   * @throws IgnifxError with code `IGX-0408` in development when validation fails.
   */
  #resolve(name: string, schema: Schema, defaults: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const provided = this.#input[name];
    const resolved: Record<string, unknown> = { ...defaults };
    if (provided === undefined) {
      return resolved;
    }
    const props = this.#toPropertyBag(schema, provided);
    if (props === null) {
      return this.#reject(name, `${name} settings must be an object.`, resolved);
    }
    const issues = validateProps(schema, props, name);
    if (issues.length > 0) {
      const detail = issues.map((entry) => `${entry.path}: ${entry.message}`).join("; ");
      return this.#reject(name, detail, resolved);
    }
    return Object.assign(resolved, props);
  }

  /**
   * Applies the single-field shorthand: a section whose schema declares exactly one field may be
   * written as that field's value.
   *
   * @param schema - The owner's schema.
   * @param provided - What the project supplied.
   * @returns A bag of named props, or `null` when the value cannot be read as one.
   */
  #toPropertyBag(schema: Schema, provided: unknown): Record<string, unknown> | null {
    if (isPropertyBag(provided)) {
      return provided;
    }
    const names = Object.keys(schema);
    const only = names[0];
    if (names.length !== 1 || only === undefined) {
      return null;
    }
    return { [only]: provided };
  }

  /**
   * Handles an invalid section: a throw in development, a log line and the defaults in production
   * (§5).
   *
   * @param name - The section name.
   * @param detail - What was wrong.
   * @param defaults - The values to fall back to.
   * @returns The defaults, in production.
   * @throws IgnifxError with code `IGX-0408` in development.
   */
  #reject(name: string, detail: string, defaults: Record<string, unknown>): Record<string, unknown> {
    if (this.#mode === "development") {
      throw new IgnifxError(CoreErrorCode.invalidSettings, `The ${name} settings section is invalid: ${detail}`, {
        context: { section: name, issues: detail },
        hint: "Check the section against the schema the owning extension registered.",
      });
    }
    this.#log.warn(
      "The {section} settings section is invalid and was replaced by its defaults: {issues}",
      name,
      detail,
    );
    return defaults;
  }
}
