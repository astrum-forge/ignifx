import { describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { parseShaderDeclaration } from "../../src/render/shader-pragma.js";
import {
  compileSurfaceShader,
  parseSurfaceHooks,
  sanitizeIdentifier,
} from "../../src/render/surface-shader-compiler.js";
import {
  BENT_NORMAL_SURFACE_WGSL,
  DISPLACE_WITH_UNIFORM_WGSL,
  DISPLACE_WITH_UV2_WGSL,
  GLOW_SURFACE_WGSL,
  INVERT_COMPOSITE_WGSL,
  LIFT_DISPLACE_WGSL,
  NO_HOOK_SURFACE_WGSL,
  SNOW_SURFACE_WGSL,
} from "../fixtures/shaders/surfaces.js";
import type { CompiledSurfaceShader, SurfaceHostCapabilities } from "../../src/render/surface-shader-compiler.js";

/**
 * The surface-shader compiler on its own: no app, no device, no Babylon Lite. It is a pure function
 * from a `.surface.wgsl` and a host family to a plugin definition, so every rule the generated WGSL
 * has to follow is asserted here.
 */

/** A PBR host, which exposes every slot and varying. */
const PBR: SurfaceHostCapabilities = { family: "pbr", hasUv: true, hasNormal: true };

/** A Standard host with a texture, so its UV varying exists. */
const STANDARD: SurfaceHostCapabilities = { family: "standard", hasUv: true, hasNormal: true };

/**
 * Compiles a fixture.
 *
 * @param source - The `.surface.wgsl` text.
 * @param host - The host family; PBR by default.
 * @param name - The shader's name; `snow` by default.
 * @returns The compiled shader.
 */
function compile(source: string, host: SurfaceHostCapabilities = PBR, name = "snow"): CompiledSurfaceShader {
  return compileSurfaceShader({
    name,
    address: `shaders/${name}.surface.wgsl`,
    source,
    declaration: parseShaderDeclaration(source, `shaders/${name}.surface.wgsl`),
    host,
  });
}

/**
 * The `IGX-####` code a call fails with.
 *
 * @param run - The call.
 * @returns The code, or `"none"` when it did not throw.
 */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (failure: unknown) {
    return isIgnifxError(failure) ? failure.code : "not-an-ignifx-error";
  }
  return "none";
}

describe("finding the hooks", () => {
  it("finds a surface hook and its parameter names", () => {
    const hooks = parseSurfaceHooks(SNOW_SURFACE_WGSL, "snow.surface.wgsl");
    expect(hooks.surface?.parameters).toStrictEqual(["in", "s"]);
  });

  it("finds a displace hook and keeps its body verbatim", () => {
    const hooks = parseSurfaceHooks(LIFT_DISPLACE_WGSL, "lift.surface.wgsl");
    expect(hooks.displace?.body).toContain("return vec3<f32>(0.0, 1.5, 0.0);");
  });

  it("leaves the file's own helpers in the rest, with the hook cut out", () => {
    const hooks = parseSurfaceHooks(`${NO_HOOK_SURFACE_WGSL}${INVERT_COMPOSITE_WGSL}`, "x.surface.wgsl");
    expect(hooks.rest).toContain("fn helper");
    expect(hooks.rest).not.toContain("fn composite");
  });

  it("refuses a file that declares none of the three hooks with IGX-0723", () => {
    expect(codeOf(() => parseSurfaceHooks(NO_HOOK_SURFACE_WGSL, "x.surface.wgsl"))).toBe("IGX-0723");
  });

  it("refuses a hook whose body never closes with IGX-0719", () => {
    const broken = "// @ignifx surface\nfn surface(in: SurfaceInput, s: ptr<function, Surface>) {\n";
    expect(codeOf(() => parseSurfaceHooks(broken, "x.surface.wgsl"))).toBe("IGX-0719");
  });
});

describe("the generated fragment definitions", () => {
  it("generates prefixed SurfaceInput and Surface structs", () => {
    const definitions = compile(SNOW_SURFACE_WGSL).plugin.code.CUSTOM_FRAGMENT_DEFINITIONS ?? "";
    expect(definitions).toContain("struct snow_SurfaceInput{");
    expect(definitions).toContain("struct snow_Surface{");
  });

  it("gives the hook a prefixed name and prefixed parameter types", () => {
    const definitions = compile(SNOW_SURFACE_WGSL).plugin.code.CUSTOM_FRAGMENT_DEFINITIONS ?? "";
    expect(definitions).toContain("fn snow_surface(in:snow_SurfaceInput,s:ptr<function,snow_Surface>)");
  });

  it("rewrites surfaceUniforms to the PBR material block", () => {
    const definitions = compile(SNOW_SURFACE_WGSL).plugin.code.CUSTOM_FRAGMENT_DEFINITIONS ?? "";
    expect(definitions).toContain("material.snow_snowColor");
    expect(definitions).not.toContain("surfaceUniforms.");
  });

  it("rewrites surfaceUniforms to pluginUbo on a standard host", () => {
    const definitions = compile(SNOW_SURFACE_WGSL, STANDARD).plugin.code.CUSTOM_FRAGMENT_DEFINITIONS ?? "";
    expect(definitions).toContain("pluginUbo.snow_snowColor");
  });

  it("rewrites the texture and its sampler to prefixed names", () => {
    const definitions = compile(SNOW_SURFACE_WGSL).plugin.code.CUSTOM_FRAGMENT_DEFINITIONS ?? "";
    expect(definitions).toContain("textureSample(snow_snowNoise, snow_snowNoiseSampler,");
  });

  it("declares the uniforms and samplers under their prefixed names", () => {
    const plugin = compile(SNOW_SURFACE_WGSL).plugin;
    expect(plugin.uniforms.map((uniform) => uniform.name)).toStrictEqual(["snow_amount", "snow_snowColor"]);
    expect(plugin.textures.map((texture) => texture.name)).toStrictEqual(["snow_snowNoise"]);
  });

  it("prefixes with the shader's name, so two shaders on one material cannot collide", () => {
    const first = compile(SNOW_SURFACE_WGSL, PBR, "snow").plugin.uniforms[0]?.name;
    const second = compile(SNOW_SURFACE_WGSL, PBR, "frost").plugin.uniforms[0]?.name;
    expect([first, second]).toStrictEqual(["snow_amount", "frost_amount"]);
  });
});

describe("the surface hook's slot", () => {
  it("builds SurfaceInput from the PBR template's own varyings", () => {
    const alpha = compile(SNOW_SURFACE_WGSL).plugin.code.CUSTOM_FRAGMENT_UPDATE_ALPHA ?? "";
    expect(alpha).toContain("snow_in.uv=input.uv;");
    expect(alpha).toContain("snow_in.worldPosition=input.worldPos;");
    expect(alpha).toContain("snow_in.geometricNormal=normalize(input.worldNormal);");
    expect(alpha).toContain("snow_in.viewDirection=normalize(scene.vEyePosition.xyz-input.worldPos);");
  });

  it("seeds the Surface from the template's variables and writes back the writable ones", () => {
    const alpha = compile(SNOW_SURFACE_WGSL).plugin.code.CUSTOM_FRAGMENT_UPDATE_ALPHA ?? "";
    expect(alpha).toContain("snow_s.baseColor=baseColor;");
    expect(alpha).toContain("snow_s.roughness=roughness;");
    expect(alpha).toContain("baseColor=snow_s.baseColor;");
    expect(alpha).toContain("alpha=snow_s.alpha;");
  });

  it("never assigns to emissive, which the PBR template may declare as a let", () => {
    const alpha = compile(GLOW_SURFACE_WGSL).plugin.code.CUSTOM_FRAGMENT_UPDATE_ALPHA ?? "";
    expect(alpha).toContain("snow_emissiveDelta=snow_s.emissive-emissive;");
    expect(alpha).not.toMatch(/^emissive=/mu);
  });

  it("writes the shading normal in the UPDATE_DIFFUSE slot, and only when the hook moved it", () => {
    const diffuse = compile(BENT_NORMAL_SURFACE_WGSL).plugin.code.CUSTOM_FRAGMENT_UPDATE_DIFFUSE ?? "";
    expect(diffuse).toBe("if(any(snow_normal!=snow_in.geometricNormal)){N=normalize(snow_normal);}");
  });

  it("writes the standard host's variables instead, all in the one slot it has", () => {
    const code = compile(BENT_NORMAL_SURFACE_WGSL, STANDARD).plugin.code;
    const alpha = code.CUSTOM_FRAGMENT_UPDATE_ALPHA ?? "";
    expect(alpha).toContain("snow_in.worldPosition=input.vp;");
    expect(alpha).toContain("normalW=normalize(snow_normal);");
    expect(code.CUSTOM_FRAGMENT_UPDATE_DIFFUSE).toBeUndefined();
  });

  it("reads zero for uv on a standard host that declares no UV varying", () => {
    const alpha =
      compile(SNOW_SURFACE_WGSL, { family: "standard", hasUv: false, hasNormal: true }).plugin.code
        .CUSTOM_FRAGMENT_UPDATE_ALPHA ?? "";
    expect(alpha).toContain("snow_in.uv=vec2<f32>(0.0);");
  });

  it("seeds roughness and metallic with constants on a standard host, which has neither", () => {
    const alpha = compile(SNOW_SURFACE_WGSL, STANDARD).plugin.code.CUSTOM_FRAGMENT_UPDATE_ALPHA ?? "";
    expect(alpha).toContain("snow_s.roughness=1.0;");
    expect(alpha).toContain("snow_s.metallic=0.0;");
  });
});

describe("the composite hook's slot", () => {
  it("guards itself, because Lite injects the point twice", () => {
    const composite = compile(INVERT_COMPOSITE_WGSL).plugin.code.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION ?? "";
    expect(composite).toContain("if(!snow_composited){snow_composited=true;");
    expect(composite).toContain("color=snow_composite(snow_in,color);");
  });

  it("applies the emissive delta even when there is no composite hook", () => {
    const composite = compile(GLOW_SURFACE_WGSL).plugin.code.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION ?? "";
    expect(composite).toContain("color=color+snow_emissiveDelta;");
    expect(composite).not.toContain("snow_composite(");
  });

  it("refuses a composite hook on a standard host with IGX-0723", () => {
    expect(codeOf(() => compile(INVERT_COMPOSITE_WGSL, STANDARD))).toBe("IGX-0723");
  });
});

describe("the displace hook's slot", () => {
  it("inlines the body, because a plugin cannot declare a vertex function", () => {
    const vertex = compile(LIFT_DISPLACE_WGSL).plugin.code.CUSTOM_VERTEX_UPDATE_WORLDPOS ?? "";
    expect(vertex).toContain("loop{");
    expect(vertex).toContain("{snow_offset=vec3<f32>(0.0, 1.5, 0.0);break;}");
  });

  it("adds the offset to the world matrix's translation column", () => {
    const vertex = compile(LIFT_DISPLACE_WGSL).plugin.code.CUSTOM_VERTEX_UPDATE_WORLDPOS ?? "";
    expect(vertex).toContain("finalWorld[3].y+=snow_offset.y;");
  });

  it("rewrites the input's members to the vertex entry's own parameters", () => {
    const source = "// @ignifx surface\nfn displace(in: DisplaceInput) -> vec3<f32> { return in.normal * in.uv.x; }";
    const vertex = compile(source).plugin.code.CUSTOM_VERTEX_UPDATE_WORLDPOS ?? "";
    expect(vertex).toContain("normal * uv.x");
  });

  it("reads white for vertex colour, which a plugin cannot know the mesh carries", () => {
    const source = "// @ignifx surface\nfn displace(in: DisplaceInput) -> vec3<f32> { return in.color.rgb; }";
    const vertex = compile(source).plugin.code.CUSTOM_VERTEX_UPDATE_WORLDPOS ?? "";
    expect(vertex).toContain("vec4<f32>(1.0).rgb");
  });

  it("declares no fragment definitions when the file has only a displace hook", () => {
    expect(compile(LIFT_DISPLACE_WGSL).plugin.code.CUSTOM_FRAGMENT_DEFINITIONS).toBeUndefined();
  });

  it("refuses a displace hook that reads a uniform with IGX-0723", () => {
    expect(codeOf(() => compile(DISPLACE_WITH_UNIFORM_WGSL))).toBe("IGX-0723");
  });

  it("refuses a displace hook that reads a member DisplaceInput does not carry", () => {
    expect(codeOf(() => compile(DISPLACE_WITH_UV2_WGSL))).toBe("IGX-0723");
  });

  it("refuses a displace hook that loops, whose return would break the wrong construct", () => {
    const source = `// @ignifx surface

fn displace(in: DisplaceInput) -> vec3<f32> {
  for (var i = 0u; i < 4u; i = i + 1u) { if (in.position.y > 0.0) { return vec3<f32>(0.0, 1.0, 0.0); } }
  return vec3<f32>(0.0);
}
`;
    expect(codeOf(() => compile(source))).toBe("IGX-0723");
  });

  it("refuses a displace hook that calls a helper the vertex stage cannot see", () => {
    const source = `// @ignifx surface

fn lift(y: f32) -> f32 { return y * 2.0; }

fn displace(in: DisplaceInput) -> vec3<f32> { return vec3<f32>(0.0, lift(in.position.y), 0.0); }
`;
    expect(codeOf(() => compile(source))).toBe("IGX-0723");
  });

  it("refuses a displace hook that samples a declared texture", () => {
    const source = `// @ignifx surface
// @ignifx texture heights

fn displace(in: DisplaceInput) -> vec3<f32> {
  return vec3<f32>(0.0, textureSampleLevel(heights, heightsSampler, in.uv, 0.0).r, 0.0);
}
`;
    expect(codeOf(() => compile(source))).toBe("IGX-0723");
  });
});

describe("the whole compiled plugin", () => {
  it("takes its name from the shader, which is Lite's pipeline cache key", () => {
    expect(compile(SNOW_SURFACE_WGSL).plugin.name).toBe("snow");
  });

  it("reports which hooks the file provided", () => {
    expect(compile(SNOW_SURFACE_WGSL).hooks).toStrictEqual({ displace: false, surface: true, composite: false });
  });

  it("carries a trailing-underscore prefix, so a name can be reassembled", () => {
    expect(compile(SNOW_SURFACE_WGSL).prefix).toBe("snow_");
  });
});

describe("hosts that carry fewer varyings", () => {
  /** A Standard host whose material has no texture, so Lite declares no UV varying. */
  const NO_UV: SurfaceHostCapabilities = { family: "standard", hasUv: false, hasNormal: false };

  it("reads a zero UV when the host declares no UV varying", () => {
    const vertex = compile(LIFT_DISPLACE_WGSL, NO_UV).plugin.code.CUSTOM_VERTEX_UPDATE_WORLDPOS ?? "";
    expect(vertex).toContain("vec3<f32>(0.0, 1.5, 0.0)");
  });

  it("builds the surface input without a shading normal when the host has none", () => {
    const alpha = compile(SNOW_SURFACE_WGSL, NO_UV).plugin.code.CUSTOM_FRAGMENT_UPDATE_ALPHA ?? "";
    expect(alpha).toContain("snow_in");
  });
});

describe("a malformed hook", () => {
  it("is refused when its parameter list does not close", () => {
    expect(codeOf(() => compile("// @ignifx surface\nfn surface(in: SurfaceInput"))).toBe("IGX-0719");
  });

  it("is refused when its body does not close", () => {
    expect(codeOf(() => compile("// @ignifx surface\nfn surface(in: SurfaceInput, s: ptr<function, Surface>) {"))).toBe(
      "IGX-0719",
    );
  });

  it("reads an empty parameter list as no parameters", () => {
    expect(parseSurfaceHooks("// @ignifx surface\nfn surface() { }\n", "s.wgsl").surface?.parameters).toEqual([]);
  });
});

describe("sanitizeIdentifier", () => {
  it("replaces every character WGSL does not allow in an identifier", () => {
    expect(sanitizeIdentifier("snow-fall.2")).toBe("snow_fall_2");
  });

  it("prefixes a leading digit, which WGSL forbids", () => {
    expect(sanitizeIdentifier("2snow")).toBe("_2snow");
  });
});
