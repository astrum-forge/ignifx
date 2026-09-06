import { Model, Script, str } from "@ignifx/core";
import type { Entity, ScriptCallbacks } from "@ignifx/core";

/**
 * Parents an entity under one of a model's glTF nodes — the "weapon in hand" case.
 *
 * ## Why this needs a script at all
 *
 * `Model` does not instantiate its container when the component is added: it clones the loaded
 * asset on its **first sync**, in `PreRender`, once the handle has decoded. `Model.nodes` is empty
 * until then, so calling `attachToNode` straight after `addComponent` always answers `false`. This
 * script retries once per frame and then switches itself off, which is two lines and needs no
 * signal.
 *
 * ## What it costs afterwards
 *
 * Nothing. `attachToNode` re-parents the attached entity's scene node under the glTF node, and Lite
 * composes `parentWorld × local` on every read — so the prop follows the bone with no per-frame
 * work of ignifx's own.
 */
export class AttachToHand
  extends Script.define({
    /** The glTF node to attach to, as the file spells it. */
    nodeName: str("hand"),
  })
  implements ScriptCallbacks
{
  static typeId = "first-person/AttachToHand";

  /** The entity to attach. Assigned right after the component is added. */
  prop: Entity | null = null;

  update(): void {
    const model = this.entity.getComponent(Model);
    const prop = this.prop;
    if (model === null || prop === null || prop.isDestroyed) {
      return;
    }
    if (model.attachToNode(this.nodeName, prop)) {
      this.app.log.debug("attached {prop} to {node}", prop.name, this.nodeName);
      // The job is done once and for all: the parenting survives, so the script switches off
      // rather than asking the node map for a name it has already found.
      this.enabled = false;
    }
  }
}
