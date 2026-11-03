---
"@ignifx/2d": minor
---

Trimmed atlas frames now draw in the right place. An `.atlas.json` frame takes an optional `sourceOffset` (where the trimmed rectangle's top-left sits inside its untrimmed `sourceSize`, as TexturePacker's and Aseprite's `spriteSourceSize.x/y`). With it the frame draws at its trimmed size, offset to where the untrimmed frame would be, with its pivot in `[0, 1]` of `sourceSize`. The TexturePacker and Aseprite importers now write it for trimmed frames, so re-import a trimmed sheet to fix its placement. A frame without `sourceOffset` draws as before. `SpriteFrameInfo` gains `trim`.
