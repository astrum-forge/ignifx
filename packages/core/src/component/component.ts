import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { Signal } from "../signal/signal.js";
import { COMPONENT_INTERNALS, componentInternals, createComponentInternals } from "./internals.js";
import type { ComponentType } from "./component-type.js";
import type { ComponentInternals } from "./internals.js";
import type { App } from "../app/types.js";
import type { Entity } from "../entity/entity.js";
import type { ComponentHandle } from "../handles/handle.js";
import type { FieldsOf, Schema } from "../schema/types.js";
import type { SignalOwner } from "../signal/signal.js";
import type { Transform } from "../transform/transform.js";
import type { World } from "../world/world.js";

/**
 * Typed data and behaviour attached to an entity
 * (`docs/architecture/03-scripting-and-components.md` §1). Engine-owned components
 * (`MeshRenderer`, `Rigidbody`, `AudioSource`) are plain `Component`s driven by systems; game
 * behaviour extends `Script`, which adds the frame lifecycle.
 *
 * @remarks
 * A component class must have a no-argument constructor: the engine constructs it, then assigns
 * `entity`, `uid`, and `handle`, then applies schema defaults and the `init` object, then calls
 * `onAttach`. Reading `this.entity` from a constructor therefore throws `IGX-0206`; cache lookups
 * in `onAttach` or `awake` instead.
 *
 * **Where the statics are declared.** `typeId`, `schema`, `requires`, and `allowMultiple` are not
 * members of this class. Declaring them here would make every `static typeId = "mygame/Mover"` an
 * override and force the `override` keyword on it under `noImplicitOverride` (coding standards §3)
 * — the same reasoning that keeps the callbacks on {@link ComponentHooks}. The shape lives on
 * {@link ComponentStatics} instead, and `ComponentRegistry` reads it once per class and supplies
 * the defaults (`allowMultiple` is `true` when the class declares nothing).
 *
 * @example
 * ```ts
 * class Health extends Component.define({ maximum: f32(100) }) {
 *   static typeId = "mygame/Health";
 *   current = 0;
 *   onAttach(): void {
 *     this.current = this.maximum;
 *   }
 * }
 * ```
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- the merged interface below declares one engine-owned property that the constructor always assigns.
export abstract class Component implements SignalOwner {
  /** Creates a component. The engine constructs components; game code never calls `new`. */
  constructor() {
    this[COMPONENT_INTERNALS] = createComponentInternals();
  }

  /**
   * Declares a component's serialized fields and returns the base class to extend (ADR-0004,
   * `docs/architecture/03-scripting-and-components.md` §3). The returned class exposes every field
   * as a typed instance property, applies the defaults in its constructor, and carries the schema
   * for the serializer, the inspector, and the docs harness.
   *
   * @typeParam S - The schema being declared.
   * @param schema - The field definitions, keyed by the property name they become.
   * @returns An abstract class to extend.
   * @throws IgnifxError with code `IGX-0607` when a field name is not identifier-like or collides
   * with a `Component`/`Script` member.
   *
   * @example
   * ```ts
   * class Spinner extends Component.define({
   *   degreesPerSecond: f32(90, { min: -360, max: 360 }),
   *   axis: vec3({ x: 0, y: 1, z: 0 }),
   * }) {
   *   static typeId = "mygame/Spinner";
   * }
   * ```
   */
  static define<const S extends Schema>(schema: S): ComponentDefinition<S> {
    const fields = defineSchema(schema);
    abstract class Defined extends Component {
      static schema: Schema = fields;

      constructor() {
        super();
        Object.assign(this, createDefaults(fields));
      }
    }
    // Boundary assertion (coding standards §5.2). The invariant: `Defined`'s constructor assigns
    // exactly the schema's keys with values built by each field's own `createDefault`, so an
    // instance really does have `FieldsOf<S>`. TypeScript cannot express "this class gains the
    // properties of a value known only at run time", so the shape is asserted once, here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Defined as unknown as ComponentDefinition<S>;
  }

  /**
   * The stable ULID; the key files use to reference this component.
   *
   * @returns The identifier.
   */
  get uid(): string {
    return this.#attached().uid;
  }

  /**
   * The dense runtime handle; invalid after destruction.
   *
   * @returns The handle.
   */
  get handle(): ComponentHandle {
    return this.#attached().handle;
  }

  /**
   * The entity this component is attached to.
   *
   * @returns The owning entity.
   */
  get entity(): Entity {
    const entity = this.#attached().entity;
    if (entity === null) {
      throw notAttached(this);
    }
    return entity;
  }

  /**
   * The entity's transform — sugar for `this.entity.transform`, the most-used lookup there is.
   *
   * @returns The entity's transform.
   */
  get transform(): Transform {
    return this.entity.transform;
  }

  /**
   * The world the entity belongs to.
   *
   * @returns The world.
   */
  get world(): World {
    return this.entity.world;
  }

  /**
   * The app that owns the world.
   *
   * @returns The app.
   */
  get app(): App {
    return this.entity.world.app;
  }

  /**
   * The component's own enabled flag; `true` by default. Setting it runs the enable or disable
   * transition (`docs/architecture/01-lifecycle-and-time.md` §6): `onDisable` runs immediately,
   * `awake`/`onEnable` run in the next lifecycle flush — or immediately and nested when the change
   * happens inside a callback.
   *
   * @returns `true` when the component's own flag is set.
   */
  get enabled(): boolean {
    return componentInternals(this).enabled;
  }

  set enabled(value: boolean) {
    const internals = componentInternals(this);
    if (internals.enabled === value) {
      return;
    }
    if (internals.isDestroyed) {
      throw new IgnifxError(CoreErrorCode.mutationAfterDestroy, "This component has been destroyed.", {
        context: { target: "component", uid: internals.uid, operation: "enabled" },
      });
    }
    internals.enabled = value;
    const entity = internals.entity;
    if (entity !== null) {
      entity.world.lifecycle.refreshEnabled(this);
    }
  }

  /**
   * `true` when the component's own flag is set **and** its entity is active in the hierarchy.
   *
   * @returns `true` when the component is effectively enabled.
   */
  get isEnabledInHierarchy(): boolean {
    const internals = componentInternals(this);
    const entity = internals.entity;
    return internals.enabled && !internals.isDestroyed && entity !== null && entity.activeInHierarchy;
  }

  /**
   * `true` from the moment `destroy()` is called, long before the destroy flush runs.
   *
   * @returns `true` once the component has been queued for destruction.
   */
  get isDestroyed(): boolean {
    return componentInternals(this).isDestroyed;
  }

  /**
   * Emitted once when the component is destroyed, in the destroy flush. Connecting with
   * `{ owner: this }` elsewhere uses it to detach handlers automatically
   * (`docs/architecture/02-scene-graph.md` §8).
   *
   * @returns The signal. It is created on first access, so a component nobody listens to allocates
   * nothing.
   */
  get onDestroyed(): Signal<Component> {
    const internals = componentInternals(this);
    internals.onDestroyed ??= new Signal<Component>();
    return internals.onDestroyed;
  }

  /**
   * Queues this component for destruction. It stays usable until the destroy flush of the current
   * frame, but reports `isDestroyed === true` immediately
   * (`docs/architecture/01-lifecycle-and-time.md` §6). Calling it twice is a no-op.
   */
  destroy(): void {
    const internals = componentInternals(this);
    const entity = internals.entity;
    if (entity === null) {
      internals.isDestroyed = true;
      return;
    }
    entity.removeComponent(this);
  }

  /**
   * Finds another component on the same entity — sugar for `this.entity.getComponent`.
   *
   * @typeParam T - The component type to look for.
   * @param type - The component class; matching is by class identity **and** inheritance.
   * @returns The first match in attach order, or `null`.
   */
  getComponent<T extends Component>(type: ComponentType<T>): T | null {
    return this.entity.getComponent(type);
  }

  /**
   * Finds another component on the same entity, requiring it to be there — the supported way to
   * link components (`docs/architecture/03-scripting-and-components.md` §8).
   *
   * @typeParam T - The component type to look for.
   * @param type - The component class.
   * @returns The first match in attach order.
   * @throws IgnifxError with code `IGX-0201` when the entity has no such component.
   */
  requireComponent<T extends Component>(type: ComponentType<T>): T {
    return this.entity.requireComponent(type);
  }

  /**
   * The engine state, with the "attached" invariant checked once.
   *
   * @returns The internals.
   */
  #attached(): ComponentInternals {
    const internals = componentInternals(this);
    if (internals.entity === null) {
      throw notAttached(this);
    }
    return internals;
  }
}

/**
 * The engine-owned state of a component, declared through interface merging.
 *
 * @remarks
 * A symbol-keyed *class field* is rejected by `isolatedDeclarations` (coding standards §3), which
 * cannot infer a computed property name; declaring it on the merged interface states the type
 * explicitly and emits cleanly. The property is unreachable from game code, which has no way to
 * name the symbol, and cannot collide with a schema field.
 *
 * @public
 */
// Merging is deliberate and safe here: the class constructor assigns the one property the
// interface declares, so it is always initialised. A symbol-keyed class field would be cleaner
// still, but `isolatedDeclarations` rejects computed property names on classes.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see the note above
export interface Component {
  /**
   * The engine-owned state.
   *
   * @internal
   */
  [COMPONENT_INTERNALS]: ComponentInternals;
}

/**
 * The optional hooks every component may implement
 * (`docs/architecture/03-scripting-and-components.md` §1).
 *
 * @remarks
 * They are declared here rather than on `Component` for the reason spelled out on
 * `ScriptCallbacks`: a member declared on the base class would force every implementation to carry
 * an `override` modifier under `noImplicitOverride` (coding standards §3). Write
 * `implements ComponentHooks` to have the signatures checked.
 *
 * @public
 */
export interface ComponentHooks {
  /**
   * Runs after the component's fields are assigned and before `awake`. It may run while the entity
   * is inactive, so it must not assume the component is enabled.
   */
  onAttach?(): void;
  /** Runs just before the component is removed, after `onDestroy`. */
  onDetach?(): void;
}

/**
 * The abstract base class `Component.define` returns: a `Component` that also carries every
 * field the schema declares, typed.
 *
 * @typeParam S - The schema the class was defined from.
 *
 * @public
 */
export type ComponentDefinition<S extends Schema> = (abstract new () => Component & FieldsOf<S>) & {
  /** The instance shape, so the class satisfies `ComponentType`. */
  readonly prototype: Component & FieldsOf<S>;
  /**
   * The schema the class was defined from, carried as a value on the returned class. The other
   * statics ({@link ComponentStatics}) are deliberately *not* declared here: a subclass must be
   * able to write a plain `static typeId` without the `override` keyword.
   */
  readonly schema: S;
};

/**
 * Builds the "used before the engine attached it" error.
 *
 * @param component - The component that was read too early.
 * @returns The error to throw.
 */
function notAttached(component: Component): IgnifxError {
  return new IgnifxError(
    CoreErrorCode.componentNotAttached,
    `${component.constructor.name} is not attached to an entity yet.`,
    {
      context: { component: component.constructor.name },
      hint: "The engine assigns entity, uid, and handle after construction; read them in onAttach or awake.",
    },
  );
}
