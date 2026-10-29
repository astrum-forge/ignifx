---
"@ignifx/editor-host": minor
---

Describe each component's ancestry in `getSchemas`: the new optional `extends` lists the type ids of the registered classes the component's class derives from, nearest first, so an editor can tell that a subclass of a required component already satisfies `requires`, as the engine does.
