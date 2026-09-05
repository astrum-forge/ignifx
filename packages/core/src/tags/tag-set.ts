/**
 * Free-form grouping labels on an entity (`docs/architecture/02-scene-graph.md` §7). Tags are for
 * grouping and lookup — `world.findByTag` keeps an index over them — never for behaviour dispatch,
 * which is the string-messaging anti-pattern the standard rejects
 * (`docs/architecture/03-scripting-and-components.md` §9).
 */

/**
 * What a {@link TagSet} tells its owner when it changes, so the world can keep its `findByTag`
 * index current.
 *
 * @internal
 */
export type TagSetObserver = (tag: string, added: boolean) => void;

/**
 * The mutable set of tags on one entity.
 *
 * @example
 * ```ts
 * entity.tags.add("enemy");
 * entity.tags.has("enemy"); // true
 * for (const tag of entity.tags) {
 *   console.log(tag);
 * }
 * ```
 *
 * @public
 */
export class TagSet {
  readonly #tags = new Set<string>();

  readonly #observer: TagSetObserver | null;

  /**
   * Creates a tag set.
   *
   * @param observer - Called after every effective add or delete, so the world can maintain its tag
   * index. Entities always pass one; a standalone set can omit it.
   *
   * @internal
   */
  constructor(observer?: TagSetObserver) {
    this.#observer = observer ?? null;
  }

  /**
   * How many tags the entity carries.
   *
   * @returns The tag count.
   */
  get size(): number {
    return this.#tags.size;
  }

  /**
   * Adds a tag. Adding a tag the entity already carries is a no-op.
   *
   * @param tag - The tag.
   * @returns This set, so calls chain.
   */
  add(tag: string): this {
    if (this.#tags.has(tag)) {
      return this;
    }
    this.#tags.add(tag);
    this.#observer?.(tag, true);
    return this;
  }

  /**
   * Reports whether the entity carries a tag.
   *
   * @param tag - The tag.
   * @returns `true` when the tag is present.
   */
  has(tag: string): boolean {
    return this.#tags.has(tag);
  }

  /**
   * Removes a tag.
   *
   * @param tag - The tag.
   * @returns `true` when the tag was present and has been removed.
   */
  delete(tag: string): boolean {
    if (!this.#tags.delete(tag)) {
      return false;
    }
    this.#observer?.(tag, false);
    return true;
  }

  /**
   * Every tag, in insertion order.
   *
   * @returns An iterator over the tags.
   */
  values(): IterableIterator<string> {
    return this.#tags.values();
  }

  /**
   * Every tag, in insertion order, so a tag set can be spread or used in `for…of`.
   *
   * @returns An iterator over the tags.
   */
  [Symbol.iterator](): IterableIterator<string> {
    return this.#tags.values();
  }

  /**
   * Removes every tag, notifying the observer once per tag so indices stay correct.
   *
   * @internal
   */
  clear(): void {
    if (this.#tags.size === 0) {
      return;
    }
    // Snapshot: the observer runs while the set is being drained, and must not see a half-mutated
    // iterator.
    const tags = [...this.#tags];
    this.#tags.clear();
    const observer = this.#observer;
    if (observer !== null) {
      for (let index = 0; index < tags.length; index += 1) {
        const tag = tags[index];
        if (tag !== undefined) {
          observer(tag, false);
        }
      }
    }
  }
}
