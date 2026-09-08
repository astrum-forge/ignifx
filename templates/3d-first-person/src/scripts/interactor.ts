import { entityRef, f32, LayerMask, Script } from "@ignifx/core";
import { DeviceKind } from "@ignifx/input";
import type { AudioClip } from "@ignifx/audio";
import type { AssetHandle, ColorLike, Entity, MaterialAsset, MeshRenderer, ScriptCallbacks } from "@ignifx/core";
import type { InputAction } from "@ignifx/input";

/**
 * The crosshair ray: what a first-person game does instead of clicking on things.
 *
 * ## Where the ray comes from
 *
 * The camera's own transform, not the character's. In first person the body owns the yaw and the
 * head owns the pitch (`FirstPersonController.cameraPivot`), so only the head is looking where the
 * crosshair points. `transform.forward` on the head entity is that direction, already in world
 * space, and the ray starts at the head's position because the crosshair sits at the exact centre
 * of the screen — the projection of the camera's own forward axis.
 *
 * A `camera.screenToRay(x, y)` would be the right tool for a cursor that can be anywhere; it takes
 * **backing-store** pixels, which is the space `@ignifx/input` reports pointer positions in.
 *
 * ## Why the mask is a layer and not a component check
 *
 * `app.physics.raycast` filters by layer inside Havok, so a ray aimed at the `Interactable` layer
 * never reports the floor, the walls or the crates and never allocates a hit for them. Walking the
 * hits and asking "is this a pedestal?" would do the same work in JavaScript, every frame, for
 * every ray.
 *
 * ## Why a click is ignored while the pointer is unlocked
 *
 * `Interact` is bound to both <kbd>E</kbd> and the left mouse button, and the left mouse button is
 * also the gesture that asks the browser for pointer lock (`FirstPersonController`'s
 * `lockPointerOnClick`). Without the gate below, the click that gives the player their mouse back —
 * after Escape, after a pause menu, after tabbing away — would *also* flip whatever pedestal
 * happened to be under the crosshair, which is a pedestal the player never aimed at. Left click
 * still interacts; it just has to be a click made while the game holds the pointer, which is every
 * click after the first. `InputAction.activeDevice` is what tells a mouse press apart from
 * <kbd>E</kbd>, a gamepad trigger or the on-screen button, none of which are gated.
 */

/** How the pedestal reads when the crosshair is not on it. */
const IDLE_COLOR: ColorLike = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

/** How the pedestal reads once it has been switched on. */
const LIT_COLOR: ColorLike = Object.freeze({ r: 0.29, g: 0.82, b: 0.94, a: 1 });

/** One thing this script can light up. */
export interface InteractorTarget {
  /** The entity the ray hits. */
  readonly entity: Entity;
  /** That entity's own material, so recolouring one does not recolour the others. */
  readonly material: AssetHandle<MaterialAsset>;
  /** The emissive cap, shown only while the pedestal is lit. */
  readonly glow: MeshRenderer;
}

/**
 * Casts a ray down the crosshair every frame, and toggles whatever it finds when `Interact` is
 * pressed.
 */
export class Interactor
  extends Script.define({
    /** The head entity the ray is cast from; usually the camera's entity. */
    eye: entityRef<Entity>(),
    /** How far the player can reach, in metres. */
    reach: f32(3.5),
  })
  implements ScriptCallbacks
{
  static typeId = "first-person/Interactor";

  /** The targets the ray may find, by entity. Assigned right after the component is added. */
  targets: readonly InteractorTarget[] = [];

  /** The blip played on a toggle. */
  clip: AssetHandle<AudioClip> | null = null;

  /** The crosshair element, so it can say when something is in reach. */
  crosshair: HTMLElement | null = null;

  /** Called whenever a pedestal is switched. Assigned right after the component is added. */
  onToggled: ((name: string, lit: boolean) => void) | null = null;

  /** The `Interact` action. */
  #interact: InputAction | null = null;

  /** Which layers the ray may hit, resolved once. */
  #mask: LayerMask | null = null;

  /** Which entities are currently lit, by name. */
  readonly #lit = new Set<string>();

  /** What the crosshair is on, or `null`. */
  #focus: InteractorTarget | null = null;

  awake(): void {
    this.#interact = this.app.input.actions.find("Interact");
    this.#mask = LayerMask.fromNames(this.world.layers, ["Interactable"]);
  }

  update(): void {
    const eye = this.eye;
    const mask = this.#mask;
    if (eye === null || eye.isDestroyed || mask === null) {
      return;
    }
    // Every query needs one completed fixed step behind it: Havok builds its broadphase there and
    // reports `IGX-0902` before that. The app has always stepped by the time a script updates.
    const hit = this.app.physics.raycast(eye.transform.position, eye.transform.forward, this.reach, {
      layerMask: mask,
    });
    const found = hit === null ? null : (this.targets.find((target) => target.entity === hit.entity) ?? null);
    if (found !== this.#focus) {
      this.#focus = found;
      // `dataset.target` is `data-target`; `index.html` styles the crosshair off it.
      if (this.crosshair !== null) {
        this.crosshair.dataset["target"] = found === null ? "none" : "hit";
      }
    }
    if (found !== null && this.#wasInteractPressed()) {
      this.#toggle(found);
    }
  }

  /**
   * Whether `Interact` went down this frame in a way that should act on the world.
   *
   * @remarks
   * See the module comment: a mouse press only counts once the game holds the pointer, because the
   * press that takes the lock is the player asking for their view back, not for a pedestal.
   *
   * @returns `true` when the press should toggle whatever the crosshair is on.
   */
  #wasInteractPressed(): boolean {
    const interact = this.#interact;
    if (interact === null || !interact.wasPressedThisFrame) {
      return false;
    }
    const device = interact.activeDevice;
    const isPointer = device === DeviceKind.mouse || device === DeviceKind.pointer;
    return !isPointer || this.app.input.pointerLock.locked;
  }

  /**
   * Whether a pedestal is currently switched on. The HUD counts them.
   *
   * @param target - The pedestal to ask about.
   * @returns `true` when it is lit.
   */
  isLit(target: InteractorTarget): boolean {
    return this.#lit.has(target.entity.name);
  }

  /**
   * How many pedestals are switched on.
   *
   * @returns The count.
   */
  get litCount(): number {
    return this.#lit.size;
  }

  /**
   * Which pedestals are switched on, so a save file can store them.
   *
   * @returns Their entity names, sorted.
   */
  litNames(): readonly string[] {
    return [...this.#lit].toSorted();
  }

  /**
   * Switches one pedestal without playing a sound or reporting it. This is what a save restore and
   * a reset use.
   *
   * @param target - The pedestal.
   * @param lit - Whether it should read as lit.
   */
  setLit(target: InteractorTarget, lit: boolean): void {
    const name = target.entity.name;
    if (lit) {
      this.#lit.add(name);
    } else {
      this.#lit.delete(name);
    }
    // `setBaseColor` writes the Lite material, which every renderer sharing this asset draws with.
    // `src/level.ts` gives each pedestal its own `clone`, which is what makes that safe here.
    target.material.value.setBaseColor(lit ? LIT_COLOR : IDLE_COLOR);
    target.glow.enabled = lit;
  }

  /**
   * What the crosshair is on.
   *
   * @returns The target, or `null` when nothing is in reach.
   */
  get focus(): InteractorTarget | null {
    return this.#focus;
  }

  /**
   * Switches one pedestal on or off.
   *
   * @param target - The pedestal.
   */
  #toggle(target: InteractorTarget): void {
    const name = target.entity.name;
    const lit = !this.#lit.has(name);
    this.setLit(target, lit);
    const clip = this.clip;
    if (clip !== null && clip.state === "loaded") {
      this.app.audio.playOneShot(clip.value, { volume: 0.6, pitch: lit ? 1 : 0.75 });
    }
    this.onToggled?.(name, lit);
    this.app.log.info("pedestal toggled:", name, lit ? "lit" : "dark");
  }
}
