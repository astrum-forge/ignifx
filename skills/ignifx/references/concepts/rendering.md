# Rendering

ignifx does not render; Babylon Lite does. Six components describe what a frame contains, one
`PreRender` system reconciles them with the Lite scene, and `app.renderer` owns everything that is
not attached to an entity. Rationale in `docs/architecture/07-rendering.md`.

```
Entity ──▶ Camera | Light | MeshRenderer | Model | Environment | PostProcessStack
                     │
       PreRender ──▶ render-sync (order 900) ──▶ Lite scene ──▶ frame
```

## 1. The components

Exact fields and defaults are in [`../formats/components.md`](../formats/components.md); this is
what they mean.

| Component          | What it adds                                                      | Notes                                                                                                 |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Camera`           | A view. The **entity's transform is the view**; no follow logic   | `projection`, `fov` (degrees), `orthographicSize`, `near`/`far`, `viewport`, `clearColor`, `priority` |
| `Light`            | `"directional" \| "point" \| "spot" \| "hemispheric"`             | `shadows` is a sub-record; only directional and spot lights can cast (`IGX-0703`)                     |
| `MeshRenderer`     | One clone of a `MeshAsset`, drawn with a `MaterialAsset`          | `allowMultiple`; several renderers per entity are fine                                                |
| `Model`            | One instance of a loaded glTF, cloned under the entity's node     | `nodes`, `attachToNode(name, entity)`, `materialOverrides`; `animations`/`skeletons` are `@beta`      |
| `Environment`      | Image-based lighting, skybox, fog, image processing, clear colour | **One per world**; a second enabled one logs `IGX-0705` and the most recent wins                      |
| `PostProcessStack` | `bloom`, `smaa`, `imageProcessing`, as one frame-graph chain      | Needs `features.postProcessing`, or it logs `IGX-0710` and does nothing (§3)                          |

- `Camera` also answers geometry questions: `screenToRay(x, y)`, `worldToScreen(point, out)`,
  `screenToWorldPoint(x, y, distance, out)`, `viewportToWorldPoint(u, v, distance, out)`,
  `getViewMatrix(out)`, `getProjectionMatrix(out)`.
- The enabled camera with the highest `priority` becomes `world.mainCamera` and renders; ties break
  on creation order. A world with **no** enabled camera renders nothing and logs `IGX-0706` once.
- `MeshRenderer.materials` keeps its array shape, but this Babylon Lite version has one material per
  mesh: index 0 is used, the rest are accepted and ignored, and an empty array draws with the
  renderer's neutral default material.
- `Light.includeOnly` and `exclude` are entity lists, matched on the entity uid Lite carries as the
  mesh id.
- `castShadows` and `receiveShadows` mean the same thing on a `MeshRenderer` and on a `Model`. For a
  model they cover the **whole** instantiated glTF subtree: every mesh in it casts, and every mesh in
  it takes the receive flag. A hidden renderer or model casts nothing. A caster that appears at
  runtime joins the shadow maps a frame or two later than it appears on screen, because the caster
  lists are only rebuilt once the renderable rebuild it triggered has settled.
- Exactly one thing clears the frame, so the three fields that can set it are ranked:
  `Camera.clearColor` on the main camera wins whenever it is not `null`, then
  `Environment.clearColor`, then the `rendering.clearColor` setting (§4), which is applied as the
  scene is created. Setting a camera's back to `null` leaves whatever is there; it does not restore
  the setting.
- A `Light` is driven by the entity's transform: a directional or spot light shines along the
  entity's forward (`+Z`) axis, a point or spot light sits at its position, and a hemispheric light's
  sky direction is the entity's up (`+Y`) axis. Point it with `entity.transform.lookAt(target)`.
  Unlike every other render component, the Lite light is **not** parented under the entity — ignifx
  writes the world pose onto it each frame instead, so that what the light shades and what it casts
  can never disagree.

## 2. The `PreRender` sync

One system, `ignifx/render-sync`, runs late in `Phase.PreRender` (order 900) and:

1. writes only the fields that changed since the frame before — which is why a script may assign
   `renderer.castShadows = false` anywhere and it lands next frame, with no dirty API;
2. materialises `entity.activeInHierarchy && component.enabled` onto Lite's `visible` — **never** by
   removing anything, because Lite disposes a mesh that leaves its last scene;
3. coalesces every topology change of the frame (a mesh added, a light added, a shadow generator
   attached) into one `rebuildSceneRenderables`;
4. selects the main camera, rebuilds the shadow-caster lists, and picks the one `Environment`.

It never copies transforms: cameras, lights, and mesh clones are parented under the entity's Lite
node, so an entity that moved is already where it should be.

## 3. `app.renderer`

| Member                          | Purpose                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `pixelRatio`, `resolutionScale` | DPR clamp (`0` does not clamp) and a `0.25…1` downscale                            |
| `setSize(width, height)`        | `OffscreenCanvas` only; a laid-out DOM canvas re-reads its layout size every frame |
| `features`                      | The resolved `RenderingFeatureSettings`, read-only after `app.start()`             |
| `requireFeature(feature)`       | Turns a feature on **before** start; afterwards it throws `IGX-0704`               |
| `warmUp(materials)`             | Compiles a material family now instead of on the frame a mesh first appears        |
| `pickAsync(x, y, options?)`     | GPU pick → `RenderPick \| null`; resolves to `null` headless                       |
| `captureScreenshot()`           | `RenderCapture`; rejects with `IGX-0707` when no render loop is running            |
| `drawCalls`, `gpuFrameTimeMs`   | Per-frame counters, mirrored in the `render` diagnostics group                     |
| `profileTasks`, `taskTimings()` | Per-task GPU timings; `status` is `"unsupported"` headless                         |

## 4. Settings and feature opt-ins

The `rendering` settings section is read once, at `createApp`:

```ts
import { createApp } from "@ignifx/core";

const app = await createApp({
  headless: true,
  settings: {
    rendering: {
      features: { shadows: true, postProcessing: true, deviceLostRecovery: true },
      msaaSamples: 4,
      clearColor: { r: 0.06, g: 0.06, b: 0.08, a: 1 },
      maxDevicePixelRatio: 2,
    },
  },
});
app.log.info("shadows on:", app.renderer.features.shadows);
app.dispose();
```

Babylon Lite enables several features only through calls that must happen **before the scene is
registered**, which `app.start()` does. So they are declared up front: `shadows`, `postProcessing`,
`skeletons`, `boneControl`, `stencil`, `lightmaps`, `materialPlugins`, `asyncPipelines`,
`deviceLostRecovery`, all `false` by default. An extension declares what it needs with
`ctx.requireRenderingFeature("skeletons")` during registration; anything later is `IGX-0704`.
Turning a light's `shadows.enabled` on without the `shadows` feature gives you a light with no
shadow pass.

`postProcessing` is the one that changes the shape of the frame rather than what gets compiled. A
post-process effect has to _sample_ what the scene drew, and a WebGPU canvas texture cannot be
sampled — binding it rejects the whole frame, and the page goes black. So with the feature on, the
scene is rendered into an offscreen target and a copy pass composites it onto the canvas; a
`PostProcessStack` reads that offscreen target and its last effect writes the canvas instead of the
copy. It costs one full-screen blit per frame while no effect is enabled, which is why it is
opt-in. Attach a `PostProcessStack` without it and you get `IGX-0710` once, and an inert component.

Two things follow for a stack you do enable. `imageProcessing` is always applied **last**, whatever
`order` you give it, because Lite's grading pass writes the canvas and hands nothing on. And nothing
can be removed from a frame graph, so an effect that has been recorded is switched off rather than
freed — set `stack.enabled = false` to bypass the whole chain, and the plain scene comes back.

The rest of the section: `msaaSamples` (1 or 4, default 4), `alphaMode` (`"opaque"` or
`"premultiplied"`), `srgb`, `format`, `maxDevicePixelRatio`, `useHighPrecisionMatrix`,
`useFloatingOrigin`, `requiredLimits`, `clearColor` (a color **object**, `{ r, g, b, a }` in sRGB — a
hex string is only ever a schema _default_ — applied to the scene as it is created, and overridden by
an `Environment` or the main camera, §1), and `brdfLut` (defaults to `DEFAULT_BRDF_LUT_ADDRESS`).
There is no `powerPreference`: Lite always asks for a high-performance adapter.

## 5. Material warm-up (ADR-0014)

A mesh whose material family did not exist when the scene was registered takes Babylon Lite's
runtime build path, and the spike measured **3 extra frames before it is visible** — against 0–2
when the family was warmed, and 0 when a mesh of that family was already being drawn. So
`app.start()` warms every material in the `boot` preload group before registering the scene, and
`app.renderer.warmUp(materials)` does the same for anything loaded later, at a moment the game
chooses.

## 6. Picking

- `app.renderer.pickAsync(x, y, { filter })` — a GPU pick in CSS pixels, resolving to
  `{ entity, component, point, normal, distance }` or `null`. Calls are serialized per picker.
- `world.raycastRender(ray, { filter })` — the synchronous CPU path, against renderable meshes.
  Build the ray with `camera.screenToRay(x, y)` or `createRay()`.
- Both skip a renderer whose `pickable` is `false`. Physics raycasts are a different thing and
  arrive with `@ignifx/physics`.

## 7. Headless

Under `createApp({ headless: true })` there is no device: `MeshAsset` factories build no geometry,
`MeshRenderer`/`Model` keep their fields and touch no scene, `lite.mesh` is `null`, `pickAsync`
resolves to `null`, and `captureScreenshot()` rejects with `IGX-0707`. Transforms, component state,
scene loading, and `world.raycastRender` still work, which is why tests assert on component state
rather than on Lite scene contents.

## 8. Device loss

With `features.deviceLostRecovery` on, Babylon Lite rebuilds its resources after the WebGPU device
is lost. The three signals are on `app.events`:

| Signal                   | Payload                          | Meaning                                       |
| ------------------------ | -------------------------------- | --------------------------------------------- |
| `onDeviceLost`           | `{ reason, message }`            | Rendering is suspended while Lite rebuilds    |
| `onDeviceRecovered`      | —                                | The device and its resources are back         |
| `onDeviceRecoveryFailed` | whatever the recovery path threw | Unrecoverable; offer the player a page reload |

Lite cannot recover PCF/CSM shadow generators or glTF `EXT_lights_image_based` environments, so a
scene using either is expected to reach `onDeviceRecoveryFailed`. Connect with `{ owner: this }`
from a script, as with any signal.
