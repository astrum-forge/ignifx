/**
 * Reading the two hot-reload statics off a component class
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
 *
 * They are structural and optional, like every other component static
 * (`03-scripting-and-components.md` §1), so reading them is a widening rather than an assertion —
 * this file is the only place in the feature that looks at a class's statics directly.
 */

import type { HotReloadPolicy, HotReloadStatics } from "./contract.js";
import type { ComponentType, ConcreteComponentType } from "../component/component-type.js";

/**
 * Widens a class token to the hot-reload statics it may declare.
 *
 * @param type - The component class.
 * @returns The same class, seen as {@link HotReloadStatics}.
 */
function readStatics(type: ComponentType): ComponentType & HotReloadStatics {
  return type;
}

/**
 * The policy a class declares, defaulting to `"patch"`.
 *
 * @param type - The component class.
 * @returns `"recreate"` only when the class declares it.
 *
 * @internal
 */
export function declaredPolicy(type: ComponentType): HotReloadPolicy {
  return readStatics(type).hotReload === "recreate" ? "recreate" : "patch";
}

/**
 * The class-level migration hook, when the class implements one.
 *
 * @param type - The replacement class.
 * @returns The bound-free function, or `null`.
 *
 * @internal
 */
export function migrationHook(type: ComponentType): ((previous: ConcreteComponentType) => void) | null {
  // The hook is deliberately handed back unbound: the caller invokes it with `.call(newClass, …)`
  // so that `this` inside a `static onHotReload` is the class that declares it, which is the whole
  // point of a class-level migration hook.
  // oxlint-disable-next-line typescript/unbound-method -- see above.
  const hook = readStatics(type).onHotReload;
  return typeof hook === "function" ? hook : null;
}
