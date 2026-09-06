# Attribution

Every file in `assets/` is an **original work created for the ignifx repository** by Astrum Forge
Studios, generated programmatically and licensed under **Apache-2.0** — the same licence as the
template itself. Nothing is copied from, derived from, or redistributed out of a third-party asset
pack, and nothing was downloaded.

| File                                                                                                | What it is                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player.glb`, `companion.glb`                                                                       | A generated four-joint "box-man" rig with `idle`/`walk`/`run`/`jump` clips and a `hand` node.                                                                    |
| `hero.animator.json`                                                                                | The `ignifx.animator` state machine for that rig: an idle/walk/run blend tree, a `jump` trigger, a `landed` event.                                               |
| `floor.png`, `wall.png`, `crate.png`, `sky.png`                                                     | Albedo and gradient textures, drawn pixel by pixel with a hand-written PNG chunk writer.                                                                         |
| `*.material.json`                                                                                   | The PBR descriptions those textures are used through, `sky` unlit and double-sided, `emissive` untextured.                                                       |
| `footstep.wav`, `jump.wav`, `land.wav`, `pickup.wav`, `ui-click.wav`, `ui-hover.wav`, `ambient.wav` | Seven synthesised sounds: filtered noise for the impacts, a bell arpeggio for the pickup, dry clicks for the UI, and a seamless 3.6-second pad for the ambience. |
| `strings.i18n.json`, `game.input.json`, `game.audio.json`                                           | Hand-written for this template.                                                                                                                                  |

The rig and the animator come from `tests/fixtures/assets/3d/` (generator: `make-rig.mjs`); the
textures and the materials from `tests/fixtures/assets/3d-templates/make-level-art.mjs`; the sounds
from `tests/fixtures/assets/audio-templates/make-template-audio.mjs`. All of them use `node:zlib`
and no image or audio library at all, and all of them are seeded, so a regenerated file is byte for
byte the committed one: `pnpm assets` from the repository root rebuilds every one.

There are two copies of one rig because `@ignifx/3d` binds one `Animator` per **model asset**, so
the player and the companion cannot share an address.

You may keep, edit, or replace any of it in your own project. If you keep it, keep this file too:
Apache-2.0 §4(d) asks that the attribution notice travel with the work.
