# ADR-0039 · Attaching an entity to a model's node in a scene file

**Status:** Proposed · **Date:** 2026-10-20 · **Deciders:** Astrum Forge Studios (owner)

## Context

A scene file cannot parent an entity under a node of a glTF model. A model's nodes are not entities (`07-rendering.md` §2.4), so a file's `parent` cannot name one. `Model.attachToNode(name, entity)` exists, but `Model.nodes` is empty until the model's first sync in `PreRender`. `templates/3d-first-person` therefore keeps its view-model prop as a root entity at the origin, and a script, `AttachToHand`, retries `attachToNode("hand", prop)` every frame until it succeeds (engine PR #52, gap 17). An edit-mode app calls no script (ADR-0028), so the editor shows the prop at the world origin, not in the hand.

Constraints: the ignifx tree owns entities (`CONSTITUTION.md` §3.3), files round-trip (`06-serialization-and-scene-format.md` §1), unused features cost nothing (§2.5), and the editor must show what the game shows.

## Options considered

1. **Expand model nodes into entities.** Every glTF node becomes a child entity, as in Unity, and `parent` works unchanged. The hierarchy panel shows the rig. But a skinned model brings dozens to hundreds of entities, each with a transform to sync (§2.4); whether they are saved needs prefab-like rules; doc 07 already defers this to an `expandToEntities()` tool after 1.0.
2. **A component on the attached entity.** `ModelNodeAttachment { model: componentRef(Model), node: str }`. Core's render sync, which runs in edit mode, calls `attachToNode` once the model's nodes exist, and again if the model is rebuilt. The entity keeps its local transform, now relative to the node. The prop stays a normal entity in the file, and copying it copies the attachment.
3. **A list on the model.** `Model.attachments: [{ node, entity: entityRef }]`. Same mechanics as option 2, kept in one place on the model. But the attachment is then not visible on the prop, and copying the prop loses it.

## Decision

Recommended: option 2. An entity attaches to a model node through a component, resolved by core's render sync, in games and in edit mode alike.

## Consequences

- `AttachToHand` and its retry loop are deleted from the template; the scene carries the attachment.
- Editor: the scene view draws the prop in the hand, because the sync runs in edit mode. The hierarchy still shows the prop where its file `parent` puts it; a small badge can say "follows node `hand`". A gizmo on the prop edits its offset from the node.
- `entity.parent` and the Lite parent differ for an attached entity, as `attachToNode` already does today; the TSDoc states it. `transform.worldMatrix` is read from the Lite node, so it follows the node.
- A missing node name logs one warning code and leaves the entity where it is.
- If accepted: the component and its sync step in `packages/core/src/render`, a new warning code, tests (attach after first sync, re-attach after a model swap, edit mode), the template, `07-rendering.md` §2.4, the skill's `references/recipes/load-a-model.md`, the API report, and a minor changeset.
