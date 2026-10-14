---
"@ignifx/3d": minor
"@ignifx/core": patch
"@ignifx/devtools": patch
"@ignifx/cli": patch
---

- Add `ThirdPersonCamera.minDistance` (default 0.5 m): wall collision no longer pulls the boom inside the character when it backs into a corner. Set it to `0` for the old behaviour.
- Correct the `Environment.blur` documentation: Babylon Lite blurs only the visible skybox, not reflections or lighting.
- `InstancedMeshRenderer` documents that `lod` needs `gpuCulling`, and logs `IGX-0727` once when a LOD partner is declared with culling off, because that partner never draws.
- The devtools overlay has a close button at the end of its tab strip, and a side-docked overlay leaves 40 pixels of the page uncovered; the inspector's header buttons wrap instead of being cut off.
- 2d-sidescroller: falling into a pit no longer loops forever; the respawn point is saved only where there is ground under the character's centre.
- 3d-first-person: the touch crouch button sits above interact, so it no longer overlaps the move stick on a phone.
- 3d-third-person: the camera widens its field of view on a portrait screen, and the `?static=1&hud=1` HUD shows the companion's real starting distance.
- The touch controls in all four templates have localized accessible names instead of control ids.
