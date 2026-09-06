/**
 * Save and load game state
 *
 * `app.storage` is the asynchronous key–value store behind save games, settings and input
 * rebindings. Its backend follows the host — IndexedDB in a browser, files under `userData` in
 * Electron, memory under Node — and the five calls (`get`, `set`, `delete`, `keys`, `namespace`) are
 * the same everywhere. A namespace is a **scope, not a prefix**: `namespace("saves")` sees none of
 * the root's keys, so a save slot can never collide with a settings key.
 *
 * Version the document, not the key. A build that reads a slot a newer build wrote must refuse it
 * rather than half-apply it, and a build that reads an older one migrates it forward.
 *
 * Autosaving is a coroutine: `yield waitSeconds(n)` runs on the game clock, and `yield promise`
 * resumes in the first `Update` after the write settles, so the loop never overlaps itself.
 */
// docs:run
import { Script, createApp, f32, u32, waitSeconds } from "@ignifx/core";
import type { Coroutine, ScriptCallbacks } from "@ignifx/core";

/** Everything one slot holds. `version` is what a later build migrates from. */
interface SaveFile {
  readonly version: number;
  readonly level: string;
  readonly checkpoint: readonly [number, number, number];
  readonly coins: number;
}

const SAVE_VERSION = 2;
const SLOT = "slot1";

/** Keeps one save slot up to date while the player plays. */
class Autosave extends Script.define({ everySeconds: f32(30), coins: u32(0) }) implements ScriptCallbacks {
  static typeId = "recipes/Autosave";

  level = "caverns";

  start(): void {
    this.startCoroutine(this.#loop());
  }

  /** Writes the slot. Values are JSON; a `Uint8Array` is stored as octets instead. */
  async save(): Promise<void> {
    const position = this.transform.position;
    await this.app.storage.namespace("saves").set<SaveFile>(SLOT, {
      version: SAVE_VERSION,
      level: this.level,
      checkpoint: [position.x, position.y, position.z],
      coins: this.coins,
    });
  }

  // Reads the slot, refusing a document a newer build wrote.
  async load(): Promise<boolean> {
    const file = await this.app.storage.namespace("saves").get<SaveFile>(SLOT);
    if (file === null || file.version > SAVE_VERSION) {
      return false;
    }
    this.level = file.level;
    this.coins = file.coins;
    this.transform.localPosition.set(file.checkpoint[0], file.checkpoint[1], file.checkpoint[2]);
    return true;
  }

  *#loop(): Coroutine {
    for (;;) {
      yield waitSeconds(this.everySeconds);
      // Resumes in the first Update after the write settles, so two writes never overlap.
      yield this.save();
    }
  }
}

const app = await createApp({ headless: true });
app.registerComponents([Autosave]);
const hero = app.world.createEntity("Hero");
hero.transform.localPosition.set(4, 0, 12);
const progress = hero.addComponent(Autosave, { everySeconds: 5, coins: 3 });
await app.start();

await progress.save();
progress.coins = 0;
hero.transform.localPosition.set(0, 0, 0);

app.log.info("restored, coins, z:", await progress.load(), progress.coins, hero.transform.localPosition.z);
app.log.info("slots:", (await app.storage.namespace("saves").keys()).join(", "));
app.dispose();
