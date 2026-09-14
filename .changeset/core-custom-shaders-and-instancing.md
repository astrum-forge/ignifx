---
"@ignifx/core": minor
---

- Add shader materials: a `.wgsl` file with `// @ignifx` pragma comments declares its uniforms, textures, storage buffers, defines and pipeline state, and loads as a `ShaderAsset`. A `.material.json` with `"type": "shader"` or `shaderMaterialDefinition({ shader, values, textures, defines })` applies values to it.
- Add `MaterialAsset.setUniform`, `getUniform`, `setTexture`, `setDefine` and `setStorageBuffer` to edit a live shader material. An unknown name throws `IGX-0712`, a wrong value shape `IGX-0713`, and a call on a PBR or Standard material `IGX-0718`.
- Upload `time`, `unscaledTime`, `deltaTime`, `mainLightDirection`, `mainLightColor` and `ambientColor` every frame to shaders that declare them. `time` freezes while the app is paused. A main-light uniform with no directional light logs `IGX-0714` once.
- Rebuild every material built from a `.wgsl` file in place when the file is replaced by hot reload. A compile failure keeps the last good material and reports `IGX-0715`.
- Add surface shaders: `.surface.wgsl` files with `displace`, `surface` and `composite` hooks attach to PBR materials through `surfaces`, keeping lights, shadows and image-based lighting. They require `rendering.features.materialPlugins` (`IGX-0716`).
- Add custom post effects: `.post.wgsl` files run in `PostProcessStack.custom`, ordered with the built-in effects.
- Add `InstancedMeshRenderer` for thin instances of one mesh with `setMatrices`, `setColors`, `setCount`, GPU culling and an LOD partner mesh. Changing `gpuCulling` or `lod` after the scene is registered throws `IGX-0717`; writing past `capacity` throws `IGX-0721`.
- Add `createStorageBufferAsset` and `StorageBufferAsset.update` (`IGX-0720` past the end), `TextureAsset.fromPixels` and `textureAsset.update` (`IGX-0722` on a size mismatch), and `MeshAsset.updatePositions`, `updateNormals`, `updateUvs` and `updateColors` for `fromData` meshes (`IGX-0725` when the range does not fit). `MeshAsset.fromData` accepts `uvs2`, `tangents` and `colors`.
- Shader materials cast PCF and CSM shadows. Babylon Lite 1.27.0 cannot render them into ESM shadow maps, so they are left out of ESM caster lists with one `IGX-0724` warning.
- Register the `IGX-16xx` (terrain) and `IGX-17xx` (particles) error ranges.
- Fix a black canvas after a material swap: two renderable rebuilds could overlap while Babylon Lite rebuilt its frame graph, leaving a render pass without a colour attachment. Rebuilds now run one at a time.
- Fix `Environment.fog`: the fog settings never reached the GPU, so fogged scenes rendered without fog. Fog now renders, with the colour decoded once, and `mode: "none"` turns it off on pipelines that were compiled with fog.
