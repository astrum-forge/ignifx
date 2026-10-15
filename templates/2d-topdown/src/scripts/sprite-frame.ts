import { SpriteRenderer } from "@ignifx/2d";
import { Script, str } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * Picks the atlas frame a `SpriteRenderer` on the same entity draws, by name.
 *
 * ## Why this is a script
 *
 * `SpriteRenderer.frame` is a runtime property, not a schema field, so a scene file cannot say which
 * frame a still sprite shows — and the `#frame:` address fragment the 2D docs describe is not read
 * by the renderer. This script is the scene-file form of the old `sprite.frame =
 * atlas.requireFrame(name)`: the frame's **name** is a field the scene stores, and `awake` turns it
 * into an index once the atlas has loaded, which it has by then, because the scene loader resolves
 * every asset a file names before it builds an entity.
 *
 * A sprite driven by a `SpriteAnimator` needs none of this; the animator writes the frame itself.
 */
export class SpriteFrame
  extends Script.define({
    /** The atlas frame to draw, as the `.atlas.json` names it. */
    frame: str(""),
  })
  implements ScriptCallbacks
{
  static typeId = "topdown/SpriteFrame";

  awake(): void {
    this.apply();
  }

  /**
   * Writes the named frame into the entity's sprite. A hot reload or an edit to {@link frame} can
   * call it again.
   */
  apply(): void {
    const sprite = this.entity.getComponent(SpriteRenderer);
    const handle = sprite?.sprite ?? null;
    if (sprite === null || handle === null || handle.state !== "loaded" || this.frame === "") {
      return;
    }
    sprite.frame = handle.value.requireFrame(this.frame);
  }
}
