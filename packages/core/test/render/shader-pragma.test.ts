import { describe, expect, it } from "vitest";
import { IgnifxError } from "../../src/errors/ignifx-error.js";
import { parseShaderDeclaration } from "../../src/render/shader-pragma.js";
import { TEXTURED_WGSL, TINT_WGSL } from "../fixtures/shaders/sources.js";

/**
 * The `// @ignifx` pragma parser. Pure string work, so every rule and every error path is asserted
 * here; the numbers in the error's `context.line` are what a build-time validator reports.
 */

/** Parses one directive on top of the shortest legal file. */
function parse(...directives: readonly string[]): ReturnType<typeof parseShaderDeclaration> {
  return parseShaderDeclaration(["// @ignifx shader", ...directives].join("\n"), "shaders/x.wgsl");
}

/** The `IgnifxError` a source throws, so a test can read its code and line. */
function failure(source: string): IgnifxError {
  try {
    parseShaderDeclaration(source, "shaders/x.wgsl");
  } catch (error: unknown) {
    if (error instanceof IgnifxError) {
      return error;
    }
    throw error;
  }
  throw new Error("the source parsed without an error");
}

/** The `IgnifxError` one extra directive throws. */
function directiveFailure(...directives: readonly string[]): IgnifxError {
  return failure(["// @ignifx shader", ...directives].join("\n"));
}

describe("the form directive", () => {
  it("is required", () => {
    const error = failure("@vertex fn mainVertex() {}");
    expect(error.code).toBe("IGX-0719");
    expect(error.context["line"]).toBe(1);
  });

  it("reads each of the three forms", () => {
    expect(parseShaderDeclaration("// @ignifx surface", "s.wgsl").kind).toBe("surface");
    expect(parseShaderDeclaration("// @ignifx post", "p.wgsl").kind).toBe("post");
    expect(parse().kind).toBe("shader");
  });

  it("is refused twice", () => {
    expect(directiveFailure("// @ignifx post").context["line"]).toBe(2);
  });

  it("takes no arguments", () => {
    expect(failure("// @ignifx shader extra").code).toBe("IGX-0719");
  });

  it("is found on an indented comment anywhere in the file", () => {
    const declaration = parseShaderDeclaration("fn helper() {}\n  //   @ignifx post\n", "p.wgsl");
    expect(declaration.kind).toBe("post");
  });

  it("refuses an @ignifx comment with nothing after it", () => {
    expect(failure("// @ignifx\n").code).toBe("IGX-0719");
  });

  it("refuses a directive it does not know", () => {
    expect(directiveFailure("// @ignifx wobble 3").message).toContain("is not an @ignifx directive");
  });
});

describe("uniform modifiers", () => {
  it("refuse a bare color on a type that cannot hold one", () => {
    const error = directiveFailure("// @ignifx uniform k: f32 = 0 color");
    expect(error.code).toBe("IGX-0719");
    expect(error.message).toContain("color does not apply");
  });
});

describe("attributes", () => {
  it("default to position alone for a shader file", () => {
    expect(parse().attributes).toEqual(["position"]);
  });

  it("default to nothing for a surface file", () => {
    expect(parseShaderDeclaration("// @ignifx surface", "s.wgsl").attributes).toEqual([]);
  });

  it("read a comma-separated list", () => {
    expect(parse("// @ignifx attributes position, normal , uv").attributes).toEqual(["position", "normal", "uv"]);
  });

  it("refuse a name Babylon Lite does not have", () => {
    expect(directiveFailure("// @ignifx attributes position, wobble").message).toContain("is not a vertex attribute");
  });

  it("refuse an explicit list without position on a shader file", () => {
    expect(directiveFailure("// @ignifx attributes normal").message).toContain("must declare the position attribute");
  });

  it("refuse the same attribute twice", () => {
    expect(directiveFailure("// @ignifx attributes position, position").message).toContain("declared twice");
  });

  it("refuse a second attributes directive", () => {
    expect(directiveFailure("// @ignifx attributes position", "// @ignifx attributes normal").context["line"]).toBe(3);
  });

  it("refuse an empty list", () => {
    expect(directiveFailure("// @ignifx attributes").message).toContain("declares nothing");
  });

  it("refuse an empty entry", () => {
    expect(directiveFailure("// @ignifx attributes position,").message).toContain("empty entry");
  });
});

describe("system uniforms", () => {
  it("split Babylon Lite's names from ignifx's own", () => {
    const declaration = parse("// @ignifx system world, viewProjection, time, mainLightColor");
    expect(declaration.system).toEqual(["world", "viewProjection"]);
    expect(declaration.ignifx).toEqual(["time", "mainLightColor"]);
  });

  it("refuse a name neither engine provides", () => {
    expect(directiveFailure("// @ignifx system sunAngle").message).toContain("is not a system uniform");
  });

  it("refuse the same name twice", () => {
    expect(directiveFailure("// @ignifx system time, time").message).toContain("already declared");
  });
});

describe("uniform declarations", () => {
  it("read a scalar with every hint", () => {
    const uniform = parse('// @ignifx uniform progress: f32 = 0.25 range(0, 1) step(0.01) tooltip("How far")')
      .uniforms[0];
    expect(uniform).toEqual({
      name: "progress",
      type: "f32",
      defaultValue: 0.25,
      color: false,
      range: [0, 1],
      step: 0.01,
      tooltip: "How far",
    });
  });

  it("keep a color(...) default in sRGB and mark it a colour", () => {
    const uniform = parse("// @ignifx uniform edge: vec3<f32> = color(1.0, 0.45, 0.1)").uniforms[0];
    expect(uniform?.color).toBe(true);
    expect(uniform?.defaultValue).toEqual([1, 0.45, 0.1]);
  });

  it("read a bare vector default", () => {
    expect(parse("// @ignifx uniform tint: vec4<f32> = (1, 1, 1, 0.5)").uniforms[0]?.defaultValue).toEqual([
      1, 1, 1, 0.5,
    ]);
  });

  it("read the bare color modifier after a vector default", () => {
    expect(parse("// @ignifx uniform tint: vec3<f32> = (1, 0, 0) color").uniforms[0]?.color).toBe(true);
  });

  it("default a matrix to the identity", () => {
    expect(parse("// @ignifx uniform m: mat4x4<f32>").uniforms[0]?.defaultValue).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
  });

  it("default a vector to zeros", () => {
    expect(parse("// @ignifx uniform v: vec2<f32>").uniforms[0]?.defaultValue).toEqual([0, 0]);
  });

  it("default a scalar to zero", () => {
    expect(parse("// @ignifx uniform n: u32").uniforms[0]?.defaultValue).toBe(0);
  });

  it("read a negative exponent default", () => {
    expect(parse("// @ignifx uniform tiny: f32 = -1.5e-3").uniforms[0]?.defaultValue).toBeCloseTo(-0.0015);
  });

  it("refuse a type Babylon Lite does not have", () => {
    expect(directiveFailure("// @ignifx uniform v: vec3<u32>").message).toContain("is not a uniform type");
  });

  it("refuse a line without a colon", () => {
    expect(directiveFailure("// @ignifx uniform progress f32").message).toContain('expects "name: type"');
  });

  it("refuse a default with the wrong arity", () => {
    expect(directiveFailure("// @ignifx uniform v: vec3<f32> = (1, 2)").message).toContain("takes 3 numbers");
  });

  it("refuse a scalar given a vector default", () => {
    expect(directiveFailure("// @ignifx uniform n: f32 = (1, 2)").message).toContain("takes 1 numbers");
  });

  it("refuse color(...) on a non-colour type", () => {
    expect(directiveFailure("// @ignifx uniform n: f32 = color(1, 1, 1)").message).toContain("does not apply");
  });

  it("refuse an unreadable default", () => {
    expect(directiveFailure("// @ignifx uniform n: f32 = lots").message).toContain("no readable default value");
  });

  it("refuse a modifier it does not know", () => {
    expect(directiveFailure("// @ignifx uniform n: f32 = 0 wobble(1)").message).toContain("is not a uniform modifier");
  });

  it("refuse range with the wrong number of bounds", () => {
    expect(directiveFailure("// @ignifx uniform n: f32 = 0 range(0)").message).toContain("with 1 bounds");
  });

  it("refuse step with the wrong number of values", () => {
    expect(directiveFailure("// @ignifx uniform n: f32 = 0 step(0, 1)").message).toContain("with 2 values");
  });

  it("refuse a repeated hint", () => {
    expect(directiveFailure("// @ignifx uniform n: f32 = 0 range(0, 1) range(0, 2)").message).toContain("range twice");
    expect(directiveFailure("// @ignifx uniform n: f32 = 0 step(1) step(2)").message).toContain("step twice");
    expect(directiveFailure('// @ignifx uniform n: f32 = 0 tooltip("a") tooltip("b")').message).toContain(
      "tooltip twice",
    );
  });

  it("refuse a non-numeric hint argument", () => {
    expect(directiveFailure("// @ignifx uniform n: f32 = 0 range(low, high)").message).toContain("not a number");
  });

  it("refuse color(...) written as a modifier", () => {
    expect(directiveFailure("// @ignifx uniform n: vec3<f32> = (1, 0, 0) color(1, 0, 0)").message).toContain(
      "after its default value",
    );
  });

  it("refuse a uniform named like a system uniform already declared", () => {
    expect(directiveFailure("// @ignifx system time", "// @ignifx uniform time: f32").message).toContain(
      "already declared",
    );
  });
});

describe("texture declarations", () => {
  it("read every modifier", () => {
    expect(parse("// @ignifx texture layers srgb normal default transparent array").textures[0]).toEqual({
      name: "layers",
      srgb: true,
      normal: true,
      fallback: "transparent",
      array: true,
    });
  });

  it("default to a plain 2D sampler with no declared fallback", () => {
    expect(parse("// @ignifx texture noise").textures[0]).toEqual({
      name: "noise",
      srgb: false,
      normal: false,
      fallback: null,
      array: false,
    });
  });

  it("claim the generated sampler name too", () => {
    expect(directiveFailure("// @ignifx texture noise", "// @ignifx uniform noiseSampler: f32").message).toContain(
      "already declared",
    );
  });

  it("refuse a name that is not an identifier", () => {
    expect(directiveFailure("// @ignifx texture 9lives").message).toContain("is not a WGSL identifier");
  });

  it("refuse a fallback it does not know", () => {
    expect(directiveFailure("// @ignifx texture noise default pink").message).toContain("declares default");
  });

  it("refuse a modifier it does not know", () => {
    expect(directiveFailure("// @ignifx texture noise shiny").message).toContain("is not a texture modifier");
  });

  it("refuse an empty declaration", () => {
    expect(directiveFailure("// @ignifx texture").message).toContain("declares no name");
  });
});

describe("storage and define declarations", () => {
  it("keep a storage type verbatim", () => {
    expect(parse("// @ignifx storage particles: array<Particle>").storage[0]).toEqual({
      name: "particles",
      type: "array<Particle>",
    });
  });

  it("refuse a storage line without a type", () => {
    expect(directiveFailure("// @ignifx storage particles:").message).toContain("no storage buffer type");
    expect(directiveFailure("// @ignifx storage particles").message).toContain('expects "name: type"');
  });

  it("read a boolean and a numeric define", () => {
    const declaration = parse("// @ignifx define SOFT_EDGE = true", "// @ignifx define STEPS = 3.5");
    expect(declaration.defines).toEqual([
      { name: "SOFT_EDGE", value: true },
      { name: "STEPS", value: 3.5 },
    ]);
  });

  it("refuse a define with no value", () => {
    expect(directiveFailure("// @ignifx define SOFT_EDGE").message).toContain('expects "NAME = value"');
  });

  it("refuse a define whose value is neither a boolean nor a number", () => {
    expect(directiveFailure("// @ignifx define SOFT_EDGE = maybe").message).toContain("true, false, or a number");
  });

  it("refuse a define that is not an identifier", () => {
    expect(directiveFailure("// @ignifx define 2FAST = 1").message).toContain("is not a WGSL identifier");
  });
});

describe("pipeline state", () => {
  it("defaults to an opaque, back-culled, depth-writing, depth-testing mesh", () => {
    expect(parse().pipeline).toEqual({
      blend: "opaque",
      cull: "back",
      depthWrite: true,
      depthTest: true,
      transmissive: false,
      instancing: "none",
    });
  });

  it("reads a whole line of keywords", () => {
    expect(
      parse("// @ignifx blend premultiplied cull none depthWrite off depthTest on transmissive instancing matrices")
        .pipeline,
    ).toEqual({
      blend: "premultiplied",
      cull: "none",
      depthWrite: false,
      depthTest: true,
      transmissive: true,
      instancing: "matrices",
    });
  });

  it("merges keywords across several lines", () => {
    const pipeline = parse("// @ignifx cull none", "// @ignifx instancing matrices-colors").pipeline;
    expect(pipeline.cull).toBe("none");
    expect(pipeline.instancing).toBe("matrices-colors");
  });

  it("turns depth writes off for a blended surface unless the file says otherwise", () => {
    expect(parse("// @ignifx blend alpha").pipeline.depthWrite).toBe(false);
    expect(parse("// @ignifx blend alpha depthWrite on").pipeline.depthWrite).toBe(true);
  });

  it("refuses cull front, which Babylon Lite cannot express", () => {
    expect(directiveFailure("// @ignifx cull front").message).toContain("no front-face culling");
  });

  it("refuses transmissive on an opaque surface", () => {
    expect(directiveFailure("// @ignifx transmissive").message).toContain("needs a blended surface");
  });

  it("refuses a keyword given twice", () => {
    expect(directiveFailure("// @ignifx blend alpha blend additive").message).toContain("blend is declared twice");
    expect(directiveFailure("// @ignifx depthWrite on depthWrite off").message).toContain(
      "depthWrite is declared twice",
    );
  });

  it("refuses a value outside the keyword's list", () => {
    expect(directiveFailure("// @ignifx blend screen").message).toContain("is not one of");
    expect(directiveFailure("// @ignifx depthTest yes").message).toContain("is not on or off");
  });

  it("refuses a keyword after a pipeline line has started", () => {
    expect(directiveFailure("// @ignifx blend alpha shiny").message).toContain("is not a pipeline keyword");
  });
});

describe("the shipped fixtures", () => {
  it("parse the tint shader's whole declaration", () => {
    const declaration = parseShaderDeclaration(TINT_WGSL, "shaders/tint.wgsl");
    expect(declaration.attributes).toEqual(["position", "uv"]);
    expect(declaration.system).toEqual(["worldViewProjection"]);
    expect(declaration.ignifx).toEqual(["time"]);
    expect(declaration.uniforms).toHaveLength(2);
    expect(declaration.uniforms[1]?.tooltip).toBe("How strongly time modulates the tint");
  });

  it("parse the textured shader's sampler and define", () => {
    const declaration = parseShaderDeclaration(TEXTURED_WGSL, "shaders/textured.wgsl");
    expect(declaration.textures[0]).toEqual({
      name: "albedo",
      srgb: true,
      normal: false,
      fallback: "black",
      array: false,
    });
    expect(declaration.defines).toEqual([{ name: "TINTED", value: false }]);
  });
});
