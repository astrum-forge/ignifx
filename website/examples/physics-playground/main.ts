import { Camera, clamp, createMaterialAsset, pbrMaterialDefinition, physics } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { button, readout, select, slider } from "../_kit/panel.ts";
import { createLightRig } from "../_kit/stage.ts";
import { ARENA_HALF, buildArena, PILE, SHAPES } from "./arena.ts";
import { buildLooks, spawnBody } from "./bodies.ts";
import { DropControls, PLAYGROUND_ACTIONS } from "./controls.ts";
import type { ShapeName, Triple } from "./arena.ts";
import type { Body, SpawnRequest } from "./bodies.ts";
import type { ColorLike } from "ignifx";

/**
 * Rigid bodies on Havok: three collider shapes, a physics material you can change between drops,
 * and a tint that marks every body the simulation has stopped moving.
 *
 * Physics runs in `FixedUpdate`, on its own headless scene, at a rate the frame rate cannot move.
 * So everything that touches a body does it in `fixedUpdate` (`bodies.ts`) and everything that
 * reads a pointer does it in `update` (`controls.ts`), where the frame's input was captured. A
 * collider with no `Rigidbody` — the floor and the four kerbs — is placed once as a **static** body;
 * a collider with one falls.
 *
 * The opening pile is authored settled rather than dropped, which is what makes `?static=1` — the
 * clock stopped before `app.start()`, so no fixed step ever runs — a reproducible frame. `arena.ts`
 * holds that layout and the pit it stands in.
 */

/** The clear colour: the site's dark `--bg`, so the pit sits on the page's own ground. */
const CLEAR: ColorLike = { r: 0.051, g: 0.063, b: 0.082, a: 1 };

/** The kerb's colour, a shade of the site's `--sunk`. */
const KERB_COLOR: ColorLike = { r: 0.145, g: 0.169, b: 0.208, a: 1 };

/** The grid floor's tint. */
const FLOOR_COLOR: ColorLike = { r: 0.26, g: 0.28, b: 0.33, a: 1 };

/** Where the orbit camera looks, in metres: the middle of the pile rather than the floor. */
const FOCUS: Triple = { x: 0, y: 0.7, z: 0 };

/** How high a dropped body starts, in metres. */
const DROP_HEIGHT = 4.2;

/** How far a dropped body is scattered from where it was asked for, in metres. */
const DROP_SCATTER = 0.22;

/** How far from the centre the Drop button and the drop key place a body, in metres. */
const KEY_DROP_SPREAD = 3;

/** How many bodies the pit holds before the oldest is destroyed to make room. */
const BODY_CAP = 48;

/**
 * Where Havok's WebAssembly binary is served from.
 *
 * @remarks
 * `@ignifx/physics` declares the file in `ignifx.assets.public`, so the Vite plugin copies it
 * **unhashed, by base name** into the public asset path — `/examples/assets/HavokPhysics.wasm` for
 * this build. It is named here rather than left at `havokWasm: "auto"` because `auto` resolves the
 * bare file name through the asset manifest, whose `root` is the *relative* path `assets`: on a
 * page served from `/examples/<slug>/run/` that resolves against the document and asks for
 * `/examples/<slug>/run/assets/HavokPhysics.wasm`, which is a 404 and then `IGX-0903`. Vite's own
 * `BASE_URL` is the base the plugin wrote its URLs from, so this is right in `dev` and in `build`.
 */
const HAVOK_WASM = `${import.meta.env.BASE_URL}assets/HavokPhysics.wasm`;

/** The friction the panel opens on: a dry surface a crate does not slide across. */
const START_FRICTION = 0.55;

/** The restitution the panel opens on. Zero is a dead landing; one would never stop. */
const START_BOUNCE = 0.1;

/**
 * Writes a slider's value with two decimals, the resolution a physics material is authored at.
 *
 * @param value - The value.
 * @returns The text for the slider's value cell.
 */
function twoPlaces(value: number): string {
  return value.toFixed(2);
}

bootExample({
  title: "Physics playground",
  extensions: [physics()],
  settings: {
    rendering: {
      clearColor: CLEAR,
      msaaSamples: 4,
      // Read once, when `app.start()` registers the scene; asking afterwards is `IGX-0704`.
      features: { shadows: true },
    },
    // The rate the simulation advances at, whatever the frame rate does.
    time: { fixedDeltaTime: 1 / 60 },
    physics: { havokWasm: HAVOK_WASM },
  },

  async setup({ app, panel, random }) {
    app.registerComponents([DropControls]);
    app.input.loadActions(PLAYGROUND_ACTIONS);

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 200, fov: 46 });
    attachOrbit(app, eye, { yaw: 32, pitch: 33, distance: 6.6, target: FOCUS, minDistance: 3, maxDistance: 26 });
    createLightRig(app, { focus: FOCUS, keyIntensity: 2.9, shadowMapSize: 2048 });

    const kerb = createMaterialAsset(
      app,
      pbrMaterialDefinition({ name: "kerb", baseColor: KERB_COLOR, metallic: 0, roughness: 0.85 }),
      [],
    );
    await buildArena(app, { kerb, floor: FLOOR_COLOR });

    const looks = buildLooks(app);
    // The one object the two sliders edit, and the one every spawn copies. Mutable, so it is a
    // plain object literal rather than the readonly `PhysicsMaterialValues` a collider takes.
    const material = { friction: START_FRICTION, staticFriction: START_FRICTION, restitution: START_BOUNCE };
    const bodies: Body[] = [];
    let shape: ShapeName = "Box";

    const add = (request: SpawnRequest): void => {
      bodies.push(spawnBody(app, looks, material, request));
      // A rolling window rather than a refusal: the pit never fills up, and the frame's cost has a
      // ceiling a visitor cannot lift.
      while (bodies.length > BODY_CAP) {
        bodies.shift()?.entity.destroy();
      }
    };
    const drop = (x: number, z: number): void => {
      // The kit's seeded generator, never `Math.random`: two loads of one URL scatter alike.
      const scatter = (): number => (random() - 0.5) * 2 * DROP_SCATTER;
      add({
        shape,
        at: {
          x: clamp(x + scatter(), -ARENA_HALF, ARENA_HALF),
          y: DROP_HEIGHT,
          z: clamp(z + scatter(), -ARENA_HALF, ARENA_HALF),
        },
        turn: { x: random() * 360, y: random() * 360, z: random() * 360 },
        asleep: false,
      });
    };
    const dropAnywhere = (): void => {
      drop((random() - 0.5) * KEY_DROP_SPREAD, (random() - 0.5) * KEY_DROP_SPREAD);
    };
    const reset = (): void => {
      for (const body of bodies) {
        body.entity.destroy();
      }
      bodies.length = 0;
      for (const piled of PILE) {
        // `exactOptionalPropertyTypes` is on, so `turn` is either set or absent, never `undefined`.
        add({
          shape: piled.shape,
          at: piled.at,
          asleep: true,
          ...(piled.turn === undefined ? {} : { turn: piled.turn }),
        });
      }
    };
    reset();

    // Space and the gamepad's south button drop one too, so the example is playable with no
    // pointer at all.
    const controls = eye.addComponent(DropControls);
    controls.onFloorClick = drop;
    controls.onDropKey = dropAnywhere;

    panel({
      title: "Physics playground",
      groups: [
        {
          label: "Drop",
          controls: [
            select("Shape", SHAPES, {
              value: shape,
              change: (value: string): void => {
                shape = SHAPES.find((name: ShapeName) => name === value) ?? "Box";
              },
            }),
            button("Drop one", dropAnywhere),
            button("Reset", reset),
            readout("Bodies", (): string => `${String(bodies.length)} / ${String(BODY_CAP)}`),
            readout("At rest", (): string =>
              String(bodies.reduce((total: number, body: Body) => total + (body.tint.atRest ? 1 : 0), 0)),
            ),
          ],
        },
        {
          label: "Material",
          controls: [
            slider(
              "Friction",
              { min: 0, max: 1.2, step: 0.05, format: twoPlaces },
              {
                value: START_FRICTION,
                change: (value: number): void => {
                  material.friction = value;
                  material.staticFriction = value;
                },
              },
            ),
            slider(
              "Bounce",
              { min: 0, max: 0.9, step: 0.05, format: twoPlaces },
              {
                value: START_BOUNCE,
                change: (value: number): void => {
                  material.restitution = value;
                },
              },
            ),
            // A collider reads its material when its shape is built, so a slider reaches the next
            // body. Reset re-drops the pile, which is how you see a change on all of them at once.
            readout("Applies to", (): string => "the next body"),
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
