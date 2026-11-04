---
"@ignifx/core": patch
---

Changing `LightProbeVolume.intensity` no longer recompiles every lit material. Light probes never add negative light. A `.probes.json` whose `origin` or `cellSize` is too large or too small to use is now rejected with `IGX-0709`.
