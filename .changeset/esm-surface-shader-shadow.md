---
"@ignifx/core": patch
"ignifx": patch
---

Fix ESM shadows ignoring a material change: switching a surface shader with a `displace` hook on or off (or attaching one) left an ESM light drawing the old shape into its shadow map. The shadow now follows, as it already did under PCF and CSM. The rendering skill also notes that ESM and PCF directional maps are fitted to the casters only, and what to do about a lone thin caster.
