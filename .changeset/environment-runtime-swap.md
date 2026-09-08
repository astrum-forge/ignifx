---
"@ignifx/core": minor
---

`Environment` switches the world's image-based lighting at runtime, and reports a `skybox` it cannot honour

Assigning a different **loaded** `AssetHandle<EnvironmentAsset>` to `Environment.environment` now
moves the scene onto that asset's own cube map instead of only re-aiming whatever the asset loader
had installed. Babylon Lite 1.27.0 declares no public way to replace a registered scene's
environment, so the adapter writes the single field every consumer of it reads — `scene._envTextures`,
the field `loadEnvironment` assigns and Lite's own device-lost recovery replaces — through
`installSceneEnvironment` in `src/lite/gpu/environment.ts`, whose header records the `lib/` line
behind each claim; a browser test pins the name. The diffuse harmonics follow on the next frame and
the specular reflection one frame later, when the render-sync system fires the frame's one
`rebuildSceneRenderables` (a PBR bind group holds the cube map's texture view, so only a rebuild
re-binds it). Installing also re-applies rotation, blur, and image processing, because
`loadEnvironment` overwrites `scene.imageProcessing` on every load. Both assets keep their GPU
resources while their handles are retained, so switching back and forth is free. Assigning `null`
means "stop steering", not "go dark": Lite has no inverse of `loadEnvironment`, so the last
installed environment keeps lighting the scene and `Environment.installed` keeps naming it.

`Environment.skybox` is now read every frame, but it still cannot change the background, and that is
Lite's shape rather than an oversight: Lite builds the background inside `loadEnvironment`, as a
`Renderable` with no visibility flag, no size, and no handle, queued in the scene's deferred
builders and drained only by `registerScene`. So the `.environment.json` stays the authority, a
`skybox` record *set* to something the installed environment did not deliver logs the new
`IGX-0711` once per component instead of being silently ignored — a field still at its schema default
reports nothing — and an environment loaded after `app.start()` gets no background at all. A
declaration that enables a skybox and names no image now passes the `.env` as its own `skyboxUrl`,
which selects Lite's HDR cube background over the flat box painted in a snapshot of the clear
colour — so a bare `.env` finally draws a real background. A world that switches environments at
runtime wants `skyboxEnabled: false` and an `Environment.clearColor`.

New public API: `EnvironmentSkyboxSettings` (the named type of the `skybox` record) and
`CoreErrorCode.skyboxFixedAtLoad` (`IGX-0711`).
