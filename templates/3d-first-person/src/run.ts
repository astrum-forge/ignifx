import { CharacterController } from "@ignifx/physics";
import type { Interactable } from "./level.js";
import type { SavePoint } from "./menus/save-store.js";
import type { Interactor } from "./scripts/interactor.js";
import type { RunState } from "./scripts/save-game.js";
import type { Entity, Vec3Like } from "@ignifx/core";

/**
 * The run: which pedestals are lit, where the player is, and how to put both back.
 *
 * This is the small object `SaveGame` reads and writes, and the reason the save file is four
 * scalars and a list of ids rather than a serialized scene. `src/menus/save-store.ts` explains the
 * choice; this file is what makes it concrete for the first-person template.
 */

/** What {@link createRun} hands back. */
export interface Run {
  /** The adapter `SaveGame.run` is assigned. */
  readonly state: RunState;
  /** How many pedestals are lit. */
  readonly score: () => number;
  /** How many pedestals the level has. */
  readonly pedestalCount: number;
}

/**
 * Wires the level's pedestals and its character into one run.
 *
 * @param player - The character entity, which carries the `CharacterController`.
 * @param interactor - The script that owns which pedestals are lit.
 * @param pedestals - Every pedestal the level built.
 * @param spawn - Where the character starts, in metres.
 * @param onCollected - Called whenever a pedestal is lit; the template uses it to autosave.
 * @returns The run.
 */
export function createRun(
  player: Entity,
  interactor: Interactor,
  pedestals: readonly Interactable[],
  spawn: Vec3Like,
  onCollected: (name: string) => void,
): Run {
  const controller = player.getComponent(CharacterController);

  interactor.onToggled = (name: string, lit: boolean): void => {
    if (lit) {
      onCollected(name);
    }
  };

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
    // transform under it leaves the capsule where it was until the next sweep.
    controller.teleport({ x: point.x, y: point.y, z: point.z });
  };

  const state: RunState = {
    position: (): SavePoint => {
      const here = player.transform.position;
      return { x: here.x, y: here.y, z: here.z };
    },
    teleport,
    collected: (): readonly string[] => interactor.litNames(),
    applyCollected: (ids: readonly string[]): void => {
      for (const pedestal of pedestals) {
        interactor.setLit(pedestal, ids.includes(pedestal.entity.name));
      }
    },
    // The score *is* the number of lit pedestals, so there is nothing else to store or restore; the
    // setter exists because `RunState` is the same shape in all four templates.
    score: (): number => interactor.litCount,
    setScore: (): void => {
      // Derived from the lit set; see above.
    },
    reset: (): void => {
      for (const pedestal of pedestals) {
        interactor.setLit(pedestal, false);
      }
      teleport({ x: spawn.x, y: spawn.y, z: spawn.z });
    },
  };

  return { state, score: (): number => interactor.litCount, pedestalCount: pedestals.length };
}
