---
"@ignifx/core": patch
"ignifx": patch
---

Fix a black canvas when the first skinned or morph-target model in a page is added after `app.start()`: it now renders. A morph-target model can still cost a frame or two when it first appears.
