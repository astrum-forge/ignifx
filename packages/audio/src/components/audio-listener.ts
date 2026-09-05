import { defineSchema, Script } from "@ignifx/core";
import type { LiteSpatialTarget } from "../lite/types.js";
import type { Schema, ScriptCallbacks } from "@ignifx/core";

/**
 * `AudioListener` (`docs/architecture/10-audio.md` §4): the ears. Put one on the camera entity and
 * every spatial `AudioSource` is heard from there.
 *
 * ## Why it extends `Script` rather than `Component`
 *
 * `10-audio.md` §4 does not say, and §3 shows `AudioSource` as a plain `Component`. It cannot be
 * one: this kernel delivers `awake`, `onEnable`, and `onDisable` only to classes that derive from
 * `Script` (`packages/core/src/lifecycle/lifecycle-queue.ts`, `invokeCallback` returns early when
 * `info.script` is `null`), and a listener has to know when it becomes the active one. The same
 * argument applies to `AudioSource`, whose `playOnAwake` is defined in terms of `awake` — and it is
 * `awake`, not `onAttach`, that runs after a scene file's props have been decoded
 * (`06-serialization-and-scene-format.md` §4).
 *
 * ## Selection
 *
 * The most recently enabled listener wins, which during a scene load is the one with the highest
 * creation serial. Disabling it hands the ears back to the previous one. With no listener enabled
 * at all, spatial sources are heard from the world origin and `IGX-1002` is logged once — Babylon
 * Lite builds a listener at the origin on first use either way
 * (`lib/audio/spatial.js`, `ensureSpatialSubNode`).
 */

/**
 * The listener spatial audio is heard from.
 *
 * @example
 * ```ts
 * const camera = world.createEntity("Main Camera");
 * camera.addComponent(Camera);
 * camera.addComponent(AudioListener);
 * ```
 *
 * @public
 */
export class AudioListener extends Script implements ScriptCallbacks {
  /** The registration id the serializer and the inspector know this class by. */
  static typeId = "ignifx/AudioListener";

  /** One pair of ears per entity. */
  static allowMultiple = false;

  /**
   * The serialized field declarations (ADR-0004). A listener has none: which listener is active is
   * decided by which one is enabled, and a scene file records that on the component itself.
   */
  static schema: Schema = defineSchema({});

  /**
   * The world transform Lite's spatial listener follows: this entity's node
   * (`setSpatialListener(engine, { attachedTo })`, `index.d.ts` 11008).
   *
   * @returns The entity's Lite node, which exposes the `worldMatrix` a `SpatialTarget` needs.
   */
  get spatialTarget(): LiteSpatialTarget {
    return this.transform.lite;
  }

  /** Becomes the active listener. */
  onEnable(): void {
    this.app.audio.registerListener(this);
  }

  /** Hands the ears back to whichever listener was active before this one. */
  onDisable(): void {
    this.app.audio.unregisterListener(this);
  }
}
