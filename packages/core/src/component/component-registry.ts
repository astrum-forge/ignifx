import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { SCRIPT_CALLBACK_COUNT, SCRIPT_CALLBACK_NAMES, readCallback } from "../lifecycle/callbacks.js";
import { Script } from "../script/script.js";
import { Component } from "./component.js";
import type { ComponentType, ConcreteComponentType, ScriptStatics } from "./component-type.js";
import type { FieldDefinition, Schema } from "../schema/types.js";

/**
 * The per-app table of component classes
 * (`docs/architecture/03-scripting-and-components.md` §4). It does three jobs: it maps `typeId`s to
 * classes for the serializer, it works out once per class which callbacks the class implements and
 * which of its fields are tracked references, and it precomputes each class's ancestor chain so
 * that `world.components(Type)` never walks a prototype at run time (coding standards §7).
 */

/** `<namespace>/<Name>`: one or more path-safe segments, a slash, then a PascalCase-ish name. */
const TYPE_ID_PATTERN = /^[a-z0-9][a-z0-9\-.@/]*\/[A-Za-z][A-Za-z0-9]*$/u;

/**
 * What the registry worked out about a script class by inspecting its prototype exactly once.
 *
 * @public
 */
export interface ScriptClassInfo {
  /** `static executionOrder`, resolved at registration. */
  readonly executionOrder: number;
  /** `static updateWhenPaused`, resolved at registration. */
  readonly updateWhenPaused: boolean;
  /** One bit per `ScriptCallbackKind`: set when the class implements that callback. */
  readonly callbacks: number;
}

/**
 * Everything the engine needs to know about a component class, computed once and cached.
 *
 * @public
 */
export interface ComponentClassInfo {
  /** The class itself. */
  readonly type: ComponentType;
  /** The namespaced registration id, or `null` when the class declares none. */
  readonly typeId: string | null;
  /** The declared serialized fields, or `null` when the class was not built with `define`. */
  readonly schema: Schema | null;
  /** Component types auto-added to, and validated on, the entity. */
  readonly requires: readonly ComponentType[];
  /** `false` when at most one instance may live on an entity. */
  readonly allowMultiple: boolean;
  /**
   * The class and every component class it derives from, nearest first, ending at `Component`.
   * `world.components(Type)` and `getComponent(Type)` match against this list, which is why they
   * are inheritance-aware without touching a prototype chain per frame.
   */
  readonly ancestors: readonly ComponentType[];
  /**
   * The names of the `entityRef`/`componentRef` fields the schema declares. The world's reference
   * tracker nulls exactly these when their target is destroyed
   * (`docs/architecture/02-scene-graph.md` §4).
   */
  readonly trackedFields: readonly string[];
  /** `true` when the class derives from `Script`. */
  readonly isScript: boolean;
  /** Callback and ordering data, or `null` for a plain component. */
  readonly script: ScriptClassInfo | null;
  /** A dense index assigned in registration order, for array-indexed per-class bookkeeping. */
  readonly classIndex: number;
}

/**
 * The component-class table of one app. There is one per {@link App}, never a module-level one
 * (`CONSTITUTION.md` §3.5, §3.6): two apps in one test process must not see each other's types.
 *
 * @example
 * ```ts
 * const registry = new ComponentRegistry();
 * registry.register(Mover);
 * registry.get("mygame/Mover"); // Mover
 * ```
 *
 * @public
 */
export class ComponentRegistry {
  readonly #byTypeId = new Map<string, ComponentType>();

  readonly #info = new Map<ComponentType, ComponentClassInfo>();

  #nextClassIndex = 0;

  /**
   * How many classes the registry has described, registered explicitly or not.
   *
   * @returns The class count.
   */
  get size(): number {
    return this.#info.size;
  }

  /**
   * Registers a component class so that scenes using it can be loaded and saved.
   *
   * @param type - The component class.
   * @param typeId - An explicit id, when the class does not declare one.
   * @returns What the registry worked out about the class.
   * @throws IgnifxError with code `IGX-0203` when the id is already registered by another class, or
   * when the id is not `<namespace>/<Name>`.
   */
  register(type: ConcreteComponentType, typeId?: string): ComponentClassInfo {
    const id = typeId ?? readStatics(type).typeId ?? null;
    if (id !== null) {
      if (!TYPE_ID_PATTERN.test(id)) {
        throw new IgnifxError(CoreErrorCode.duplicateComponentTypeId, `The component type id ${id} is malformed.`, {
          context: { typeId: id, owner: type.prototype.constructor.name },
          hint: 'Type ids are "<package-or-game>/<Name>", for example "mygame/Mover".',
        });
      }
      const existing = this.#byTypeId.get(id);
      if (existing !== undefined && existing !== type) {
        throw new IgnifxError(
          CoreErrorCode.duplicateComponentTypeId,
          `The component type id ${id} is already registered.`,
          { context: { typeId: id, owner: existing.prototype.constructor.name } },
        );
      }
      this.#byTypeId.set(id, type);
    }
    return this.describe(type);
  }

  /**
   * Registers several component classes.
   *
   * @param types - The component classes.
   */
  registerAll(types: readonly ConcreteComponentType[]): void {
    for (let index = 0; index < types.length; index += 1) {
      const type = types[index];
      if (type !== undefined) {
        this.register(type);
      }
    }
  }

  /**
   * Describes a class, computing and caching its info on first sight. Explicit registration is only
   * needed for *serializable* components; a script added from code is described the first time it
   * is attached (`docs/architecture/03-scripting-and-components.md` §4).
   *
   * @param type - The component class.
   * @returns The cached class info.
   */
  describe(type: ComponentType): ComponentClassInfo {
    const cached = this.#info.get(type);
    if (cached !== undefined) {
      return cached;
    }
    const info = this.#build(type);
    this.#info.set(type, info);
    return info;
  }

  /**
   * Looks a class up by its registered id.
   *
   * @param typeId - The namespaced id.
   * @returns The class, or `null` when nothing is registered under the id.
   */
  get(typeId: string): ComponentType | null {
    return this.#byTypeId.get(typeId) ?? null;
  }

  /**
   * Reports whether a class was registered explicitly.
   *
   * @param type - The component class.
   * @returns `true` when the class was registered under a type id.
   */
  isRegistered(type: ComponentType): boolean {
    const id = readStatics(type).typeId;
    return id !== undefined && this.#byTypeId.get(id) === type;
  }

  /**
   * The id a component must carry to be written to a file.
   *
   * @param type - The component class.
   * @returns The registered id.
   * @throws IgnifxError with code `IGX-0204` when the class declares no `typeId`.
   */
  requireTypeId(type: ComponentType): string {
    const id = readStatics(type).typeId;
    if (id === undefined || id === "") {
      throw new IgnifxError(
        CoreErrorCode.componentTypeIdMissing,
        `${type.prototype.constructor.name} cannot be serialized because it has no typeId.`,
        {
          context: { component: type.prototype.constructor.name },
          hint: 'Add `static typeId = "<package-or-game>/<Name>"` and register the class.',
        },
      );
    }
    return id;
  }

  /**
   * Computes a class's info.
   *
   * @param type - The component class.
   * @returns The freshly built info.
   */
  #build(type: ComponentType): ComponentClassInfo {
    const statics = readStatics(type);
    const ancestors = collectAncestors(type);
    const schema = statics.schema ?? null;
    const isScript = ancestors.includes(Script);
    const classIndex = this.#nextClassIndex;
    this.#nextClassIndex += 1;
    return {
      type,
      typeId: statics.typeId ?? null,
      schema,
      requires: statics.requires ?? EMPTY_TYPES,
      allowMultiple: statics.allowMultiple ?? true,
      ancestors,
      trackedFields: schema === null ? EMPTY_NAMES : collectTrackedFields(schema),
      isScript,
      script: isScript ? buildScriptInfo(type) : null,
      classIndex,
    };
  }
}

/** Shared empty lists so the common case allocates nothing. */
const EMPTY_TYPES: readonly ComponentType[] = Object.freeze([]);

/** Shared empty name list. */
const EMPTY_NAMES: readonly string[] = Object.freeze([]);

/**
 * Walks a class's prototype chain once, collecting every component class it derives from.
 *
 * @param type - The component class.
 * @returns The class itself first, then each ancestor, ending at `Component`.
 */
function collectAncestors(type: ComponentType): readonly ComponentType[] {
  const ancestors: ComponentType[] = [];
  let current: ComponentType | null = type;
  while (current !== null) {
    ancestors.push(current);
    if (current === Component) {
      break;
    }
    // The invariant is that every constructor on a component class's prototype chain is itself a
    // component class; the chain starts at one and the loop stops at `Component`.
    const parent: unknown = Object.getPrototypeOf(current);
    current = typeof parent === "function" ? parent : null;
  }
  return ancestors;
}

/**
 * Finds the schema fields the reference tracker has to watch.
 *
 * @param schema - The class's declared fields.
 * @returns The names of the `entityRef` and `componentRef` fields, in declaration order.
 */
function collectTrackedFields(schema: Schema): readonly string[] {
  const names: string[] = [];
  for (const entry of Object.entries(schema)) {
    const field: FieldDefinition<unknown> = entry[1];
    if (field.kind === "entityRef" || field.kind === "componentRef") {
      names.push(entry[0]);
    }
  }
  return names.length === 0 ? EMPTY_NAMES : names;
}

/**
 * Inspects a script class's prototype once, recording which callbacks it implements.
 *
 * @param type - The script class.
 * @returns The ordering values and the callback bit mask.
 */
function buildScriptInfo(type: ComponentType): ScriptClassInfo {
  const statics = readStatics(type);
  let callbacks = 0;
  const prototype = type.prototype;
  for (let kind = 0; kind < SCRIPT_CALLBACK_COUNT; kind += 1) {
    const name = SCRIPT_CALLBACK_NAMES[kind];
    if (name !== undefined && readCallback(prototype, name) !== null) {
      callbacks |= 1 << kind;
    }
  }
  return {
    executionOrder: statics.executionOrder ?? 0,
    updateWhenPaused: statics.updateWhenPaused ?? false,
    callbacks,
  };
}

/**
 * Widens a class token to the structural statics a component or script class may declare
 * (`ComponentStatics` / `ScriptStatics`). Every one of them is optional, so the widening is a plain
 * assignment, not an assertion. This is the **only** place the engine reads a static off a class:
 * everything else goes through the {@link ComponentClassInfo} this registry caches.
 *
 * @param type - The component class.
 * @returns The same class, seen as its declarable statics.
 */
function readStatics(type: ComponentType): ScriptStatics {
  return type;
}

/**
 * Reports whether a class implements a callback, from its cached bit mask.
 *
 * @param info - The class info, or `null` for a plain component.
 * @param kind - The callback ordinal.
 * @returns `true` when the class implements the callback.
 *
 * @internal
 */
export function implementsCallback(info: ScriptClassInfo | null, kind: number): boolean {
  return info !== null && (info.callbacks & (1 << kind)) !== 0;
}
