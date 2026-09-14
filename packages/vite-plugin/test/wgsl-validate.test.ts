import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import { scanAssetRoot } from "../src/manifest.js";
import { formatValidationProblem } from "../src/validate.js";
import {
  IGNIFX_SYSTEM_UNIFORMS,
  LITE_SYSTEM_UNIFORMS,
  validateWgslAsset,
  validateWgslAssets,
  validateWgslSource,
  WGSL_EXTENSION,
} from "../src/wgsl-validate.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES } from "./support/fixtures.js";
import type { WgslProblem } from "../src/wgsl-validate.js";

afterAll(disposeFixtures);

/** Where the committed `.wgsl` fixtures live; they are real files so a build reads what CI reads. */
const SHADER_FIXTURES = join(import.meta.dirname, "fixtures", "shaders");

/** Reads one committed fixture. */
function fixture(name: string): Promise<string> {
  return readFile(join(SHADER_FIXTURES, name), "utf8");
}

/** Validates one committed fixture. */
async function validateFixture(name: string): Promise<readonly WgslProblem[]> {
  return validateWgslSource(await fixture(name));
}

describe("validateWgslSource on a valid shader", () => {
  it.each([
    ["valid-shader.wgsl", "a full ShaderMaterial"],
    ["valid-surface.surface.wgsl", "a SurfaceShader with all three hooks"],
    ["valid-post.post.wgsl", "a PostEffect"],
    ["valid-instanced.wgsl", "an instanced particle draw that reads a storage buffer"],
    ["valid-commented-out.wgsl", "a file whose commented-out revision would break every rule"],
  ])("accepts %s (%s)", async (name) => {
    expect(await validateFixture(name)).toEqual([]);
  });
});

describe("rule 1 — the file must parse", () => {
  it("reports a syntax error as IGX-0654 with the parser's line", async () => {
    const problems = await validateFixture("syntax-error.wgsl");
    expect(problems).toEqual([
      { line: 4, message: "is not valid WGSL (Expected ')' for argument list)", code: "IGX-0654" },
    ]);
  });

  it("reports nothing but the syntax error, because every other rule reads the parse", async () => {
    // The fixture also has no `mainFragment`, which rule 4 would report on a file that parsed.
    expect(await validateFixture("syntax-error.wgsl")).toHaveLength(1);
  });

  it("explains a recursive call instead of repeating the parser's stack overflow", () => {
    // `wgsl_reflect` resolves the call graph recursively and exhausts its stack on a self-call, with
    // no position in the message. WGSL forbids recursion, so the file is invalid either way.
    const recursive = [
      "// @ignifx shader",
      "fn spin(depth: i32) -> f32 { if (depth > 0) { return spin(depth - 1); } return 0.0; }",
      "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(spin(3)); }",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
      "",
    ].join("\n");
    expect(validateWgslSource(recursive)).toEqual([
      {
        line: 1,
        message:
          "is not valid WGSL (the parser ran out of stack, which happens on a recursive call; WGSL " +
          "forbids recursion, so check for a function that calls itself, directly or through another)",
        code: VitePluginErrorCode.wgslSyntaxError,
      },
    ]);
  });

  it("treats a file of nothing but comments as an empty program, not a parse failure", () => {
    // Only the rules that need a form fire; the parse itself succeeds on an empty program.
    const problems = validateWgslSource("// @ignifx shader\n// nothing else yet\n");
    expect(problems).toHaveLength(2);
    expect(problems.every((problem) => problem.code === VitePluginErrorCode.wgslContractViolation)).toBe(true);
  });
});

describe("rule 2 — exactly one form pragma", () => {
  it("reports a file that declares no form", async () => {
    const problems = await validateFixture("no-kind.wgsl");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(1);
    expect(problems[0]?.message).toContain("declares no form");
    expect(problems[0]?.code).toBe(VitePluginErrorCode.wgslContractViolation);
  });

  it("reports a second form pragma on its own line and names the first", async () => {
    const problems = await validateFixture("two-kinds.wgsl");
    expect(problems).toEqual([
      {
        line: 2,
        message: 'declares "post" as well as "shader" on line 1; a shader file is exactly one form',
        code: "IGX-0655",
      },
    ]);
  });

  it("checks only the rules that do not need a form when the form is missing", () => {
    // A hand-declared binding is wrong whatever the form is; a missing entry point is not knowable.
    const problems = validateWgslSource(
      ["@group(0) @binding(0) var<uniform> mine: f32;", "fn helper() -> f32 { return mine; }", ""].join("\n"),
    );
    expect(problems.map((problem) => problem.line)).toEqual([1, 1]);
    expect(problems[1]?.message).toContain('declares the binding "mine"');
  });
});

describe("rule 3 — every name a shader reads must be declared", () => {
  it("reports a shaderUniforms member the file never declared", async () => {
    const problems = await validateFixture("undeclared-uniform.wgsl");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(9);
    expect(problems[0]?.message).toContain("reads shaderUniforms.progres, which is not declared");
    expect(problems[0]?.message).toContain('"// @ignifx uniform progres: <type> = <default>"');
  });

  it("accepts an ignifx-supplied uniform declared on an @ignifx system line", () => {
    const source = [
      "// @ignifx shader",
      "// @ignifx system time, deltaTime, mainLightColor, ambientColor",
      "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(shaderUniforms.time); }",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> {",
      "  return vec4<f32>(shaderUniforms.mainLightColor * shaderUniforms.ambientColor, shaderUniforms.deltaTime);",
      "}",
      "",
    ].join("\n");
    expect(validateWgslSource(source)).toEqual([]);
  });

  it("reports a shaderSystem member Babylon Lite does not supply", async () => {
    const problems = await validateFixture("unknown-system-uniform.wgsl");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(5);
    expect(problems[0]?.message).toContain("reads shaderSystem.time, which Babylon Lite does not supply");
    expect(problems[0]?.message).toContain("are read from shaderUniforms");
  });

  it("accepts every one of Lite's own system uniforms", () => {
    const reads = LITE_SYSTEM_UNIFORMS.map((name) => `shaderSystem.${name}`).join(" + ");
    const source = [
      "// @ignifx shader",
      `// @ignifx system ${LITE_SYSTEM_UNIFORMS.join(", ")}`,
      `@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(${reads}); }`,
      "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
      "",
    ].join("\n");
    expect(validateWgslSource(source)).toEqual([]);
  });

  it("reports a sampled texture the file never declared", async () => {
    const problems = await validateFixture("undeclared-texture.wgsl");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(9);
    expect(problems[0]?.message).toBe(
      'samples "detail", which is not a declared texture; add "// @ignifx texture detail" ' +
        '(its sampler is then "detailSampler")',
    );
  });

  it("reports a surfaceUniforms member a surface shader never declared", async () => {
    const problems = await validateFixture("undeclared-surface-uniform.surface.wgsl");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(5);
    expect(problems[0]?.message).toContain("reads surfaceUniforms.amont, which is not declared");
  });

  it("reports an engine uniform a shader reads but never declares", async () => {
    // `toShaderMaterialOptions` in `@ignifx/core` builds `shaderUniforms`/`shaderSystem` from the
    // declaration alone, so an undeclared engine name is not a member of the generated struct.
    const problems = await validateFixture("undeclared-system.wgsl");
    expect(problems).toEqual([
      {
        line: 9,
        message: 'reads shaderUniforms.time, which the file does not declare; add "// @ignifx system time"',
        code: "IGX-0655",
      },
      {
        line: 10,
        message:
          "reads shaderSystem.cameraPosition, which the file does not declare; add " +
          '"// @ignifx system cameraPosition"',
        code: "IGX-0655",
      },
    ]);
  });

  it("lets a post effect read the engine names without an @ignifx system line", () => {
    // A post effect's bindings are the post-process stack's, not a shader material's, so the
    // declaration rule that governs a `shader` file does not apply.
    const source = [
      "// @ignifx post",
      "fn mainFragment(in: PostInput) -> vec4<f32> {",
      "  let wobble = sin(shaderUniforms.time) / shaderUniforms.screenSize.x;",
      "  return textureSample(inputTexture, inputTextureSampler, in.uv + vec2<f32>(wobble, 0.0));",
      "}",
      "",
    ].join("\n");
    expect(validateWgslSource(source)).toEqual([]);
  });

  it("binds inputTexture for a post effect without a texture pragma", () => {
    const source = [
      "// @ignifx post",
      "fn mainFragment(in: PostInput) -> vec4<f32> {",
      "  return textureSample(inputTexture, inputTextureSampler, in.uv);",
      "}",
      "",
    ].join("\n");
    expect(validateWgslSource(source)).toEqual([]);
  });

  it("checks textureLoad and textureDimensions as well as the textureSample family", () => {
    const source = [
      "// @ignifx shader",
      "@vertex fn mainVertex() -> @builtin(position) vec4<f32> {",
      "  let size = textureDimensions(sizeTexture);",
      "  return vec4<f32>(f32(size.x));",
      "}",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> {",
      "  return textureLoad(loadTexture, vec2<i32>(0, 0), 0);",
      "}",
      "",
    ].join("\n");
    expect(validateWgslSource(source).map((problem) => problem.line)).toEqual([3, 7]);
  });

  it("leaves a texture built-in whose first argument is not a bare name unchecked", () => {
    // A name this rule cannot read is left alone rather than guessed at: the browser's compiler is
    // still the authority on types, and a false build failure is worse than a missed hint.
    const source = [
      "// @ignifx shader",
      "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }",
      "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {",
      "  return textureSample(bundle.tex, bundle.samp, uv);",
      "}",
      "",
    ].join("\n");
    expect(validateWgslSource(source)).toEqual([]);
  });

  it("ignores names that appear only inside comments", async () => {
    // `valid-commented-out.wgsl` hides a second form pragma, an undeclared texture and an
    // undeclared uniform inside nested block comments and a trailing line comment.
    expect(await validateFixture("valid-commented-out.wgsl")).toEqual([]);
  });
});

describe("rule 4 — the declared form's entry points must exist", () => {
  it("reports a shader with no mainFragment", async () => {
    const problems = await validateFixture("missing-entry.wgsl");
    expect(problems).toEqual([
      {
        line: 1,
        message: 'declares "shader" but has no "@fragment fn mainFragment"; Lite calls that entry point by name',
        code: "IGX-0655",
      },
    ]);
  });

  it("reports a shader with no mainVertex", () => {
    const source = [
      "// @ignifx shader",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
      "",
    ].join("\n");
    expect(validateWgslSource(source)[0]?.message).toContain('no "@vertex fn mainVertex"');
  });

  it("reports a plain fn mainVertex that carries no @vertex attribute", () => {
    const source = [
      "// @ignifx shader",
      "fn mainVertex() -> vec4<f32> { return vec4<f32>(0.0); }",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
      "",
    ].join("\n");
    expect(validateWgslSource(source)[0]?.message).toContain('no "@vertex fn mainVertex"');
  });

  it("reports a post effect with no mainFragment", async () => {
    const problems = await validateFixture("missing-post-entry.post.wgsl");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('declares "post" but has no "fn mainFragment(in: PostInput) -> vec4<f32>"');
  });

  it("reports a surface shader that implements none of the three hooks", async () => {
    const problems = await validateFixture("no-surface-hook.surface.wgsl");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('implements none of "displace", "surface", "composite"');
  });

  it.each(["displace", "surface", "composite"])("accepts a surface shader with only %s", (hook) => {
    const source = ["// @ignifx surface", `fn ${hook}() -> vec3<f32> { return vec3<f32>(0.0); }`, ""].join("\n");
    expect(validateWgslSource(source)).toEqual([]);
  });
});

describe("rule 5 — no hand-declared bindings", () => {
  it("reports a @group(1) uniform with its group, binding and declaration line", async () => {
    const problems = await validateFixture("hand-declared-binding.wgsl");
    expect(problems).toEqual([
      {
        line: 7,
        message:
          'declares the binding "mine" at @group(1) @binding(4) by hand; ignifx and Lite generate every ' +
          'binding from the "// @ignifx uniform|texture|storage" declarations, so remove it and declare it ' +
          "as a pragma",
        code: "IGX-0655",
      },
    ]);
  });

  it("reports a @group(2) texture and sampler too, because nothing binds that group", async () => {
    const problems = await validateFixture("unbound-group.wgsl");
    const bindings = problems.filter((problem) => problem.message.includes("by hand"));
    expect(bindings.map((problem) => problem.line)).toEqual([3, 4]);
    expect(bindings[0]?.message).toContain("@group(2) @binding(0)");
  });

  it("reports a storage buffer declared by hand", () => {
    const source = [
      "// @ignifx shader",
      "@group(1) @binding(2) var<storage, read> records: array<f32>;",
      "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(records[0]); }",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
      "",
    ].join("\n");
    const problems = validateWgslSource(source);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('declares the binding "records"');
  });

  it("reports a resource declared with no @group at all, which WGSL defaults to group 0", () => {
    const source = [
      "// @ignifx shader",
      "var<uniform> loose: f32;",
      "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(loose); }",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
      "",
    ].join("\n");
    expect(validateWgslSource(source)[0]?.message).toContain('"loose" at @group(0) @binding(0)');
  });

  it("says so when the pragma above already declares the name the WGSL binds", () => {
    const source = [
      "// @ignifx shader",
      "// @ignifx texture noiseTexture",
      "@group(1) @binding(2) var noiseTexture: texture_2d<f32>;",
      "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }",
      "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {",
      "  return textureSample(noiseTexture, noiseTextureSampler, uv);",
      "}",
      "",
    ].join("\n");
    const problems = validateWgslSource(source);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(3);
    expect(problems[0]?.message).toContain("already declares it and ignifx generates the binding, so delete this line");
  });

  it("leaves a struct, an alias and a const alone", () => {
    const source = [
      "// @ignifx shader",
      "alias Weight = f32;",
      "const SOFT_EDGE: bool = true;",
      "struct Row { a: Weight, b: f32 }",
      "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
      "",
    ].join("\n");
    expect(validateWgslSource(source)).toEqual([]);
  });
});

describe("rule 6 — no texture sampling in a vertex stage", () => {
  it("reports textureSample in the vertex entry with the textureSampleLevel hint", async () => {
    const problems = await validateFixture("vertex-sampling.wgsl");
    expect(problems).toEqual([
      {
        line: 5,
        message:
          'calls textureSample in "mainVertex", which the vertex stage reaches; WGSL allows textureSample ' +
          "in the fragment stage only — use textureSampleLevel or textureLoad",
        code: "IGX-0655",
      },
    ]);
  });

  it("follows the call graph transitively to find it two functions deep", async () => {
    const problems = await validateFixture("vertex-sampling-transitive.wgsl");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(5);
    expect(problems[0]?.message).toContain('in "sampleHeight"');
  });

  it("accepts textureSampleLevel and textureLoad in the vertex stage", () => {
    const source = [
      "// @ignifx shader",
      "// @ignifx texture lut",
      "@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {",
      "  let row = textureSampleLevel(lut, lutSampler, input.uv, 0.0).r;",
      "  let cell = textureLoad(lut, vec2<i32>(0, 0), 0).r;",
      "  return vec4<f32>(input.position * (row + cell), 1.0);",
      "}",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
      "",
    ].join("\n");
    expect(validateWgslSource(source)).toEqual([]);
  });

  it("accepts textureSample in the fragment stage", async () => {
    // The valid ShaderMaterial samples in `mainFragment`, which is where WGSL allows it.
    expect(await validateFixture("valid-shader.wgsl")).toEqual([]);
  });

  it("reports any texture read a surface shader's displace hook reaches", async () => {
    const problems = await validateFixture("displace-texture.surface.wgsl");
    expect(problems).toEqual([
      {
        line: 5,
        message:
          'reads a texture in "displace", which the "displace" hook reaches; Lite binds a plugin\'s samplers ' +
          'to the fragment stage only, so sample in "surface" or "composite" instead',
        code: "IGX-0655",
      },
    ]);
  });

  it("follows two vertex-reachable paths through one shared callee", () => {
    // The traversal is over `FunctionInfo.calls` with a visited set, so a diamond is walked once.
    const source = [
      "// @ignifx shader",
      "// @ignifx texture lut",
      "fn shared(uv: vec2<f32>) -> f32 { return textureSample(lut, lutSampler, uv).r; }",
      "fn left(uv: vec2<f32>) -> f32 { return shared(uv); }",
      "fn right(uv: vec2<f32>) -> f32 { return shared(uv) * 2.0; }",
      "@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {",
      "  return vec4<f32>(left(input.uv) + right(input.uv));",
      "}",
      "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }",
      "",
    ].join("\n");
    const problems = validateWgslSource(source);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('in "shared"');
  });
});

describe("validateWgslAsset", () => {
  it("puts the line at the head of the message and leaves the JSON pointer empty", async () => {
    const problems = validateWgslAsset(
      "shaders/vertex-sampling.wgsl",
      "/p/assets/shaders/vertex-sampling.wgsl",
      await fixture("vertex-sampling.wgsl"),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.address).toBe("shaders/vertex-sampling.wgsl");
    expect(problems[0]?.filePath).toBe("/p/assets/shaders/vertex-sampling.wgsl");
    expect(problems[0]?.pointer).toBe("");
    expect(problems[0]?.message).toMatch(/^line 5: calls textureSample/u);
  });

  it("renders through the plugin's shared problem formatter", async () => {
    const problems = validateWgslAsset("shaders/x.wgsl", "/p/x.wgsl", await fixture("missing-entry.wgsl"));
    expect(
      formatValidationProblem(problems[0] ?? { address: "", filePath: "", pointer: "", message: "", code: "IGX-0654" }),
    ).toBe(
      'shaders/x.wgsl: line 1: declares "shader" but has no "@fragment fn mainFragment"; ' +
        "Lite calls that entry point by name (IGX-0655)",
    );
  });

  it("returns nothing for a valid file", async () => {
    expect(validateWgslAsset("shaders/ok.wgsl", "/p/ok.wgsl", await fixture("valid-shader.wgsl"))).toEqual([]);
  });
});

describe("validateWgslAssets over a scanned tree", () => {
  it("validates every .wgsl file and skips everything else", async () => {
    const root = await createFixtureTree({
      "assets/sprites/hero.png": PNG_BYTES,
      "assets/data/loot.json": "{}",
      "assets/shaders/good.wgsl": await fixture("valid-shader.wgsl"),
      "assets/shaders/bad.wgsl": await fixture("vertex-sampling.wgsl"),
      "assets/shaders/snow.surface.wgsl": await fixture("valid-surface.surface.wgsl"),
    });
    const assets = await scanAssetRoot({ assetRoot: join(root, "assets"), hashLength: 8 });
    const problems = await validateWgslAssets(assets);
    expect(problems.map((problem) => problem.address)).toEqual(["shaders/bad.wgsl"]);
  });

  it("is case-insensitive about the extension", async () => {
    const root = await createFixtureTree({ "assets/shaders/UPPER.WGSL": await fixture("missing-entry.wgsl") });
    const assets = await scanAssetRoot({ assetRoot: join(root, "assets"), hashLength: 8 });
    const problems = await validateWgslAssets(assets);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.address).toBe("shaders/UPPER.WGSL");
  });

  it("returns nothing for a tree with no shaders", async () => {
    const root = await createFixtureTree({ "assets/sprites/hero.png": PNG_BYTES });
    const assets = await scanAssetRoot({ assetRoot: join(root, "assets"), hashLength: 8 });
    expect(await validateWgslAssets(assets)).toEqual([]);
  });
});

describe("the declared name tables", () => {
  it("names the extension a shader asset carries", () => {
    expect(WGSL_EXTENSION).toBe(".wgsl");
  });

  it("keeps Lite's system uniforms and ignifx's own disjoint", () => {
    // The two lists are what makes the shaderSystem/shaderUniforms message actionable: Lite 1.27.0
    // supplies no `time` and no lights (`index.d.ts` 11445), so ignifx's arrive as custom uniforms.
    const overlap = LITE_SYSTEM_UNIFORMS.filter((name) => IGNIFX_SYSTEM_UNIFORMS.includes(name));
    expect(overlap).toEqual([]);
  });

  it("does not list a time uniform among Lite's", () => {
    expect(LITE_SYSTEM_UNIFORMS).not.toContain("time");
    expect(IGNIFX_SYSTEM_UNIFORMS).toContain("time");
  });
});
