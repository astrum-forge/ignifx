---
"@ignifx/core": patch
---

Fix every frame being rejected after the number of shadow-casting lights changes while another light keeps casting: turning one of two casting lights' `shadows.enabled` (or `Light.enabled`) off, and on again, built a shadow bind group that did not match its layout. Both lights now keep casting through the toggle.
