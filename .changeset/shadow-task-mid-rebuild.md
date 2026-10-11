---
"@ignifx/core": patch
---

Fix PCF and CSM shadows throwing `beginRenderPass … colorAttachments[0].view … Required member is undefined` when a frame lands while a material rebuild is still running, which could leave the canvas black on slower machines.
