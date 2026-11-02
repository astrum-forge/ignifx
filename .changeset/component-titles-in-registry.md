---
"@ignifx/core": minor
"@ignifx/2d": minor
"@ignifx/3d": minor
"@ignifx/audio": minor
"@ignifx/input": minor
"@ignifx/particles": minor
"@ignifx/particles-2d": minor
"@ignifx/physics": minor
"@ignifx/physics-2d": minor
"@ignifx/terrain": minor
"@ignifx/ui": minor
"@ignifx/editor-host": patch
---

A component class can declare `static title` and `static description`, and `describeRegisteredSchemas` uses them when no curated entry is given.
Every engine component now declares its curated title or summary this way.
The editor host now sends every package's component titles and summaries, such as "Rigidbody mover", instead of class names.
