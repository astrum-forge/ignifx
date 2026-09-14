import type { ShaderDeclaration } from "@ignifx/core";

/**
 * Rebuilds the prelude Babylon Lite prepends to a shader material's source
 * (`lib/material/shader/shader-pipeline.js`, `buildShaderPrelude`), so `wgsl_reflect` can parse a
 * generated particle program the way the GPU sees it.
 */

/** The WGSL type of each Babylon Lite system uniform (`index.d.ts` 11432). */
const LITE_UNIFORM_TYPES: Readonly<Record<string, string>> = Object.freeze({
  world: "mat4x4<f32>",
  view: "mat4x4<f32>",
  projection: "mat4x4<f32>",
  viewProjection: "mat4x4<f32>",
  worldView: "mat4x4<f32>",
  worldViewProjection: "mat4x4<f32>",
  cameraPosition: "vec3<f32>",
  screenSize: "vec2<f32>",
  alphaCutoff: "f32",
});

/** The WGSL type of each ignifx-provided uniform. */
const IGNIFX_UNIFORM_TYPES: Readonly<Record<string, string>> = Object.freeze({
  time: "f32",
  unscaledTime: "f32",
  deltaTime: "f32",
  mainLightDirection: "vec3<f32>",
  mainLightColor: "vec3<f32>",
  ambientColor: "vec3<f32>",
});

/** The WGSL type of each vertex attribute Babylon Lite can bind. */
const ATTRIBUTE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  position: "vec3<f32>",
  normal: "vec3<f32>",
  uv: "vec2<f32>",
  uv2: "vec2<f32>",
  tangent: "vec4<f32>",
  color: "vec4<f32>",
  joints: "vec4<u32>",
  weights: "vec4<f32>",
  joints1: "vec4<u32>",
  weights1: "vec4<f32>",
});

/**
 * Builds the binding declarations a declaration implies.
 *
 * @param declaration - What `parseShaderDeclaration` read from the generated source.
 * @returns The prelude text, without a trailing newline.
 */
export function litePrelude(declaration: ShaderDeclaration): string {
  const lines: string[] = ["struct ShaderSystemUniforms {"];
  const system = declaration.system.map((name) => `  ${name}: ${LITE_UNIFORM_TYPES[name] ?? "f32"},`);
  lines.push(...(system.length > 0 ? system : ["  _pad: vec4<f32>,"]));
  lines.push("}", "@group(1) @binding(0) var<uniform> shaderSystem: ShaderSystemUniforms;");

  const custom = [
    ...declaration.ignifx.map((name) => `  ${name}: ${IGNIFX_UNIFORM_TYPES[name] ?? "f32"},`),
    ...declaration.uniforms.map((uniform) => `  ${uniform.name}: ${uniform.type},`),
  ];
  let binding = 1;
  if (custom.length > 0) {
    lines.push(
      "struct ShaderUniforms {",
      ...custom,
      "}",
      "@group(1) @binding(1) var<uniform> shaderUniforms: ShaderUniforms;",
    );
    binding = 2;
  }
  for (const texture of declaration.textures) {
    const kind = texture.array ? "texture_2d_array<f32>" : "texture_2d<f32>";
    lines.push(`@group(1) @binding(${String(binding)}) var ${texture.name}: ${kind};`);
    binding += 1;
    lines.push(`@group(1) @binding(${String(binding)}) var ${texture.name}Sampler: sampler;`);
    binding += 1;
  }
  for (const storage of declaration.storage) {
    lines.push(`@group(1) @binding(${String(binding)}) var<storage, read> ${storage.name}: ${storage.type};`);
    binding += 1;
  }
  for (const define of declaration.defines) {
    const kind = typeof define.value === "boolean" ? "bool" : "f32";
    const value = typeof define.value === "boolean" ? String(define.value) : formatNumber(define.value);
    lines.push(`const ${define.name}: ${kind} = ${value};`);
  }

  lines.push("struct VertexInput {");
  declaration.attributes.forEach((attribute, index) => {
    lines.push(`  @location(${String(index)}) ${attribute}: ${ATTRIBUTE_TYPES[attribute] ?? "vec4<f32>"},`);
  });
  if (declaration.pipeline.instancing !== "none") {
    const base = declaration.attributes.length;
    for (let index = 0; index < 4; index += 1) {
      lines.push(`  @location(${String(base + index)}) world${String(index)}: vec4<f32>,`);
    }
    if (declaration.pipeline.instancing === "matrices-colors") {
      lines.push(`  @location(${String(base + 4)}) instanceColor: vec4<f32>,`);
    }
  }
  lines.push("};");
  return lines.join("\n");
}

/**
 * Formats a define's numeric value the way Babylon Lite does.
 *
 * @param value - The number.
 * @returns The WGSL literal.
 */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}
