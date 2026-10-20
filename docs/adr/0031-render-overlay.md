# ADR-0031 · A render overlay drawn over the finished frame

**Status:** Accepted (2026-10-20, ratified by the owner) · **Date:** 2026-10-19 · **Deciders:** Astrum Forge Studios (owner)

## Context

The ignifx editor draws its gizmos, selection outline and grid in the scene view with Babylon Lite's gizmos, which need a second Lite scene over the app's frame (editor plan ask E12). Lite's answer is a utility layer, and editor spike S0.2 §3.2 found it broken in an ignifx app:

- `registerUtilityLayer` fixes the layer up against the **last** registered rendering context. Once `@ignifx/ui`'s text renderer or `@ignifx/2d`'s sprite renderer is registered after the render scene, that context has no frame graph, Lite configures nothing, and the layer clears the frame to transparent black.
- With MSAA on, Lite draws the layer only when the base scene resolves straight into the swapchain. The offscreen path of `rendering.features.postProcessing` (`07-rendering.md` §2.7) never does, so at the default MSAA 4 the gizmos were invisible though still draggable.

`@ignifx/editor-host` worked around both by reordering Lite's private `surface._renderingContexts` around the registration and by forcing `msaaSamples: 1` on every project.

Constraints: only `src/lite/**` imports Lite and Lite objects leave through documented `.lite` escape hatches (`CONSTITUTION.md` §3.4); a game pays nothing for a feature it does not use (§2.5); misuse throws a coded error (§3.9); GPU behaviour is proven in Chromium (§6.1).

## Options considered

1. **Keep the host's workaround.** No engine change. It depends on private Lite state, and it gives up MSAA for every project opened in the editor.
2. **Draw the overlay into the render scene's own target, before `ignifx:present`** (the wording of ask E12). Gizmos would go through bloom and tone mapping. The plain render path has no ignifx-owned target to draw into. A `"sprite"`-mode sprite renderer clears the frame after the render scene and would erase the overlay.
3. **Draw the overlay over the finished frame**, as the last rendering context, into the swapchain with its own depth buffer. It reads only what was presented, so the MSAA setting, the render path, post-processing, sprites and text do not matter.

## Decision

Option 3, as these rules.

- **API.** `app.renderer.openOverlay(): Promise<RenderOverlay>` (`@beta`). `RenderOverlay.lite` is `{ scene, mainScene }`, the shape Lite's gizmo constructors take as a `UtilityLayer`; `RenderOverlay.dispose()` releases it and is idempotent. `app.dispose()` releases any overlay still open. A headless app, or a call before `app.start()` has registered the render scene, throws `IGX-0728`. A call on a disposed app, or one whose app is disposed while it awaits, disposes what it opened and throws `IGX-0106`.
- **Scene.** The overlay scene has no default render task, follows the render scene's camera every frame, and has the hemispheric light (intensity 2) `createUtilityLayer` adds. It is registered while its frame graph is empty, so Lite's swapchain fix-up finds nothing to change; its one render task is added afterwards.
- **Task.** It draws into the swapchain with `clr: false` and `sharedRt: true`, over a single-sample depth target of its own, cleared every frame. What the overlay holds is never hidden by the scene. It is drawn without MSAA.
- **Order.** The overlay stays the last rendering context. Each frame it compares its place in `getRenderingContexts`; when a context other than another overlay follows it, it unregisters, drops its task, registers again and rebuilds the task, after the frame has been submitted. That frame draws no overlay. A failed move is reported through `app.onError` and retried on the next animation frame, three attempts in all.
- **Cost.** The overlay module is reached through a dynamic `import()` on the first `openOverlay()`.

## Consequences

- The editor host deletes its `_renderingContexts` reach-in and its `msaaSamples: 1` forcing; the scene view keeps the project's MSAA setting.
- Screenshots include the overlay, since Lite captures after every context has recorded. A host that wants a capture without gizmos hides them first, as it already does.
- Overlay helpers are aliased: the overlay has no MSAA of its own. Multisampling it would need its own colour target composited over the frame, which Lite 1.34 has no blending copy for.
- A Lite scene registered with `registerScene` while an overlay is open is fixed up by Lite against the overlay, and at MSAA above 1 Lite disables that scene's default task. ignifx registers no such scene after `app.start()`; a third-party package that does should register before opening an overlay.
- The order check relies on `getRenderingContexts`, `unregisterScene`, `registerScene` and `FrameGraph.dispose`, all public in Lite 1.34. A Lite upgrade (§4.6) re-runs `packages/core/test/lite/render/overlay.browser.test.ts`, which reproduces both S0.2 failures with Lite's own utility layer.
- Revisit when Lite offers an overlay that composites against a named base scene, or a hook after the last context.
