import { Camera, createRay, defineInputActions, MeshRenderer, Vec3 } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { button, readout, toggle } from "../_kit/panel.ts";
import { createGridGround, createLightRig } from "../_kit/stage.ts";
import { ClickToPick, PICK_ACTIONS } from "./click-to-pick.ts";
import { CLEAR_COLOR, createPickableScene, SHOT } from "./scene.ts";
import type { Picker } from "./click-to-pick.ts";
import type { RenderPick } from "ignifx";

/**
 * Compare GPU picking with a CPU render raycast at the same backing-store pixel.
 * GPU timing includes readback; CPU picking needs retained mesh positions. Both use `pickable`
 * and filters, so hiding a mesh alone does not exclude it.
 * Input pointer positions already use the pixel space these APIs expect.
 */

/** What one resolved pick is remembered as, for the readouts. */
interface PickResult {
  /** What was hit, or a dash for a miss. */
  readonly label: string;
  /** How long the call took, in milliseconds; `0` before either path has answered. */
  readonly ms: number;
}

/** Neither path has answered yet. */
const UNPICKED: PickResult = { label: "click a shape", ms: 0 };

/**
 * Writes one result as `Sphere · 0.42 ms`.
 *
 * @param result - The result to write.
 * @returns The text for a readout cell.
 */
function describe(result: PickResult): string {
  return result.ms === 0 ? result.label : `${result.label} · ${result.ms.toFixed(2)} ms`;
}

/**
 * Names what a pick found.
 *
 * @param hit - The pick, or `null` for a miss.
 * @returns The entity's name, or a dash.
 */
function nameOf(hit: RenderPick | null): string {
  return hit === null ? "— nothing" : hit.entity.name;
}

bootExample({
  title: "Picking",
  settings: {
    rendering: { clearColor: CLEAR_COLOR, msaaSamples: 4, features: { shadows: true } },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, canvas, panel, afterStart }) {
    app.registerComponents([ClickToPick]);
    // `loadActions` merges by map name, so the orbit camera's own map is untouched.
    app.input.loadActions(defineInputActions(PICK_ACTIONS));

    const eye = app.world.createEntity("Main Camera");
    const camera = eye.addComponent(Camera, { near: 0.1, far: 200, fov: SHOT.fov });
    attachOrbit(app, eye, {
      yaw: SHOT.yaw,
      pitch: SHOT.pitch,
      distance: SHOT.distance,
      target: SHOT.target,
      minDistance: 2,
      maxDistance: 14,
    });
    createLightRig(app, { focus: SHOT.target, shadows: true, shadowDarkness: 0.25 });
    // Darker than the kit's default so a grey shape reads against it, and so the one orange shape
    // is the only thing in the frame the eye goes to.
    const ground = await createGridGround(app, { size: 24, color: { r: 0.17, g: 0.19, b: 0.23, a: 1 } });
    const scene = createPickableScene(app);

    let cpu = UNPICKED;
    let gpu = UNPICKED;
    let agree = "—";
    // One ray, reused: `screenToRay` writes into what it is given, so a pick allocates nothing
    // (coding standards §7).
    const ray = createRay();

    const picker: Picker = {
      pickAt(x: number, y: number): void {
        // The CPU path first, because it is synchronous and it is what sets the highlight — so a
        // capture is the same frame whatever the device does with the GPU pick.
        const cpuStart = performance.now();
        const filled = camera.screenToRay(x, y, ray);
        const cpuHit = filled === null ? null : app.world.raycastRender(filled);
        cpu = { label: nameOf(cpuHit), ms: performance.now() - cpuStart };
        scene.highlight(cpuHit?.entity ?? null);

        const gpuStart = performance.now();
        agree = "waiting for the device";
        void app.renderer
          .pickAsync(x, y)
          .then((gpuHit: RenderPick | null): void => {
            gpu = { label: nameOf(gpuHit), ms: performance.now() - gpuStart };
            agree = gpuHit?.entity === cpuHit?.entity ? "yes" : "no — read the two rows above";
          })
          .catch((error: unknown): void => {
            gpu = { label: "the pick failed", ms: 0 };
            app.log.warn("pickAsync:", error);
          });
      },
    };
    app.world.createEntity("Pointer").addComponent(ClickToPick).picker = picker;

    // One pick before the first frame is called settled, so the example opens on an answer rather
    // than on an instruction — and so a `?static=1` capture shows the highlight. Where to pick
    // comes from `worldToScreen`, which is `screenToRay`'s inverse and answers in the same
    // backing-store pixels the pick calls take: project a shape's centre, then pick that pixel.
    const projected = new Vec3();
    afterStart((): void => {
      camera.worldToScreen(scene.opening.transform.position, projected);
      picker.pickAt(projected.x, projected.y);
    });

    panel({
      title: "Picking",
      groups: [
        {
          label: "The same pixel, twice",
          controls: [
            readout("GPU pickAsync", (): string => describe(gpu)),
            readout("CPU raycastRender", (): string => describe(cpu)),
            readout("Same entity", (): string => agree),
            button("Pick the centre", (): void => {
              picker.pickAt(canvas.width / 2, canvas.height / 2);
            }),
            button("Clear", (): void => {
              scene.highlight(null);
              cpu = UNPICKED;
              gpu = UNPICKED;
              agree = "—";
            }),
          ],
        },
        {
          label: "Scene",
          collapsed: true,
          controls: [
            // `pickable` is what both paths skip, which is what makes "pick only the pickups" a
            // property of the mesh rather than a filter written at every call site.
            toggle("Ground is pickable", {
              value: false,
              change: (on: boolean): void => {
                const renderer = ground.entity.getComponent(MeshRenderer);
                if (renderer !== null) {
                  renderer.pickable = on;
                }
              },
            }),
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
            readout("Pickable shapes", (): string => String(scene.count)),
          ],
        },
      ],
    });
  },
});
