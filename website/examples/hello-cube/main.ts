import { Camera, createMaterialAsset, f32, MeshAsset, MeshRenderer, pbrMaterialDefinition, Script } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, button, color, readout, slider, toggle } from "../_kit/panel.ts";
import { createLightRig } from "../_kit/stage.ts";
import type { ColorLike, ScriptCallbacks } from "ignifx";

/**
 * The smallest complete ignifx app: a camera, a shadow-casting light rig, a ground plane, and a
 * spinning PBR cube. Every asset is built in code, so nothing is fetched and the whole program is
 * this one file.
 *
 * Read it top to bottom: a script class, then `bootExample`, then the world, then the panel that
 * drives it. That is the shape of every ignifx game — `templates/3d-third-person/src/main.ts` is
 * the same four steps with a thousand more lines between them.
 */

/** Where the cube's centre sits, half its height above the ground. */
const CUBE_HEIGHT = 0.65;

/** The cube's edge length, in metres. */
const CUBE_SIZE = 1.3;

/** The angle the cube starts at, so a frozen capture shows three faces rather than one. */
const START_ANGLE_DEGREES = 30;

/** The cube's colour when the page loads and when Reset is pressed, as the colour input writes it. */
const START_COLOR = "#ee6b29";

/** The cube's spin when the page loads and when Reset is pressed, in degrees per second. */
const START_SPEED = 45;

/**
 * Writes a slider's value as a rate.
 *
 * @param value - Degrees per second.
 * @returns The text for the slider's value cell.
 */
function degreesPerSecond(value: number): string {
  return `${String(value)}°/s`;
}

/** Spins its entity about Y. `speed` is a serialized field, in degrees per second. */
class Spinner extends Script.define({ speed: f32(START_SPEED) }) implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "hello-cube/Spinner";

  /** Reused so the per-frame path allocates nothing (coding standards §7). */
  readonly #step = { x: 0, y: 0, z: 0 };

  /**
   * Advances the rotation.
   *
   * @param dt - Seconds since the previous frame, already scaled by `time.timeScale`. Under
   * `?static=1` the scale is zero, so the cube holds {@link START_ANGLE_DEGREES}.
   */
  update(dt: number): void {
    this.#step.y = this.speed * dt;
    this.transform.rotate(this.#step);
  }
}

/**
 * Reads an `#rrggbb` string as an ignifx colour.
 *
 * @remarks
 * Every colour in the engine's public API is sRGB in `0…1` (`references/formats/material.md`), and
 * an `<input type="color">` reports sRGB in `0…255`. This is the whole conversion.
 *
 * @param hex - The colour, as `#rrggbb`.
 * @returns The colour, opaque.
 */
function fromHex(hex: string): ColorLike {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
    a: 1,
  };
}

bootExample({
  title: "Hello cube",
  settings: {
    rendering: {
      clearColor: { r: 0.043, g: 0.059, b: 0.094, a: 1 },
      msaaSamples: 4,
      // Shadows are a Babylon Lite opt-in, read once when `app.start()` registers the scene.
      // Asking for the feature afterwards throws `IGX-0704`, which is why it is a setting and not
      // a line in the panel's callback — the panel toggles the light's own `shadows.enabled`.
      features: { shadows: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  setup({ app, panel }) {
    app.registerComponents([Spinner]);

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 200, fov: 46 });
    attachOrbit(app, eye, {
      yaw: 34,
      // 30 degrees, not the 22 this started at: with a 46-degree vertical field of view the top of
      // the frame is 23 degrees above centre, so any pitch under that leaves the ground plane's
      // horizon — and a band of empty clear colour above it — in shot. Looking down past it fills
      // the frame with floor, which is what the cube needs to sit on.
      pitch: 30,
      distance: 5,
      target: { x: 0, y: CUBE_HEIGHT, z: 0 },
      minDistance: 2.2,
      maxDistance: 16,
    });

    const rig = createLightRig(app, { focus: { x: 0, y: CUBE_HEIGHT, z: 0 } });

    const slate = createMaterialAsset(
      app,
      pbrMaterialDefinition({
        name: "slate",
        baseColor: { r: 0.22, g: 0.24, b: 0.29, a: 1 },
        metallic: 0,
        roughness: 0.95,
      }),
      [],
    );
    // Wide enough that its far edge is beyond the vanishing line at this camera pitch, so the
    // frame reads as a floor under a night sky rather than as a tile floating in the void.
    const groundMesh = MeshAsset.ground(app, { width: 80, height: 80, subdivisions: 1 });
    app.world.createEntity("Ground").addComponent(MeshRenderer, {
      mesh: groundMesh,
      materials: [slate],
      castShadows: false,
      receiveShadows: true,
    });

    const ember = createMaterialAsset(
      app,
      pbrMaterialDefinition({ name: "ember", baseColor: fromHex(START_COLOR), metallic: 0.1, roughness: 0.35 }),
      [],
    );
    const cubeMesh = MeshAsset.box(app, { size: CUBE_SIZE });
    const cube = app.world.createEntity("Cube");
    cube.transform.localPosition.set(0, CUBE_HEIGHT, 0);
    cube.transform.localEulerAngles = { x: 0, y: START_ANGLE_DEGREES, z: 0 };
    cube.addComponent(MeshRenderer, { mesh: cubeMesh, materials: [ember], castShadows: true });
    const spinner = cube.addComponent(Spinner);

    panel({
      title: "Hello cube",
      groups: [
        {
          label: "Cube",
          controls: [
            // A serialized field is a plain property, which is all `bind` needs: read it once for
            // the slider's opening value, assign it on every change, and the next `update` uses it.
            slider("Spin", { min: 0, max: 240, step: 5, format: degreesPerSecond }, bind(spinner, "speed")),
            // Not `bind`: an `<input type="color">` speaks `#rrggbb` and a material speaks sRGB
            // 0-1. One material, one live edit, and no shader rebuild — the family is the same.
            color("Colour", {
              value: START_COLOR,
              change: (hex: string): void => {
                ember.value.setBaseColor(fromHex(hex));
              },
            }),
            button("Reset", (): void => {
              spinner.speed = START_SPEED;
              ember.value.setBaseColor(fromHex(START_COLOR));
              cube.transform.localEulerAngles = { x: 0, y: START_ANGLE_DEGREES, z: 0 };
            }),
            // The `shadows` *feature* stays on — it is what compiled the shadow pass. What a
            // graphics setting turns off is this light's own casting, which is a live flag.
            toggle("Shadows", bind(rig.key.shadows, "enabled")),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
            readout("Scripts", (): string => String(app.diagnostics.frame.scriptsUpdated)),
          ],
        },
      ],
    });
  },
});
