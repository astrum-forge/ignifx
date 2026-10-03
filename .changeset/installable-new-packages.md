---
"@ignifx/particles": patch
"@ignifx/particles-2d": patch
"@ignifx/terrain": patch
"ignifx": patch
---

Fix installing `ignifx`, `@ignifx/particles`, `@ignifx/particles-2d` and `@ignifx/terrain`: 0.3.0 of the three new packages was published with unresolved `workspace:` and `catalog:` dependencies, so `npm install` failed with `Unsupported URL Type`. Upgrade to 0.3.1.
