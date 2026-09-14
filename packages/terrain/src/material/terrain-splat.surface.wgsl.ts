import { LAYERS_PER_CONTROL_MAP } from "./splat-rules.js";
import type { ColorLike } from "@ignifx/core";

/**
 * The `terrainSplat` surface shader, generated per terrain
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.2).
 *
 * The layer count, which layers are triplanar and which carry a normal map all change the WGSL's
 * shape, so the file is generated rather than shipped. `surface()` reads the control maps at
 * `(worldPosition.xz - origin) * invSize + 0.5`, normalises the weights, and blends each layer's
 * albedo into `baseColor` with `textureSampleGrad`, whose gradients are legal outside uniform
 * control flow. With no albedo array bound the layers blend their tints alone and the file declares
 * no array sampler at all, because Babylon Lite cannot bind a `texture_2d` fallback to one.
 */

/**
 * The name the terrain's splat shader answers to on its material.
 *
 * @public
 */
export const TERRAIN_SPLAT_NAME = "terrainSplat";

/**
 * One layer's compile-time shape.
 *
 * @public
 */
export interface TerrainSplatLayerSpec {
  /** Whether the layer projects along all three axes. */
  readonly triplanar: boolean;
  /** Whether the layer's slice of the normal array holds a normal map. */
  readonly hasNormal: boolean;
  /** The layer's sRGB tint. */
  readonly color: ColorLike;
  /** Metres per texture repeat. */
  readonly tiling: number;
}

/**
 * What decides the generated file's shape.
 *
 * @public
 */
export interface TerrainSplatShaderSpec {
  /** The layers, in control-channel order, 1 to 8. */
  readonly layers: readonly TerrainSplatLayerSpec[];
  /** Whether an albedo texture array is bound; without one the layers blend their tints alone. */
  readonly textured: boolean;
  /** Whether a normal texture array is bound. */
  readonly normals: boolean;
}

/** Below this normalised weight a layer's samples are skipped. */
const WEIGHT_THRESHOLD = 0.002;

/** The exponent that sharpens the triplanar blend weights. */
const TRIPLANAR_SHARPNESS = 4;

/**
 * Formats a number as a WGSL `f32` literal.
 *
 * @param value - The number.
 * @returns A literal with a decimal point.
 */
function f(value: number): string {
  const text = String(Number.isFinite(value) ? value : 0);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
}

/**
 * Generates the `terrainSplat` surface shader for a terrain's shape.
 *
 * @param spec - The layers and which arrays are bound.
 * @returns The `.surface.wgsl` source.
 *
 * @example
 * ```ts
 * const source = terrainSplatShaderSource({
 *   layers: [
 *     { triplanar: false, hasNormal: false, color: { r: 0.3, g: 0.6, b: 0.2, a: 1 }, tiling: 8 },
 *     { triplanar: true, hasNormal: false, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, tiling: 6 },
 *   ],
 *   textured: false,
 *   normals: false,
 * });
 * ```
 *
 * @public
 */
export function terrainSplatShaderSource(spec: TerrainSplatShaderSpec): string {
  const layerCount = spec.layers.length;
  const mapCount = Math.max(1, Math.ceil(layerCount / LAYERS_PER_CONTROL_MAP));
  const lines: string[] = ["// @ignifx surface"];
  lines.push('// @ignifx uniform origin: vec2<f32> = (0, 0) tooltip("World XZ of the terrain\'s centre")');
  lines.push('// @ignifx uniform invSize: vec2<f32> = (1, 1) tooltip("1 / world size along X and Z")');
  for (let map = 0; map < mapCount; map += 1) {
    const base = map * LAYERS_PER_CONTROL_MAP;
    const tilings = [0, 1, 2, 3].map((k) => f(spec.layers[base + k]?.tiling ?? 8)).join(", ");
    lines.push(
      `// @ignifx uniform tilings${String(map)}: vec4<f32> = (${tilings}) tooltip("Metres per repeat of layers ${String(base)}-${String(base + 3)}")`,
    );
  }
  for (let index = 0; index < layerCount; index += 1) {
    const layer = spec.layers[index];
    const color = layer?.color ?? { r: 1, g: 1, b: 1, a: 1 };
    lines.push(
      `// @ignifx uniform color${String(index)}: vec3<f32> = color(${f(color.r)}, ${f(color.g)}, ${f(color.b)})`,
    );
  }
  for (let map = 0; map < mapCount; map += 1) {
    lines.push(`// @ignifx texture control${String(map)} default ${map === 0 ? "white" : "black"}`);
  }
  if (spec.textured) {
    lines.push("// @ignifx texture albedo srgb array");
  }
  if (spec.normals) {
    lines.push("// @ignifx texture normals array");
  }
  lines.push("");
  lines.push("fn terrainSplatUv(p: vec3<f32>) -> vec2<f32> {");
  lines.push("  return (p.xz - surfaceUniforms.origin) * surfaceUniforms.invSize + vec2<f32>(0.5);");
  lines.push("}");
  lines.push("");
  lines.push("fn surface(in: SurfaceInput, s: ptr<function, Surface>) {");
  lines.push("  let cuv = terrainSplatUv(in.worldPosition);");
  for (let map = 0; map < mapCount; map += 1) {
    lines.push(`  let w${String(map)} = textureSample(control${String(map)}, control${String(map)}Sampler, cuv);`);
  }
  const weightNames: string[] = [];
  for (let index = 0; index < layerCount; index += 1) {
    const map = Math.floor(index / LAYERS_PER_CONTROL_MAP);
    const channel = ["r", "g", "b", "a"][index % LAYERS_PER_CONTROL_MAP] ?? "r";
    weightNames.push(`w${String(map)}.${channel}`);
  }
  lines.push(`  let total = max(${weightNames.join(" + ")}, 0.0001);`);
  lines.push("  let inv = 1.0 / total;");
  lines.push("  let n = normalize(in.geometricNormal);");
  lines.push("  var blended = vec3<f32>(0.0);");
  if (spec.normals) {
    lines.push("  var tn = vec3<f32>(0.0);");
  }
  if (spec.textured) {
    lines.push("  let gx = dpdx(in.worldPosition);");
    lines.push("  let gy = dpdy(in.worldPosition);");
    const hasTriplanar = spec.layers.some((layer) => layer.triplanar);
    if (hasTriplanar) {
      lines.push(`  let bw = pow(abs(n), vec3<f32>(${f(TRIPLANAR_SHARPNESS)}));`);
      lines.push("  let bwn = bw / (bw.x + bw.y + bw.z);");
    }
  }
  for (let index = 0; index < layerCount; index += 1) {
    const layer = spec.layers[index];
    if (layer === undefined) {
      continue;
    }
    const map = Math.floor(index / LAYERS_PER_CONTROL_MAP);
    const component = ["x", "y", "z", "w"][index % LAYERS_PER_CONTROL_MAP] ?? "x";
    const i = String(index);
    lines.push("  {");
    lines.push(`    let w = ${weightNames[index] ?? "0.0"} * inv;`);
    lines.push(`    if (w > ${f(WEIGHT_THRESHOLD)}) {`);
    if (spec.textured) {
      lines.push(`      let tile = 1.0 / surfaceUniforms.tilings${String(map)}.${component};`);
      if (layer.triplanar) {
        lines.push(
          `      let cx = textureSampleGrad(albedo, albedoSampler, in.worldPosition.zy * tile, ${i}, gx.zy * tile, gy.zy * tile).rgb;`,
        );
        lines.push(
          `      let cy = textureSampleGrad(albedo, albedoSampler, in.worldPosition.xz * tile, ${i}, gx.xz * tile, gy.xz * tile).rgb;`,
        );
        lines.push(
          `      let cz = textureSampleGrad(albedo, albedoSampler, in.worldPosition.xy * tile, ${i}, gx.xy * tile, gy.xy * tile).rgb;`,
        );
        lines.push("      let c = cx * bwn.x + cy * bwn.y + cz * bwn.z;");
      } else {
        lines.push(
          `      let c = textureSampleGrad(albedo, albedoSampler, in.worldPosition.xz * tile, ${i}, gx.xz * tile, gy.xz * tile).rgb;`,
        );
      }
      lines.push(`      blended += c * surfaceUniforms.color${i} * w;`);
      if (spec.normals && layer.hasNormal) {
        if (layer.triplanar) {
          lines.push(
            `      let nx = textureSampleGrad(normals, normalsSampler, in.worldPosition.zy * tile, ${i}, gx.zy * tile, gy.zy * tile).xyz * 2.0 - 1.0;`,
          );
          lines.push(
            `      let ny = textureSampleGrad(normals, normalsSampler, in.worldPosition.xz * tile, ${i}, gx.xz * tile, gy.xz * tile).xyz * 2.0 - 1.0;`,
          );
          lines.push(
            `      let nz = textureSampleGrad(normals, normalsSampler, in.worldPosition.xy * tile, ${i}, gx.xy * tile, gy.xy * tile).xyz * 2.0 - 1.0;`,
          );
          lines.push("      tn += (nx * bwn.x + ny * bwn.y + nz * bwn.z) * w;");
        } else {
          lines.push(
            `      let nm = textureSampleGrad(normals, normalsSampler, in.worldPosition.xz * tile, ${i}, gx.xz * tile, gy.xz * tile).xyz * 2.0 - 1.0;`,
          );
          lines.push("      tn += nm * w;");
        }
      }
    } else {
      lines.push(`      blended += surfaceUniforms.color${i} * w;`);
    }
    lines.push("    }");
    lines.push("  }");
  }
  lines.push("  (*s).baseColor = blended;");
  if (spec.normals) {
    lines.push("  if (dot(tn, tn) > 0.0001) {");
    lines.push("    let t = vec3<f32>(1.0, 0.0, 0.0);");
    lines.push("    let b = vec3<f32>(0.0, 0.0, 1.0);");
    lines.push("    (*s).normal = normalize(t * tn.x + b * tn.y + n * max(tn.z, 0.1));");
    lines.push("  }");
  }
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}
