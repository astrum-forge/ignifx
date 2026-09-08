import { BoxCollider2D, CircleCollider2D, defineInputActions, Rigidbody2D, Script, SpriteRenderer, Vec2 } from "ignifx";
import { Launch } from "./launch.ts";
import {
  ARENA_WIDTH,
  COLUMNS,
  FRAMES,
  MAX_BODIES,
  RESTING_COINS,
  STACK_HEIGHT,
  THROW_FROM,
  THROW_SPEED,
} from "./scene.ts";
import type {
  App,
  AssetHandle,
  Entity,
  InputAction,
  MutableVec2,
  ScriptCallbacks,
  SpriteAtlasAsset,
  Vec2Like,
} from "ignifx";

/**
 * The arena: the floor, the walls, the crates, the coins, and the click that throws one.
 *
 * Kept out of `main.ts` so that file is the app and the panel and nothing else.
 */

/** The pointer actions. Their own map, so the kit's camera actions are untouched. */
export const AIM_ACTIONS = defineInputActions({
  maps: [
    {
      name: "Arena",
      actions: [
        // `<Pointer>` is the unified primary pointer: a mouse, a pen, or the first touch. One
        // binding is a click and a tap.
        { name: "fire", type: "button", bindings: [{ path: "<Pointer>/press" }] },
        { name: "aim", type: "vector2", bindings: [{ path: "<Pointer>/position" }] },
      ],
    },
  ],
});

/** What the arena is holding, so the panel can count it and Reset can empty it. */
export interface Arena {
  /** Every body the scene created, oldest first. */
  readonly bodies: Entity[];
  /**
   * Drops one crate at a column.
   *
   * @param column - Which of {@link COLUMNS} to drop it on.
   * @param height - Where its centre starts, in metres.
   */
  readonly crate: (column: number, height: number) => void;
  /**
   * Throws one coin from the left edge.
   *
   * @param target - The world point to aim at.
   */
  readonly throwAt: (target: Vec2Like) => void;
  /** Removes every body and rebuilds the opening stack. */
  readonly reset: () => void;
}

/**
 * Turns a click into a throw.
 *
 * @remarks
 * The pointer's position arrives in **backing-store pixels**, which is what `screenToWorld` wants,
 * so there is no conversion here — a DOM listener would have needed one. Reading the press in
 * `update` rather than `fixedUpdate` is the same rule every input in ignifx follows:
 * `wasPressedThisFrame` is true for exactly one frame, and a frame carries zero, one or two steps.
 */
export class Thrower extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "physics-2d/Thrower";

  /** The arena to throw into. Assigned when the scene is built. */
  arena: Arena | null = null;

  #fire: InputAction | null = null;
  #aim: InputAction | null = null;
  readonly #target: MutableVec2 = new Vec2();

  awake(): void {
    this.#fire = this.app.input.actions.find("fire");
    this.#aim = this.app.input.actions.find("aim");
  }

  update(): void {
    if (this.#fire?.wasPressedThisFrame !== true) {
      return;
    }
    const at = this.#aim?.vector ?? null;
    if (at === null) {
      return;
    }
    this.app.twoD.screenToWorld(at.x, at.y, this.#target);
    this.arena?.throwAt(this.#target);
  }
}

/**
 * Builds the arena: the floor, the two walls, and the factories the panel and the pointer drive.
 *
 * @param app - The running app.
 * @param atlas - The props atlas every body draws from.
 * @param jitter - The kit's seeded generator, so two loads stack the crates the same way.
 * @returns The arena.
 */
export function createArena(app: App, atlas: AssetHandle<SpriteAtlasAsset>, jitter: () => number): Arena {
  const sheet = atlas.value;
  const ground = sheet.requireFrame(FRAMES.ground);
  const coin = sheet.requireFrame(FRAMES.coin);
  const crates = FRAMES.crates.map((name: string) => sheet.requireFrame(name));

  for (let x = 0; x < ARENA_WIDTH; x += 1) {
    const tile = app.world.createEntity(`Floor ${String(x)}`);
    tile.transform.position2D = new Vec2(x + 0.5, 0.5);
    tile.addComponent(SpriteRenderer, { sprite: atlas, sortingLayer: "Terrain" }).frame = ground;
  }
  // One collider for the whole floor rather than nine: Rapier has less to test, and a body sliding
  // along it never catches on a seam between two boxes.
  const floor = app.world.createEntity("Floor");
  floor.transform.position2D = new Vec2(ARENA_WIDTH / 2, 0.5);
  floor.addComponent(BoxCollider2D, { size: { x: ARENA_WIDTH, y: 1 } });

  // The walls are off the edge of the frame: they exist to keep a hard throw in the arena.
  for (const [name, x] of [
    ["Wall left", -0.5],
    ["Wall right", ARENA_WIDTH + 0.5],
  ] as const) {
    const wall = app.world.createEntity(name);
    wall.transform.position2D = new Vec2(x, 4);
    wall.addComponent(BoxCollider2D, { size: { x: 1, y: 8 } });
  }

  const bodies: Entity[] = [];
  const retire = (): void => {
    while (bodies.length > MAX_BODIES) {
      bodies.shift()?.destroy();
    }
  };

  const crate = (column: number, height: number): void => {
    const entity = app.world.createEntity(`Crate ${String(bodies.length)}`);
    // A hair of jitter from the kit's seeded generator, so a stack settles like a real one and two
    // loads of the same URL still settle identically. Examples never call `Math.random`.
    entity.transform.position2D = new Vec2(column + (jitter() - 0.5) * 0.04, height);
    entity.addComponent(SpriteRenderer, { sprite: atlas, sortingLayer: "Default" }).frame =
      crates[bodies.length % crates.length] ?? 0;
    entity.addComponent(BoxCollider2D, { size: { x: 0.94, y: 0.94 } });
    entity.addComponent(Rigidbody2D, { mass: 4, angularDamping: 0.3 });
    bodies.push(entity);
    retire();
  };

  const drop = (x: number, y: number): Launch => {
    const entity = app.world.createEntity(`Coin ${String(bodies.length)}`);
    entity.transform.position2D = new Vec2(x, y);
    entity.addComponent(SpriteRenderer, { sprite: atlas, sortingLayer: "Default" }).frame = coin;
    entity.addComponent(CircleCollider2D, { radius: 0.42, inlineMaterial: { friction: 0.4, restitution: 0.35 } });
    entity.addComponent(Rigidbody2D, { mass: 1.2 });
    const launch = entity.addComponent(Launch);
    bodies.push(entity);
    retire();
    return launch;
  };

  const throwAt = (target: Vec2Like): void => {
    const launch = drop(THROW_FROM.x, THROW_FROM.y);
    const dx = target.x - THROW_FROM.x;
    const dy = target.y - THROW_FROM.y;
    const length = Math.hypot(dx, dy);
    // A throw is a velocity rather than an impulse: the coin should leave the hand at the same
    // speed whatever it weighs, which is what a player expects from a throw.
    if (length < 0.001) {
      launch.velocity.set(THROW_SPEED, 0);
    } else {
      launch.velocity.set((dx / length) * THROW_SPEED, (dy / length) * THROW_SPEED);
    }
  };

  const reset = (): void => {
    for (const entity of bodies) {
      entity.destroy();
    }
    bodies.length = 0;
    for (let row = 0; row < STACK_HEIGHT; row += 1) {
      for (const column of COLUMNS) {
        crate(column, 1.5 + row);
      }
    }
    for (const x of RESTING_COINS) {
      drop(x, 1.42);
    }
  };

  reset();
  return { bodies, crate, throwAt, reset };
}
