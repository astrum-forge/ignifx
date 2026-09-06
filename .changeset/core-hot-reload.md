---
"@ignifx/core": minor
---

Script and scene hot reload (`app.hotReload`)

`app.hotReload.apply(modules)` swaps script classes in a running game, matching each replacement to the class registered under its `typeId`. The default `"patch"` policy swaps live instances' prototypes: the objects, their field values, and their running coroutines survive, no lifecycle callback re-runs, and the statics are re-read, so a changed `executionOrder` reorders dispatch. `static hotReload = "recreate"` instead serializes each instance through its schema, destroys it (`onDisable`/`onDestroy`), and rebuilds it from the new class with the same uid and the same position on the entity, so `awake`/`onEnable`/`start` run again and tracked references find the replacement. A `"patch"` class whose schema *shape* changed is re-created anyway, with an `IGX-0207` warning. `static onHotReload(previous)` runs once on the new class for class-level migration. `apply` is a flush-time operation and refuses to run inside a lifecycle callback (`IGX-0208`).

`app.hotReload.reloadScene(instance)` rebuilds one scene instance from its asset's current value (`IGX-1506` when it has none), and `createApp({ hotReload: { reloadScenes: true } })` does it automatically whenever a scene file is replaced. Everything works headlessly with no bundler, which is how it is tested. `ComponentRegistry.replace(type)` is the additive registry primitive behind it.
