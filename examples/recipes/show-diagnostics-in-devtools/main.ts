/**
 * Show a gameplay counter in devtools
 *
 * `@ignifx/devtools` draws the overlay; every number on its Stats panel comes from
 * `app.diagnostics`, which is core. So a game publishes its own counters into the same table and
 * they appear beside `drawCalls` and `scriptsUpdated` — and a headless test reads them without
 * opening anything, because `open()` is a documented no-op with no canvas.
 *
 * A counter group is a fixed list of names over a numeric array: register it once (a second
 * registration of the same name is `IGX-1503`), resolve each name to its index once, then `set` or
 * `add` by index on the per-frame path — that is what keeps it allocation-free.
 *
 * Register `devtools()` behind the build's development flag: the package exists to expose internals
 * and has no place in a shipped bundle.
 */
// docs:run
import { Script, createApp } from "@ignifx/core";
import { devtools } from "@ignifx/devtools";
import type { DiagnosticsGroup, ScriptCallbacks } from "@ignifx/core";

/** Publishes two gameplay counters once per frame. */
class WaveCounter extends Script implements ScriptCallbacks {
  static typeId = "recipes/WaveCounter";

  spawned = 0;
  alive = 0;

  #group: DiagnosticsGroup | null = null;
  #spawnedIndex = 0;
  #aliveIndex = 0;

  awake(): void {
    // One owner registers the group; anything else asks for it by name.
    const group =
      this.app.diagnostics.group("game") ?? this.app.diagnostics.registerGroup("game", ["spawned", "alive"]);
    this.#spawnedIndex = group.index("spawned");
    this.#aliveIndex = group.index("alive");
    this.#group = group;
  }

  update(): void {
    const group = this.#group;
    if (group === null) {
      return;
    }
    group.set(this.#spawnedIndex, this.spawned);
    group.set(this.#aliveIndex, this.alive);
  }
}

const app = await createApp({ headless: true, extensions: [devtools({ toggleKey: "F1" })] });
app.registerComponents([WaveCounter]);

const director = app.world.createEntity("Director");
const waves = director.addComponent(WaveCounter);
await app.start();

waves.spawned = 12;
waves.alive = 5;
app.step(1 / 60);

// What the Stats panel would show — the same values, read directly.
const frame = app.diagnostics.frame;
app.log.info("frame, scripts, fixed steps:", frame.frame, frame.scriptsUpdated, frame.fixedSteps);
const game = app.diagnostics.group("game");
if (game !== null) {
  app.log.info("alive:", game.get(game.index("alive")));
}

// With a canvas this opens the overlay; headless it logs one debug line and returns.
app.devtools.open();
app.devtools.select(director);
app.devtools.panel("inspector").show();
app.log.info("selected, open:", app.devtools.selected?.name ?? "nothing", app.devtools.isOpen);
app.dispose();
