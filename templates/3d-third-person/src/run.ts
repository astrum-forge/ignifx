import { CharacterController } from "@ignifx/physics";
import type { SavePoint } from "./menus/save-store.js";
import type { Beacon } from "./scripts/beacon.js";
import type { RunState } from "./scripts/save-game.js";
import type { Entity, Vec3Like } from "@ignifx/core";

/**
 * The run: which beacons are lit, where the character is, and how to put both back.
 *
 * This is the small object `SaveGame` reads and writes, and the reason the save file is four
 * scalars and a list of ids rather than a serialized scene. `src/menus/save-store.ts` explains the
 * choice; this file is what makes it concrete for the third-person template.
 */

/** What {@link createRun} hands back. */
export interface Run {
  /** The adapter `SaveGame.run` is assigned. */
  readonly state: RunState;
  /** How many beacons are lit. */
  readonly score: () => number;
  /** How many beacons the level has. */
  readonly beaconCount: number;
}

/**
 * Wires the level's beacons and its character into one run.
 *
 * @param player - The character entity.
 * @param beacons - Every beacon the level built.
 * @param spawn - Where the character starts, in metres.
 * @param onCollected - Called whenever a beacon is lit for the first time; the template uses it to
 *   autosave.
 * @returns The run.
 */
export function createRun(
  player: Entity,
  beacons: readonly Beacon[],
  spawn: Vec3Like,
  onCollected: (id: string) => void,
): Run {
  const controller = player.getComponent(CharacterController);
  const collected = new Set<string>();

  for (const beacon of beacons) {
    beacon.player = player;
    beacon.onLit = (lit: Beacon): void => {
      collected.add(lit.id);
      onCollected(lit.id);
    };
  }

  /**
   * Moves the character, through the controller when there is one so the capsule follows.
   *
   * @param point - Where to put it.
   */
  const teleport = (point: SavePoint): void => {
    if (controller === null) {
      player.transform.position = { x: point.x, y: point.y, z: point.z };
      return;
    }
    // Not `transform.position`: a character controller owns a kinematic capsule, and writing the
    // transform under it leaves the capsule where it was until the next sweep. `teleport` relocates
    // both and clears the interpolation history.
    controller.teleport({ x: point.x, y: point.y, z: point.z });
  };

  const state: RunState = {
    position: (): SavePoint => {
      const here = player.transform.position;
      return { x: here.x, y: here.y, z: here.z };
    },
    teleport,
    collected: (): readonly string[] => [...collected].toSorted(),
    applyCollected: (ids: readonly string[]): void => {
      for (const beacon of beacons) {
        const lit = ids.includes(beacon.id);
        beacon.setLit(lit);
        if (lit) {
          collected.add(beacon.id);
        }
      }
    },
    // The score *is* the number of lit beacons, so there is nothing else to store or restore; the
    // setter exists because `RunState` is the same shape in all four templates.
    score: (): number => collected.size,
    setScore: (): void => {
      // Derived from `collected`; see above.
    },
    reset: (): void => {
      collected.clear();
      for (const beacon of beacons) {
        beacon.setLit(false);
      }
      teleport({ x: spawn.x, y: spawn.y, z: spawn.z });
    },
  };

  return { state, score: (): number => collected.size, beaconCount: beacons.length };
}
