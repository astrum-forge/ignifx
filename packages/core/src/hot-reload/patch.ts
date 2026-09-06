/**
 * The `"patch"` policy: the default hot reload
 * (`docs/architecture/15-devtools-and-diagnostics.md` §5).
 *
 * Every live instance keeps its identity, its uid, its handle, its serial, its enable state, its
 * running coroutines, and every field value it holds; only the prototype changes, so the next call
 * to any method runs the new code. No lifecycle callback re-runs — not `awake`, not `onEnable`, not
 * `start` — which is exactly what makes it the policy to iterate logic with.
 *
 * Prototype mutation is banned everywhere else in the engine (coding standards §5.3 exempts the hot
 * reload patcher by name). It is sound here because the swap is a flush-time operation: the host
 * refuses to run inside a lifecycle callback, so no callback ever observes a half-swapped world.
 *
 * What still has to be re-filed by hand, because it is keyed on the *class*:
 *
 * - the per-type buckets behind `world.components(Type)` — a swapped instance leaves its old class's
 *   bucket and joins the new one, while the shared `Script` and `Component` buckets are untouched;
 * - the sorted dispatch lists, because `executionOrder` and the implemented-callback mask are both
 *   read from the class;
 * - the tracked-reference watch list, because `entityRef`/`componentRef` fields are found from the
 *   class's schema.
 */

import { componentInternals } from "../component/internals.js";
import type { ComponentClassInfo } from "../component/component-registry.js";
import type { Component } from "../component/component.js";
import type { World } from "../world/world.js";

/**
 * Swaps live instances onto a replacement class.
 *
 * @param world - The world the instances live in.
 * @param previous - The class info they were filed under.
 * @param next - The replacement's class info, already registered.
 * @param instances - The instances to swap; a snapshot, because the store buckets are rewritten.
 * @returns How many instances were swapped.
 *
 * @internal
 */
export function patchInstances(
  world: World,
  previous: ComponentClassInfo,
  next: ComponentClassInfo,
  instances: readonly Component[],
): number {
  const store = world.store;
  const references = world.references;
  const lifecycle = world.lifecycle;
  let swapped = 0;
  for (let index = 0; index < instances.length; index += 1) {
    const component = instances[index];
    if (component === undefined) {
      continue;
    }
    const state = componentInternals(component);
    if (state.isReleased) {
      continue;
    }
    // The one sanctioned prototype mutation (coding standards §5.3): the object keeps its identity
    // and its data, and gains the replacement class's methods.
    Object.setPrototypeOf(component, next.type.prototype);
    store.remove(component, previous);
    state.info = next;
    store.add(component, next);
    lifecycle.rebindDispatch(component, previous.script, next.script);
    references.unwatch(component);
    references.watch(component);
    swapped += 1;
  }
  return swapped;
}
