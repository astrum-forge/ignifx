# Attribution

Every file in `assets/` is an **original work created for the ignifx repository** by Astrum Forge
Studios, generated programmatically and licensed under **Apache-2.0** — the same licence as the
template itself. Nothing is copied from, derived from, or redistributed out of a third-party asset
pack, and nothing was downloaded.

| File                                 | What it is                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `player.glb`, `companion.glb`        | Two copies of one generated four-joint "box-man" rig with `idle`/`walk`/`run`/`jump` clips and a `hand` node.      |
| `hero.animator.json`                 | The `ignifx.animator` state machine for that rig: an idle/walk/run blend tree, a `jump` trigger, a `landed` event. |
| `floor.png`, `wall.png`, `crate.png` | Albedo textures, drawn pixel by pixel with a hand-written PNG chunk writer.                                        |
| `footstep.wav`                       | Low-passed noise with a fast attack, synthesised sample by sample.                                                 |

The rig and the animator come from `tests/fixtures/assets/3d/` (generator: `make-rig.mjs`); the
textures and the sound come from `tests/fixtures/assets/3d-templates/make-level-art.mjs`, which
uses `node:zlib` and no image or audio library at all. There are two copies of one rig because
`@ignifx/3d` binds one `Animator` per **model asset**, so the player and the companion cannot
share an address.

You may keep, edit, or replace any of it in your own project. If you keep it, keep this file too:
Apache-2.0 §4(d) asks that the attribution notice travel with the work.
