import type { Component } from "./component.js";
import type { Schema } from "../schema/types.js";

/**
 * How component *classes* are named in APIs (`docs/architecture/03-scripting-and-components.md`
 * §1). Two shapes, because two things are being expressed: a class you can query with, and a class
 * the engine can construct.
 */

/**
 * The static members a component class may declare, as *structural*, optional properties
 * (`docs/architecture/03-scripting-and-components.md` §1). They are deliberately not declared on
 * the `Component` class: a static declared on the base class would make every
 * `static typeId = "mygame/Mover"` an override and force the `override` keyword on it under
 * `noImplicitOverride` (coding standards §3). Declaring the shape here instead means a plain
 * `static typeId` on a subclass satisfies it structurally, and the registry supplies the defaults.
 *
 * @example
 * ```ts
 * class Mover extends Script.define({ speed: f32(5) }) {
 *   static typeId = "mygame/Mover";
 * }
 * ```
 *
 * @public
 */
export interface ComponentStatics {
  /**
   * The namespaced registration id (`<package-or-game>/<Name>`), required for any component that is
   * serialized (`docs/architecture/03-scripting-and-components.md` §4). It is explicit, never
   * derived from the class name, so minification and renames cannot change a file's meaning.
   */
  readonly typeId?: string;
  /** The serialized field declarations, set by `Component.define` / `Script.define`. */
  readonly schema?: Schema;
  /** Component types auto-added to, and validated on, any entity this one is attached to. */
  readonly requires?: readonly ComponentType[];
  /** `false` when at most one instance may be attached to an entity; defaults to `true`. */
  readonly allowMultiple?: boolean;
}

/**
 * The static members a script class may declare: everything {@link ComponentStatics} allows plus
 * the two scheduling flags (`docs/architecture/01-lifecycle-and-time.md` §3). Structural and
 * optional for the reason given on {@link ComponentStatics}.
 *
 * @public
 */
export interface ScriptStatics extends ComponentStatics {
  /**
   * Lower runs first within a phase; ties break on creation order. Core systems use
   * `[-1000, 1000]`. Defaults to `0`.
   */
  readonly executionOrder?: number;
  /**
   * When `true`, the script still receives `update`/`lateUpdate` while `app.pause()` is in effect.
   * Defaults to `false`.
   */
  readonly updateWhenPaused?: boolean;
}

/**
 * A component class used as a **query token** — `entity.getComponent(Type)`,
 * `world.components(Type)`, `componentRef(Type)`. Abstract classes qualify, which is what makes
 * `getComponent(Script)` legal (`docs/architecture/02-scene-graph.md` §4).
 *
 * @typeParam T - The component instance type the token stands for.
 *
 * @example
 * ```ts
 * function first<T extends Component>(entity: Entity, type: ComponentType<T>): T | null {
 *   return entity.getComponent(type);
 * }
 * ```
 *
 * @public
 */
export interface ComponentType<T extends Component = Component> extends ComponentStatics {
  /** The instance shape the token names. */
  readonly prototype: T;
}

/**
 * A component class the engine can construct: everything {@link ComponentType} requires plus a
 * no-argument constructor. `entity.addComponent` and `app.registerComponents` take this shape,
 * because both have to be able to `new` the class.
 *
 * @typeParam T - The component instance type.
 *
 * @public
 */
export interface ConcreteComponentType<T extends Component = Component> extends ComponentType<T> {
  /**
   * Constructs an instance. Components are constructed by the engine only: initial values come from
   * schema defaults, then from the file or the `init` object.
   */
  new (): T;
}

/**
 * The values `entity.addComponent(Type, init)` accepts: the component's serialized fields, each
 * optional. Engine-owned members (`entity`, `enabled`, …) and methods are excluded, so an `init`
 * object can only set declared data.
 *
 * @typeParam T - The component instance type.
 *
 * @example
 * ```ts
 * entity.addComponent(Mover, { speed: 12, label: "hero" });
 * ```
 *
 * @public
 */
export type ComponentInit<T extends Component> = {
  readonly [
    K in keyof T as K extends keyof Component
      ? never
      : NonNullable<T[K]> extends (...args: never[]) => unknown
        ? never
        : K
  ]?: T[K];
};
