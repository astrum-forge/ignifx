import { customEffect, PostProcessStack, SHADER_ASSET_TYPE, TextureAsset } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { readout, select, slider, toggle } from "../_kit/panel.ts";
import { bakeLutStrip, LUT_SIZE, LUT_WIDTH } from "./lut.ts";
import { CLEAR_COLOR, createShot, EFFECTS, SWAPPABLE } from "./shot.ts";
import type { EffectRow } from "./shot.ts";
import type { PanelControl } from "../_kit/panel.ts";
import type { CustomEffectSettings, ShaderAsset } from "ignifx";

/**
 * Five hand-written full-screen effects on one `PostProcessStack`.
 *
 * ## What a `.post.wgsl` is
 *
 * A file that declares `// @ignifx post` and provides `fn mainFragment(in: PostInput) -> vec4<f32>`
 * — a **plain function**, not an entry point. Babylon Lite's fullscreen path calls `effectFragment`
 * by name, so ignifx generates that entry point and makes it forward here with a `PostInput` it
 * filled in: `uv` across the frame, and the fragment's backing-store pixel. `inputTexture` is the
 * chain's current colour, and `shaderUniforms` always carries `screenSize`, `time`, `unscaledTime`
 * and `deltaTime` before whatever the file declared for itself.
 *
 * ## Two lines of settings and one callback
 *
 * `features.postProcessing` renders the scene into an offscreen target so a pass has something it is
 * allowed to sample. It is read **once**, when `app.start()` registers the scene — asking afterwards
 * is `IGX-0704` — and without it the stack logs `IGX-0710` and does nothing at all. And the effects
 * are switched on **after** `app.start()`, which is what `afterStart` is for: a task recorded before
 * the scene is registered samples the swapchain, and WebGPU rejects that frame.
 *
 * ## What costs a rebuild and what does not
 *
 * Writing a **value** into an effect's `values` record re-uploads its uniform buffer on the next
 * `PreRender` — that is what the sliders do, and it is why they are cheap enough to drag. Changing
 * which effects exist, their `order`, or their textures rebuilds the chain, which is why the toggles
 * and the Order select are settings controls. `taskCount` below is the frame graph's own count, so
 * it is the honest answer to "how many passes am I paying for".
 *
 * `shot.ts` beside this file builds the lit frame; `lut.ts` bakes the grade the LUT effect samples.
 */

bootExample({
  title: "Custom post-processing",
  settings: {
    rendering: {
      clearColor: CLEAR_COLOR,
      msaaSamples: 4,
      features: { shadows: false, postProcessing: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel, afterStart, random }) {
    const eye = await createShot(app);

    const shaders = EFFECTS.map((row: EffectRow) =>
      app.assets.load<ShaderAsset>(row.address, { type: SHADER_ASSET_TYPE }),
    );
    await Promise.all(shaders.map((handle) => handle.promise));

    // The grade is a 16 x 16 x 16 cube baked in code and handed to the GPU as tightly packed RGBA8
    // bytes. `linear` filtering is what lets the shader interpolate between entries; `clamp` is what
    // stops the top of the red axis wrapping round to the bottom.
    const lut = TextureAsset.fromPixels(app, "custom-post-process/lut", bakeLutStrip(), LUT_WIDTH, LUT_SIZE, {
      filter: "linear",
      wrap: "clamp",
    });

    const post = eye.addComponent(PostProcessStack);
    const settings = new Map<string, CustomEffectSettings>();
    for (let index = 0; index < EFFECTS.length; index += 1) {
      const row = EFFECTS[index];
      const shader = shaders[index];
      if (row === undefined || shader === undefined) {
        continue;
      }
      const effect = customEffect({
        shader,
        // Every effect starts off and is switched on in `afterStart`; see the note above.
        enabled: false,
        order: row.order,
        values: {
          [row.control.name]: row.control.value,
          // The grain is seeded from the kit's generator rather than from `time`, so `?seed=1`
          // always produces the same speckle and the golden of this frame cannot rot.
          ...(row.label === "Film grain" ? { seed: Math.floor(random() * 4096) } : {}),
        },
        textures: row.label === "Colour LUT" ? { lut } : {},
      });
      settings.set(row.label, effect);
      post.custom.push(effect);
    }
    afterStart((): void => {
      for (const row of EFFECTS) {
        const effect = settings.get(row.label);
        if (effect !== undefined) {
          effect.enabled = row.enabled;
        }
      }
    });

    const [firstLabel, secondLabel] = SWAPPABLE;
    const orders = [`${firstLabel} first`, `${secondLabel} first`];
    const controls: PanelControl[] = [
      toggle("Stack enabled", {
        value: true,
        change: (on: boolean): void => {
          // The **component's** `enabled`, not each effect's: a frame graph cannot have a task
          // removed, so a disabled stack keeps its chain and skips it — one branch a frame.
          post.enabled = on;
        },
      }),
      select("Order", orders, {
        value: orders[0] ?? "",
        change: (label: string): void => {
          const first = settings.get(firstLabel);
          const second = settings.get(secondLabel);
          if (first === undefined || second === undefined) {
            return;
          }
          const firstIsFirst = label === orders[0];
          first.order = firstIsFirst ? 20 : 30;
          second.order = firstIsFirst ? 30 : 20;
        },
      }),
      readout("Post-process tasks", (): string => String(post.taskCount)),
    ];

    panel({
      title: "Custom post-processing",
      groups: [
        { label: "Chain", controls },
        ...EFFECTS.map((row: EffectRow) => ({
          label: row.label,
          collapsed: !row.enabled,
          controls: [
            toggle("Enabled", {
              value: row.enabled,
              change: (on: boolean): void => {
                const effect = settings.get(row.label);
                if (effect !== undefined) {
                  effect.enabled = on;
                }
              },
            }),
            slider(
              row.control.label,
              {
                min: row.control.min,
                max: row.control.max,
                step: row.control.step,
                format: (value: number): string => (row.control.step < 1 ? value.toFixed(2) : String(value)),
              },
              {
                value: row.control.value,
                change: (value: number): void => {
                  const effect = settings.get(row.label);
                  if (effect !== undefined) {
                    effect.values[row.control.name] = value;
                  }
                },
              },
            ),
          ],
        })),
      ],
    });
  },
});
