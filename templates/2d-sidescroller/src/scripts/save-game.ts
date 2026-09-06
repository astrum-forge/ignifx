import { Script } from "@ignifx/core";
import { makeSave, writeSave } from "../menus/save-store.js";
import type { SaveFile, SavePoint } from "../menus/save-store.js";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * The run's progress, and the two ways it moves: this script writes it into
 * `app.storage.namespace("saves")` and reads it back.
 *
 * ## What is saved, and why it is not a scene file
 *
 * `serializeScene` writes the whole world. A template's world is rebuilt from `assets/` on every
 * boot, so storing it would persist the level rather than the progress through it, and a
 * regenerated atlas or a renamed material would leave the save pointing at something that no longer
 * exists. What actually has to survive is where the player was, what they picked up, their score
 * and how long they have played — four scalars and a list of ids, with the same `format` /
 * `formatVersion` header every other ignifx document carries. See `src/menus/save-store.ts`.
 *
 * ## Autosave
 *
 * `checkpoint()` is called by the level's triggers and pickups. It is throttled, because a player
 * who runs through three coins in one second should cost the disk one write, not three.
 */

/** How the script reaches the run it is saving. Each template implements this over its own world. */
export interface RunState {
  /** Where the player is now, in metres. */
  readonly position: () => SavePoint;
  /** Moves the player to a point, when a save is restored. */
  readonly teleport: (point: SavePoint) => void;
  /** The ids of the pickups already taken. */
  readonly collected: () => readonly string[];
  /** Marks a set of pickups as already taken, when a save is restored. */
  readonly applyCollected: (ids: readonly string[]) => void;
  /** The score. */
  readonly score: () => number;
  /** Sets the score, when a save is restored. */
  readonly setScore: (value: number) => void;
  /** Puts the world back the way the level authored it. */
  readonly reset: () => void;
}

/** The shortest gap between two autosaves, in seconds. */
const AUTOSAVE_INTERVAL_SECONDS = 2;

/** Saves and restores the run. */
export class SaveGame extends Script implements ScriptCallbacks {
  static typeId = "sidescroller/SaveGame";

  /** How the script reaches the run. Assigned right after the component is added. */
  run: RunState | null = null;

  /** Called after a save is written, so the front end can show a toast. */
  onSaved: (() => void) | null = null;

  /** How long this run has been played, in seconds of scaled time. */
  #playSeconds = 0;

  /** How long until an autosave is allowed again, in seconds. */
  #autosaveCooldown = 0;

  update(dt: number): void {
    this.#playSeconds += dt;
    if (this.#autosaveCooldown > 0) {
      this.#autosaveCooldown = Math.max(0, this.#autosaveCooldown - dt);
    }
  }

  /**
   * How long this run has been played.
   *
   * @returns The elapsed scaled seconds.
   */
  get playSeconds(): number {
    return this.#playSeconds;
  }

  /**
   * Writes the run now, whatever the autosave throttle says.
   *
   * @returns A promise that answers `true` once the save is durable, or `false` when the script has
   *   no run to save.
   */
  async save(): Promise<boolean> {
    const run = this.run;
    if (run === null) {
      return false;
    }
    await writeSave(this.app, makeSave(run.position(), run.collected(), run.score(), this.#playSeconds));
    this.#autosaveCooldown = AUTOSAVE_INTERVAL_SECONDS;
    this.onSaved?.();
    return true;
  }

  /**
   * Writes the run, unless one was written moments ago. This is what a trigger or a pickup calls.
   *
   * @returns `true` when a write was started.
   */
  checkpoint(): boolean {
    if (this.#autosaveCooldown > 0 || this.run === null) {
      return false;
    }
    void this.save();
    return true;
  }

  /**
   * Puts the world back the way a save left it.
   *
   * @param file - The save to restore.
   */
  restore(file: SaveFile): void {
    const run = this.run;
    if (run === null) {
      return;
    }
    run.reset();
    run.applyCollected(file.collected);
    run.setScore(file.score);
    run.teleport(file.position);
    this.#playSeconds = file.playSeconds;
    this.#autosaveCooldown = AUTOSAVE_INTERVAL_SECONDS;
  }

  /** Puts the world back the way the level authored it and starts the clock over. */
  restart(): void {
    this.run?.reset();
    this.#playSeconds = 0;
    this.#autosaveCooldown = 0;
  }
}
