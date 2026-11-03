---
"@ignifx/2d": minor
"@ignifx/editor-host": minor
---

Scrub a sprite clip by time. `SpriteAnimator.sampleTime(clip, seconds)` shows the frame that plays that far into a clip without playing it, and `spriteClipFrameAtTime` is the same time-to-frame rule as a pure function. The editor host answers the new `sampleSpriteAnimation { entity, clip, frame | time }` method, listed as the `spriteAnimation` capability, so the editor's sprite animation panel can preview a clip in the scene view.
