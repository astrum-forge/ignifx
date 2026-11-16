---
"ignifx": patch
"@ignifx/2d": patch
"@ignifx/3d": patch
"@ignifx/audio": patch
"@ignifx/devtools": patch
"@ignifx/editor-host": patch
"@ignifx/electron": patch
"@ignifx/input": patch
"@ignifx/particles": patch
"@ignifx/particles-2d": patch
"@ignifx/physics": patch
"@ignifx/physics-2d": patch
"@ignifx/terrain": patch
"@ignifx/ui": patch
---

Correct the shipped agent skills and halve the entry skill, from 72.6 KB to 34.9 KB: the commands a scaffolded project really has, the complete error-code ranges and file-format index, and CSM shadows surviving device loss.
Skill pages name other skills by package and path inside it, so the pointers resolve from `node_modules`. The editor-host protocol method reference moves to `references/protocol.md` in that skill.
