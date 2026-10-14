---
"@ignifx/3d": patch
---

Fix `ThirdPersonController.stepHeight` launching the character into the air: the step probe added `stepHeight / dt` to a displacement that is already a distance, so a 0.35 m step lifted the character about 21 m in one fixed step. It now lifts by the step height.
