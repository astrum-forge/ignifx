/**
 * Dense runtime identity (`docs/architecture/00-overview.md` §5). A handle is a plain number so it
 * costs nothing to store, pass, or put in a typed array, and it is branded so that an entity handle
 * and a component handle can never be confused at compile time.
 */

/**
 * The dense runtime id of an entity. Valid until the entity is destroyed; a handle that outlives
 * its entity resolves to `null` through `world.getEntityByHandle` rather than to whatever object
 * recycled the slot.
 *
 * @remarks
 * The `__brand` property exists only in the type system — a handle is a `number` at runtime — so a
 * handle can be stored in a `Float64Array` or written into Lite's node metadata unchanged.
 *
 * @example
 * ```ts
 * const handle: EntityHandle = entity.handle;
 * world.getEntityByHandle(handle)?.destroy();
 * ```
 *
 * @public
 */
export type EntityHandle = number & { readonly __brand: "EntityHandle" };

/**
 * The dense runtime id of a component, with the same lifetime rules as {@link EntityHandle}.
 *
 * @public
 */
export type ComponentHandle = number & { readonly __brand: "ComponentHandle" };

/**
 * The handle value that never resolves. Allocated handles always carry a generation of at least
 * one, so zero is unreachable and doubles as "no handle".
 *
 * @public
 */
export const INVALID_HANDLE = 0;

/**
 * Brands a raw allocator handle as an entity handle.
 *
 * @param value - The number {@link HandleAllocator.allocate} returned.
 * @returns The same number, typed as an entity handle.
 *
 * @internal
 */
export function toEntityHandle(value: number): EntityHandle {
  // Boundary assertion (coding standards §5.2): the brand is a compile-time marker with no runtime
  // representation, so branding is the identity function and this is the one place it happens.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as EntityHandle;
}

/**
 * Brands a raw allocator handle as a component handle.
 *
 * @param value - The number {@link HandleAllocator.allocate} returned.
 * @returns The same number, typed as a component handle.
 *
 * @internal
 */
export function toComponentHandle(value: number): ComponentHandle {
  // Boundary assertion (coding standards §5.2); see `toEntityHandle`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as ComponentHandle;
}
