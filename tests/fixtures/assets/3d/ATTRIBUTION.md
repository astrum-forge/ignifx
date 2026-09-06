# `tests/fixtures/assets/3d`

Every file in this directory is **original work by Astrum Forge Studios**, released under the
repository's Apache-2.0 licence. Nothing here is derived from a third-party model, texture, rig, or
animation, and nothing was downloaded: the binary asset is produced by the generator that sits
beside it.

| File                 | What it is                                                                                                                                                                                               | How to regenerate                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `make-rig.mjs`       | The generator: writes a glTF 2.0 binary container from scratch — JSON chunk, BIN chunk, one skin with inverse bind matrices, and four animation samplers.                                                | —                                            |
| `rig.glb`            | A skinned "box-man": four joints (`hips`, `torso`, `armL`, `armR`), 32 vertices across four boxes, four clips (`idle`, `walk`, `run`, `jump`), and a geometry-free `hand` node for `Model.attachToNode`. | `node tests/fixtures/assets/3d/make-rig.mjs` |
| `hero.animator.json` | An `ignifx.animator` document for `rig.glb`: an idle/walk/run blend tree on `speed`, a `jump` trigger, and a `landed` event. Hand-written.                                                               | —                                            |

`rig.glb` is checked in rather than generated at test time so that a browser suite can fetch it like
any other asset, and so that a change to the generator shows up as a diff in review.
