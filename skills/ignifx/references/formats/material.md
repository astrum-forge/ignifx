# Material files (`.material.json`)

Hand-written companion to the generated field table in
[`ignifx.material.md`](ignifx.material.md). Rationale in
`docs/architecture/07-rendering.md` §2.6 and `06-serialization-and-scene-format.md` §6.

A material file loads as a `MaterialAsset`, which a `MeshRenderer.materials` entry or a
`Model.materialOverrides` entry points at. `MATERIAL_FILE_FORMAT` is `"ignifx.material"`,
`MATERIAL_FORMAT_VERSION` is `1`, and the extension is `.material.json`
(`MATERIAL_FILE_EXTENSION`). Every colour is **sRGB**; every factor is unitless.

## PBR

```json
{
  "format": "ignifx.material",
  "formatVersion": 1,
  "type": "pbr",
  "name": "hero-body",
  "baseColor": [0.8, 0.32, 0.12, 1],
  "metallic": 0,
  "roughness": 0.55,
  "emissive": [0, 0, 0, 1],
  "alphaMode": "opaque",
  "doubleSided": false,
  "baseColorTexture": { "$asset": "textures/hero-basecolor.png" },
  "normalTexture": { "$asset": "textures/hero-normal.png" }
}
```

- Texture slots (`PBR_TEXTURE_SLOTS`, resolved in this order): `baseColorTexture`,
  `metallicRoughnessTexture`, `normalTexture`, `emissiveTexture`, `occlusionTexture`. Each is an
  `{ "$asset": … }` reference or `null`, and each is loaded as a dependency of the material.
- Factors: `metallic`, `roughness`, `normalScale`, `occlusionStrength`, `environmentIntensity`,
  `alpha`, `alphaCutoff`. Flags: `doubleSided`, `unlit`.

## Standard

```json
{
  "format": "ignifx.material",
  "formatVersion": 1,
  "type": "standard",
  "name": "ui-panel",
  "diffuse": [1, 1, 1, 1],
  "specular": [0.2, 0.2, 0.2, 1],
  "specularPower": 64,
  "diffuseTexture": { "$asset": "textures/panel.png" }
}
```

Texture slots (`STANDARD_TEXTURE_SLOTS`): `diffuseTexture`, `specularTexture`, `emissiveTexture`,
`normalTexture`, `opacityTexture`.

## Rules

| Rule                | Detail                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `type`              | `MATERIAL_KINDS` is `"pbr" \| "standard" \| "shader"`; `"shader"` is declared, not built yet     |
| Unknown family      | `IGX-0708` — the file names a family this build cannot construct                                 |
| Wrong header        | `IGX-0709` — the file is not the ignifx description format it claims                             |
| `alphaMode`         | `MATERIAL_ALPHA_MODE_NAMES` is `"opaque" \| "mask" \| "blend"`; `"mask"` uses `alphaCutoff`      |
| Omitted fields      | Take the schema defaults, so a file only states what differs                                     |
| Sharing             | One asset, many renderers. `materialAsset.clone(app)` makes a per-object copy in the same family |

## The same material in code

A material does not need a file. `pbrMaterialDefinition(overrides?)` and
`standardMaterialDefinition(overrides?)` build a `MaterialDefinition`, and
`createMaterialAsset(app, definition, textures)` publishes it at a `memory:` address:

```ts
import { createApp, createMaterialAsset, pbrMaterialDefinition } from "@ignifx/core";

const app = await createApp({ headless: true });
const ember = createMaterialAsset(
  app,
  pbrMaterialDefinition({ name: "ember", baseColor: { r: 0.93, g: 0.42, b: 0.16, a: 1 }, roughness: 0.35 }),
  [],
);
ember.value.setMetallicRoughness(0.1, 0.35);
app.log.info("material kind:", ember.value.kind);
ember.release();
app.dispose();
```

`MaterialAsset` also carries `setBaseColor(color)`, `setAlpha(alpha)`, `name`, `definition`,
`textures`, and the unstable `lite.material`. An in-code material cannot be serialized into a scene
file (`IGX-0602`): write a `.material.json` when it has to round-trip.
