import { Component, f32 } from "@ignifx/core";
import type { Entity, SceneFile } from "@ignifx/core";

/**
 * The street of the hot-reloaded defaults tests (engine ask E25): lamps whose `brightness` the
 * document leaves out or sets, and a lamp post prefab instance with an override.
 */

/** The prefab's address. */
export const PREFAB = "prefabs/lamp-post.prefab.json";

/** The script as the project first has it. */
export class Lamp extends Component.define({ brightness: f32(1), radius: f32(2) }) {
  static typeId = "game/Lamp";
}

/** The same script after an edit that changes `brightness`'s default. */
export class LampBrighter extends Component.define({ brightness: f32(4), radius: f32(2) }) {
  static typeId = "game/Lamp";
}

/** A lamp post: its root's lamp leaves `brightness` out, the bulb sets it, the spare leaves it out. */
export const LAMP_POST: SceneFile = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "Lamp Post",
  entities: [
    {
      uid: "POST",
      name: "Post",
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "POST-LAMP", type: "game/Lamp", props: {} }],
    },
    {
      uid: "BULB",
      name: "Bulb",
      parent: "POST",
      transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "BULB-LAMP", type: "game/Lamp", props: { brightness: 3 } }],
    },
    {
      uid: "SPARE",
      name: "Spare",
      parent: "POST",
      transform: { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "SPARE-LAMP", type: "game/Lamp", props: {} }],
    },
  ],
};

/**
 * The level: a lamp that leaves `brightness` out, one that sets it to the old default, and a lamp
 * post whose spare lamp the instance overrides, with a document child that leaves it out.
 *
 * @param hash - The prefab's hash.
 * @returns The scene file.
 */
export function level(hash: string): SceneFile {
  const at = { rotation: [0, 0, 0, 1], scale: [1, 1, 1] } as const;
  return {
    format: "ignifx.scene",
    formatVersion: 1,
    name: "street",
    entities: [
      {
        uid: "OMITS",
        name: "Omits",
        parent: null,
        transform: { position: [0, 0, 0], ...at },
        components: [{ uid: "OMITS-LAMP", type: "game/Lamp", props: { radius: 5 } }],
      },
      {
        uid: "SETS",
        name: "Sets",
        parent: null,
        transform: { position: [2, 0, 0], ...at },
        components: [{ uid: "SETS-LAMP", type: "game/Lamp", props: { brightness: 1 } }],
      },
      {
        uid: "STREET-POST",
        name: "Lamp Post",
        parent: null,
        transform: { position: [4, 0, 0], ...at },
        instance: {
          scene: { $asset: PREFAB },
          hash,
          overrides: [{ path: "SPARE/components/SPARE-LAMP/props/brightness", value: 7 }],
        },
      },
      {
        uid: "SIGN",
        name: "Sign",
        parent: "STREET-POST",
        transform: { position: [0, 3, 0], ...at },
        components: [{ uid: "SIGN-LAMP", type: "game/Lamp" }],
      },
    ],
  };
}

/**
 * The `brightness` a live lamp holds.
 *
 * @param roots - The world's scene roots.
 * @param post - The lamp post's live root, or `null`.
 * @param uid - The component's uid, or the name of a prefab member under the lamp post.
 * @returns The value.
 */
export function brightnessIn(roots: readonly Entity[], post: Entity | null, uid: string): unknown {
  const member = [post, ...(post?.children ?? [])].find((entity) => entity?.name === uid) ?? null;
  const components = member === null ? everyComponent(roots) : member.components;
  const component = components.find(
    (candidate) => "brightness" in candidate && (member !== null || candidate.uid === uid),
  );
  if (component === undefined) {
    throw new Error(`No lamp ${uid}.`);
  }
  return Reflect.get(component, "brightness");
}

/**
 * Every component in some subtrees.
 *
 * @param roots - The subtrees' roots.
 * @returns Their components.
 */
function everyComponent(roots: readonly Entity[]): Component[] {
  return roots.flatMap((entity) => [...entity.components, ...everyComponent(entity.children)]);
}
