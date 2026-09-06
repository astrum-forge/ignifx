import { ANIMATOR_ASSET_TYPE } from "./definition.js";
import type { AnimatorDefinition, AnimatorLayerDefinition, AnimatorStateDefinition } from "./definition.js";

/**
 * The loaded `.animator.json` document (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * The asset is pure data and carries no device resources, so it loads identically under a headless
 * app and needs no `unload` — the reference-counted cache drops it when the last `Animator` lets
 * go. Two animators sharing one document share this object and build their own state machines from
 * it, which is what makes the document the single source of truth for both.
 */

/**
 * A parsed animator document.
 *
 * @example
 * ```ts
 * const handle = app.assets.load<AnimatorAsset>("3d/hero.animator.json").retain();
 * await handle.promise;
 * handle.value?.stateNames; // ["idle", "locomotion", "jump"]
 * ```
 *
 * @public
 */
export class AnimatorAsset {
  /** The asset type name, so `assetRef` and the inspector can round-trip a reference. */
  static assetType: string = ANIMATOR_ASSET_TYPE;

  /** Where the document was loaded from. */
  readonly address: string;

  /** The parsed document. */
  readonly definition: AnimatorDefinition;

  /**
   * Wraps a parsed document.
   *
   * @param address - Where it came from.
   * @param definition - The parsed document.
   */
  constructor(address: string, definition: AnimatorDefinition) {
    this.address = address;
    this.definition = definition;
  }

  /**
   * Every state name the document declares, in declaration order.
   *
   * @returns Every state name the document declares, in declaration order.
   */
  get stateNames(): readonly string[] {
    return this.definition.states.map((state) => state.name);
  }

  /**
   * Every layer name the document declares, base first.
   *
   * @returns Every layer name the document declares, base first.
   */
  get layerNames(): readonly string[] {
    return this.definition.layers.map((layer) => layer.name);
  }

  /**
   * Finds a state by name.
   *
   * @param name - The state's name.
   * @returns The declaration, or `null`.
   */
  state(name: string): AnimatorStateDefinition | null {
    return this.definition.states.find((state) => state.name === name) ?? null;
  }

  /**
   * Finds a layer by name.
   *
   * @param name - The layer's name.
   * @returns The declaration, or `null`.
   */
  layer(name: string): AnimatorLayerDefinition | null {
    return this.definition.layers.find((layer) => layer.name === name) ?? null;
  }

  /**
   * Every animation-group name the document plays, across every state and blend tree.
   *
   * @returns The clip names, without duplicates.
   */
  clipNames(): readonly string[] {
    const names = new Set<string>();
    for (const state of this.definition.states) {
      if (state.clip !== "") {
        names.add(state.clip);
      }
    }
    for (const tree of this.definition.blendTrees1D) {
      for (const child of tree.children) {
        names.add(child.clip);
      }
    }
    return [...names];
  }
}
