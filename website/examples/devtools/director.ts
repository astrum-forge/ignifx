/**
 * The gameplay the overlay watches: a wave counter with four serialized fields, published once a
 * frame into a counter group on `app.diagnostics`.
 *
 * @remarks
 * It is the shape `skills/ignifx/references/recipes/show-diagnostics-in-devtools.md` recommends,
 * and the reason it is that shape is the per-frame path. A counter group is a **fixed list of names
 * over a numeric array**: register it once, resolve each name to an index once in `awake`, then
 * `set` by index in `update`. No string is hashed and nothing is allocated after the first frame.
 *
 * `groupOrRegister` rather than `registerGroup`, because a second registration of the same name is
 * `IGX-1503` and a scene reload runs `awake` again.
 *
 * The fields are declared with `Script.define`, which is what puts them in the devtools Inspector
 * as editable rows: `wave` typed into the overlay is `wave` in the next frame's `update`. That is
 * the whole reason this class has fields rather than private state.
 */

import { f32, i32, Script } from "ignifx";
import type { DiagnosticsGroup, ScriptCallbacks } from "ignifx";

/** The counter group's name, as `app.diagnostics.group("game")` asks for it. */
export const COUNTER_GROUP = "game";

/** The counters, in the order their indices are resolved. */
export const COUNTER_NAMES = ["wave", "spawned", "alive", "score"] as const;

/** One of {@link COUNTER_NAMES}. */
export type CounterName = (typeof COUNTER_NAMES)[number];

/** How many drones a wave is worth, so the numbers on screen mean something. */
const SPAWNS_PER_WAVE = 7;

/**
 * A wave director: four numbers a game would have anyway, on the clock and in the diagnostics
 * table.
 *
 * @example
 * ```ts
 * const stage = app.world.createEntity("Director");
 * const director = stage.addComponent(Director);
 * app.devtools.select(stage);
 * ```
 */
export class Director
  extends Script.define({
    wave: i32(1, { min: 1, tooltip: "Which wave is running." }),
    spawned: i32(0, { min: 0, tooltip: "How many drones have been spawned in total." }),
    alive: i32(SPAWNS_PER_WAVE, { min: 0, tooltip: "How many are still flying." }),
    score: i32(0, { min: 0, tooltip: "Points banked." }),
    waveSeconds: f32(6, { min: 0.5, tooltip: "How long one wave lasts, in seconds." }),
  })
  implements ScriptCallbacks
{
  /** The namespaced registration id. */
  static typeId = "devtools/Director";

  /** The counter group, resolved once. */
  #group: DiagnosticsGroup | null = null;

  /** The counters' indices, in {@link COUNTER_NAMES} order. */
  readonly #indices: number[] = [];

  /** Seconds left in the current wave. */
  #remaining = 0;

  /** Registers the counter group and resolves its indices — once, not per frame. */
  awake(): void {
    const group = this.app.diagnostics.groupOrRegister(COUNTER_GROUP, [...COUNTER_NAMES]);
    this.#group = group;
    this.#indices.length = 0;
    for (const name of COUNTER_NAMES) {
      this.#indices.push(group.index(name));
    }
    this.#remaining = this.waveSeconds;
    this.spawned = SPAWNS_PER_WAVE;
  }

  /**
   * Runs the wave clock and writes the four counters.
   *
   * @param dt - Seconds since the previous frame, scaled by `time.timeScale`. Under `?static=1`
   * the scale is zero, so the wave holds where it was authored and the overlay's own refresh —
   * which runs on the unscaled clock — keeps drawing it.
   */
  update(dt: number): void {
    this.#remaining -= dt;
    if (this.#remaining <= 0) {
      this.advanceWave();
    } else if (this.alive > 0 && dt > 0) {
      // A wave thins out across its length rather than in one step, so the numbers on the overlay
      // move while you watch them.
      const share = Math.floor((1 - this.#remaining / Math.max(this.waveSeconds, 0.5)) * SPAWNS_PER_WAVE);
      const cleared = Math.max(0, Math.min(SPAWNS_PER_WAVE, share));
      const left = SPAWNS_PER_WAVE - cleared;
      this.score += Math.max(0, this.alive - left) * 10;
      this.alive = left;
    }
    const group = this.#group;
    if (group === null) {
      return;
    }
    group.set(this.#indices[0] ?? 0, this.wave);
    group.set(this.#indices[1] ?? 0, this.spawned);
    group.set(this.#indices[2] ?? 0, this.alive);
    group.set(this.#indices[3] ?? 0, this.score);
  }

  /** Starts the next wave: what the panel's button and the wave clock both call. */
  advanceWave(): void {
    this.wave += 1;
    this.alive = SPAWNS_PER_WAVE;
    this.spawned += SPAWNS_PER_WAVE;
    this.score += 100;
    this.#remaining = this.waveSeconds;
  }

  /**
   * Reads one counter back out of the diagnostics table.
   *
   * @remarks
   * Through the group rather than off the field, on purpose: it is the same read a HUD, a test or
   * the Stats panel would do, and it proves the number reached the table.
   *
   * @param name - Which counter.
   * @returns The value, or `"—"` before `awake` has run.
   */
  read(name: CounterName): string {
    const group = this.#group;
    if (group === null) {
      return "—";
    }
    return String(group.get(group.index(name)));
  }
}
