import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { defineParticles } from "../../src/definition/define-particles.js";
import { PARTICLE_PRESETS, particleDefinition } from "../../src/definition/presets/index.js";
import { PARTICLE_RENDER_MODES } from "../../src/definition/types.js";
import {
  RECORD_LIFETIME,
  RECORD_POSITION,
  RECORD_ROTATION,
  RECORD_SEED,
  RECORD_SIZE,
  RECORD_SPAWN_TIME,
  RECORD_VELOCITY,
} from "../../src/emitter/record-ring.js";
import { generateParticleWgsl, particleShaderAddress } from "../../src/gpu/wgsl.js";
import { createParticlesApp } from "../support/harness.js";
import { litePrelude } from "../support/wgsl-prelude.js";
import type { ParticleDefinition, ParticleDefinitionInput } from "../../src/definition/types.js";
import type { ParticlesAppHarness } from "../support/harness.js";
import type { ShaderAsset, ShaderDeclaration } from "@ignifx/core";

/** Floats are four bytes; the record's float indices become the struct's byte offsets. */
const FLOAT_BYTES = 4;

let harness: ParticlesAppHarness;

beforeAll(async () => {
  harness = await createParticlesApp({ start: false });
});

afterAll(() => {
  harness.dispose();
});

/**
 * Reads a generated program's declaration the way the engine does: through core's `.wgsl` loader,
 * which is the only public path to the pragma parser.
 *
 * @param source - The generated WGSL.
 * @returns The parsed declaration.
 */
async function declarationOf(source: string): Promise<ShaderDeclaration> {
  using handle = harness.app.assets.load<ShaderAsset>(particleShaderAddress(source), { type: "shader" });
  await handle.promise;
  return handle.value.declaration;
}

/**
 * Generates a program and reflects it the way the GPU sees it: Babylon Lite's prelude, then the
 * generated source.
 *
 * @param definition - The definition to generate from.
 * @returns The reflection.
 */
async function reflect(definition: ParticleDefinition): Promise<WgslReflect> {
  const source = generateParticleWgsl(definition);
  return new WgslReflect(`${litePrelude(await declarationOf(source))}\n${source}`);
}

/**
 * Generates a program from an authored document.
 *
 * @param input - The document.
 * @returns The WGSL source.
 */
function generate(input: ParticleDefinitionInput): string {
  return generateParticleWgsl(defineParticles(input));
}

describe("the generated declaration", () => {
  it.each(PARTICLE_PRESETS)("parses for %s", async (name) => {
    const declaration = await declarationOf(generateParticleWgsl(particleDefinition(name)));
    expect(declaration.kind).toBe("shader");
    expect(declaration.attributes).toContain("position");
    expect(declaration.pipeline.instancing).toBe("matrices");
    expect(declaration.pipeline.depthWrite).toBe(false);
    expect(declaration.pipeline.cull).toBe("none");
    expect(declaration.storage.map((entry) => entry.name)).toEqual(["particles"]);
    expect(declaration.textures.map((entry) => entry.name)).toContain("lut");
  });

  it("declares the definition's blend mode", async () => {
    for (const blend of ["premultiplied", "additive", "alpha"] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one asset cache, one load at a time.
      const declaration = await declarationOf(generate({ renderer: { blend } }));
      expect(declaration.pipeline.blend).toBe(blend);
    }
  });

  it("declares the sheet sampler only when the definition names a texture", async () => {
    const bare = await declarationOf(generate({}));
    expect(bare.textures.map((entry) => entry.name)).toEqual(["lut"]);
    const textured = await declarationOf(generate({ renderer: { texture: "fx/smoke.png" } }));
    expect(textured.textures.map((entry) => entry.name)).toEqual(["sheet", "lut"]);
  });

  it("declares the emitter matrix only for a local-space definition", async () => {
    const local = await declarationOf(generate({ main: { simulationSpace: "local" } }));
    expect(local.uniforms.map((entry) => entry.name)).toContain("emitterWorld");
    const world = await declarationOf(generate({ main: { simulationSpace: "world" } }));
    expect(world.uniforms.map((entry) => entry.name)).not.toContain("emitterWorld");
  });

  it("declares the orbit centre only for a definition that orbits", async () => {
    const plain = await declarationOf(generate({}));
    expect(plain.uniforms.map((entry) => entry.name)).not.toContain("orbitCenter");
    const orbiting = await declarationOf(generate({ forces: { orbit: { axis: { x: 0, y: 1, z: 0 }, speed: 30 } } }));
    expect(orbiting.uniforms.map((entry) => entry.name)).toContain("orbitCenter");
  });

  it("declares the light uniforms only for a lit definition", async () => {
    expect((await declarationOf(generate({ renderer: { lit: false } }))).ignifx).toEqual([]);
    expect((await declarationOf(generate({ renderer: { lit: true } }))).ignifx).toEqual([
      "mainLightDirection",
      "mainLightColor",
      "ambientColor",
    ]);
  });

  it("asks for the camera position only for a vertical billboard", async () => {
    expect((await declarationOf(generate({ renderer: { mode: "vertical" } }))).system).toContain("cameraPosition");
    expect((await declarationOf(generate({ renderer: { mode: "billboard" } }))).system).not.toContain("cameraPosition");
  });

  it("asks for the normal attribute only for a mesh renderer", async () => {
    expect((await declarationOf(generate({ renderer: { mode: "mesh" } }))).attributes).toEqual([
      "position",
      "normal",
      "uv",
    ]);
    expect((await declarationOf(generate({}))).attributes).toEqual(["position", "uv"]);
  });
});

describe("the reflected Particle struct", () => {
  it.each(PARTICLE_PRESETS)("puts every member of %s where the TypeScript writer does", async (name) => {
    const particle = (await reflect(particleDefinition(name))).structs.find((entry) => entry.name === "Particle");
    expect(particle).toBeDefined();
    expect(particle?.size).toBe(48);
    const offsets = new Map(particle?.members.map((member) => [member.name, member.offset]) ?? []);
    expect(offsets.get("spawnTime")).toBe(RECORD_SPAWN_TIME * FLOAT_BYTES);
    expect(offsets.get("lifetime")).toBe(RECORD_LIFETIME * FLOAT_BYTES);
    expect(offsets.get("seed")).toBe(RECORD_SEED * FLOAT_BYTES);
    expect(offsets.get("position")).toBe(RECORD_POSITION * FLOAT_BYTES);
    expect(offsets.get("size")).toBe(RECORD_SIZE * FLOAT_BYTES);
    expect(offsets.get("velocity")).toBe(RECORD_VELOCITY * FLOAT_BYTES);
    expect(offsets.get("rotation")).toBe(RECORD_ROTATION * FLOAT_BYTES);
  });
});

describe("the generated program", () => {
  it.each(PARTICLE_PRESETS)("has one vertex and one fragment entry point for %s", async (name) => {
    const reflection = await reflect(particleDefinition(name));
    expect(reflection.entry.vertex.map((entry) => entry.name)).toEqual(["mainVertex"]);
    expect(reflection.entry.fragment.map((entry) => entry.name)).toEqual(["mainFragment"]);
  });

  it("parses for every render mode, lit or not, with or without a sheet", async () => {
    for (const mode of PARTICLE_RENDER_MODES) {
      for (const lit of [false, true]) {
        for (const frameOverTime of [undefined, "random", { fps: 12 }] as const) {
          const definition = defineParticles({
            forces: {
              drag: 1,
              orbit: { axis: { x: 1, y: 1, z: 0 }, speed: 45 },
              noise: {
                strength: 0.5,
                octaves: 2,
                influenceOverLife: {
                  curve: {
                    keys: [
                      [0, 1, 0, 0],
                      [1, 0, 0, 0],
                    ],
                  },
                },
              },
            },
            overLifetime: {
              color: {
                gradient: [
                  [0, 1, 1, 1, 1],
                  [1, 0, 0, 0, 0],
                ],
              },
              size: {
                curve: {
                  keys: [
                    [0, 1, 0, 0],
                    [1, 0, 0, 0],
                  ],
                },
              },
              rotation: {
                curve: {
                  keys: [
                    [0, 0, 0, 0],
                    [1, 90, 0, 0],
                  ],
                },
              },
            },
            renderer: {
              mode,
              lit,
              texture: "fx/sheet.png",
              sheet: { tiles: { x: 4, y: 4 }, ...(frameOverTime === undefined ? {} : { frameOverTime }) },
            },
          });
          const label = `${mode} lit=${String(lit)} sheet=${JSON.stringify(frameOverTime ?? "none")}`;
          // oxlint-disable-next-line eslint/no-await-in-loop -- one asset cache, one load at a time.
          await expect(reflect(definition), label).resolves.toBeDefined();
        }
      }
    }
  });

  it("folds a definition's constants into the source, so an unused module costs nothing", () => {
    const plain = generate({});
    expect(plain).not.toContain("noise3");
    expect(plain).not.toContain("ORBIT_AXIS");
    expect(plain).not.toContain("SHEET_TILES");
    const full = generate({
      forces: { orbit: { axis: { x: 0, y: 1, z: 0 }, speed: 10 }, noise: { strength: 1 } },
      renderer: { sheet: { tiles: { x: 2, y: 2 } } },
    });
    expect(full).toContain("noise3");
    expect(full).toContain("ORBIT_AXIS");
    expect(full).toContain("SHEET_TILES");
  });

  it("writes the drag closed form only when the definition drags", () => {
    expect(generate({ forces: { drag: 0 } })).toContain("record.position + record.velocity * t");
    expect(generate({ forces: { drag: 2 } })).toContain("exp(-DRAG * t)");
  });

  it("collapses a dead record behind the far plane", () => {
    expect(generate({})).toContain("const DEAD: vec4<f32> = vec4<f32>(0.0, 0.0, 2.0, 1.0);");
  });

  it("maps the instance index to the newest record first", () => {
    expect(generate({})).toContain("let slot = (head + capacity - 1u - iid) % capacity;");
  });

  it("premultiplies the fragment only for the premultiplied blend", () => {
    expect(generate({ renderer: { blend: "premultiplied" } })).toContain("color.rgb * color.a");
    expect(generate({ renderer: { blend: "additive" } })).not.toContain("color.rgb * color.a");
  });

  it("writes every float as a WGSL float literal, never a bare integer", () => {
    const source = generate({ forces: { drag: 2 }, start: { size3D: { x: 1, y: 2, z: 3 } } });
    expect(source).toContain("const DRAG: f32 = 2.0;");
    expect(source).toContain("vec3<f32>(1.0, 2.0, 3.0)");
  });
});

describe("particleShaderAddress", () => {
  it("is a data URL that round-trips the source", () => {
    const source = generate({});
    const address = particleShaderAddress(source);
    expect(address.startsWith("data:text/plain;base64,")).toBe(true);
    expect(atob(address.slice("data:text/plain;base64,".length))).toBe(source);
  });

  it("gives two definitions that generate the same program one address", () => {
    expect(particleShaderAddress(generate({}))).toBe(particleShaderAddress(generate({})));
    expect(particleShaderAddress(generate({}))).not.toBe(particleShaderAddress(generate({ forces: { drag: 1 } })));
  });
});
