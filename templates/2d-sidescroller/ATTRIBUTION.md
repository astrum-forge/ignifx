# Attribution

Every file in `assets/` is an **original work created for the ignifx repository** by
Astrum Forge Studios, generated programmatically and licensed under **Apache-2.0** — the same
licence as the template itself. Nothing is copied from, derived from, or redistributed out of a
third-party asset pack, and nothing was downloaded.

| File                                                                                                       | Generator                                                       |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `tiles.png`, `hero.png`, `fx.png`, `coin.png`, `parallax.png` and their `.atlas.json` / `.spriteanim.json` | `tests/fixtures/assets/2d-templates/make-template-art.mjs`      |
| `level.tilemap.json`                                                                                       | `tests/fixtures/assets/2d-templates/make-template-levels.mjs`   |
| The seven `.wav` files                                                                                     | `tests/fixtures/assets/audio-templates/make-template-audio.mjs` |
| `strings.i18n.json`, `game.input.json`, `game.audio.json`                                                  | Hand-written for this template                                  |

The generators use `node:zlib`, a hand-written PNG chunk writer and a hand-written RIFF/WAVE
writer, with no image or audio library involved. Every one of them is seeded, so a regenerated file
is byte for byte the committed one: `pnpm assets` from the repository root rebuilds all of it.

The sounds are seven short synthesised clips — footstep, jump, land, pickup, UI click, UI hover and
a seamless 3.6-second ambient pad, each template in its own key.

You may keep, edit, or replace any of it in your own project. If you keep it, keep this file too:
Apache-2.0 §4(d) asks that the attribution notice travel with the work.
