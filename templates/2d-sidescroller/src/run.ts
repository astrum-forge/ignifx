import { Vec2 } from "@ignifx/core";
import { CharacterController2D } from "@ignifx/physics-2d";
import type { SavePoint } from "./menus/save-store.js";
import type { Collectible } from "./scripts/collectible.js";
import type { RunState } from "./scripts/save-game.js";
import type { Entity, Vec2Like } from "@ignifx/core";

/**
 * The run: which coins are gone, where the player is, and how to put both back.
 *
 * This is the small object `SaveGame` reads and writes, and the reason the save file is four
 * scalars and a list of ids rather than a serialized scene. `src/menus/save-store.ts` explains the
 * choice; this file is what makes it concrete for the side-scroller.
 */

/** What {@link createRun} hands back. */
export interface Run {
  /** The adapter `SaveGame.run` is assigned. */
  readonly state: RunState;
  /** How many coins have been taken. */
  readonly score: () => number;
  /** How many coins the level has. */
  readonly coinCount: number;
}

/**
 * Wires the level's coins and its character into one run.
 *
 * @param player - The character entity.
 * @param coins - Every coin the objects layer spawned.
 * @param spawn - Where the character starts, in metres.
 * @param onCollected - Called whenever a coin is taken; the template uses it to autosave.
 * @returns The run.
 */
export function createRun(
  player: Entity,
  coins: readonly Collectible[],
  spawn: Vec2Like,
  onCollected: (id: string) => void,
): Run {
  const controller = player.getComponent(CharacterController2D);
  const collected = new Set<string>();

  for (const coin of coins) {
    coin.onCollected = (taken: Collectible): void => {
      collected.add(taken.id);
      onCollected(taken.id);
    };
  }

  /**
   * Moves the character, through the controller when there is one so the physics body follows.
   *
   * @param point - Where to put it.
   */
  const teleport = (point: SavePoint): void => {
    if (controller === null) {
      player.transform.position2D = new Vec2(point.x, point.y);
      return;
    }
    // Not `transform.position2D`: a character controller owns a kinematic body, and writing the
    // transform under it leaves the body where it was until the next move. `teleport` relocates
    // both and clears the interpolation history, so the sprite does not smear across the level.
    controller.teleport({ x: point.x, y: point.y });
  };

  const state: RunState = {
    position: (): SavePoint => {
      const here = player.transform.position2D;
      return { x: here.x, y: here.y, z: 0 };
    },
    teleport,
    collected: (): readonly string[] => [...collected].toSorted(),
    applyCollected: (ids: readonly string[]): void => {
      for (const coin of coins) {
        const taken = ids.includes(coin.id);
        coin.setCollected(taken);
        if (taken) {
          collected.add(coin.id);
        }
      }
    },
    // The score *is* the number of coins taken, so there is nothing else to store or restore; the
    // setter exists because `RunState` is the same shape in all four templates.
    score: (): number => collected.size,
    setScore: (): void => {
      // Derived from `collected`; see above.
    },
    reset: (): void => {
      collected.clear();
      for (const coin of coins) {
        coin.setCollected(false);
      }
      teleport({ x: spawn.x, y: spawn.y, z: 0 });
    },
  };

  return { state, score: (): number => collected.size, coinCount: coins.length };
}
