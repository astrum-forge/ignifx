import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { defineMaterialPlugin } from "./material-plugin.js";
import { SURFACE_HOOK_NAMES, SURFACE_UNIFORM_BLOCK } from "./shader-declaration.js";
import type { LiteMaterialPluginPoint, MaterialPluginDefinition } from "./material-plugin.js";
import type { ShaderDeclaration, SurfaceHookName } from "./shader-declaration.js";

/**
 * The surface-shader compiler: three plain WGSL functions in, one Babylon Lite material plugin out
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.2).
 *
 * A `.surface.wgsl` declares its uniforms and textures with `// @ignifx` pragmas and provides up to
 * three functions that never mention Lite: `SurfaceInput`, `Surface` and `DisplaceInput` are
 * generated here, and `surfaceUniforms.x` is rewritten to whichever uniform block the host family
 * carries.
 *
 * ```wgsl
 * // @ignifx surface
 * // @ignifx uniform amount: f32 = 0.6 range(0, 1)
 * fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
 *   (*s).baseColor = mix((*s).baseColor, vec3<f32>(1.0), surfaceUniforms.amount);
 * }
 * ```
 *
 * Where each hook lands, and what that costs:
 *
 * | Hook | PBR slot | Standard slot |
 * | --- | --- | --- |
 * | `displace` | `CUSTOM_VERTEX_UPDATE_WORLDPOS`, inlined | the same |
 * | `surface` | `CUSTOM_FRAGMENT_UPDATE_ALPHA` + `CUSTOM_FRAGMENT_UPDATE_DIFFUSE` | `CUSTOM_FRAGMENT_UPDATE_ALPHA` alone |
 * | `composite` | `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION` | **unsupported** |
 *
 * - Every declared name is emitted as `<shader>_<name>` and the author's references are rewritten,
 *   because a plugin's fields join the **host material's** uniform block and bind group. A declared
 *   texture's name is therefore reserved inside the file.
 * - `displace` cannot read a uniform, a texture or a helper function — Lite's plugin uniforms and
 *   samplers are fragment-visible only and it offers no vertex helper channel — so its body is
 *   inlined with its `return` rewritten to a `break`, and one that reads any of them, or that loops
 *   or switches (which would capture that `break`), is refused here.
 * - A `surface` hook's write to `alpha` reaches blending, not the cutout test: the alpha-test
 *   fragment sorts before a plugin in Lite's slot composition, so an `alphaMode: "mask"` host has
 *   already discarded by the time the hook runs.
 * - `composite` is injected twice (Lite maps the point to the adjacent PBR slots `AI` and `NI`), so
 *   the generated code is guarded by a flag declared in the `UPDATE_ALPHA` block.
 * - `emissive` is written as the delta `s.emissive - emissive` added to `color`, because the PBR
 *   template declares `emissive` as `let` or `var` depending on the host's textures.
 * - `roughness` and `metallic` are readable and ignored on write (`let` in the template). Vertex
 *   colour reads white and `uv2` is absent: Lite gates both behind state a plugin cannot see.
 */

/**
 * The material family a surface shader is compiled against. The generated WGSL differs: the two
 * templates name their variables differently and Standard has fewer injection points.
 *
 * @public
 */
export type SurfaceHostFamily = "pbr" | "standard";

/**
 * What the compiler has to know about the host material beyond its family.
 *
 * @remarks
 * Both flags exist because Standard's template declares a varying or a variable only when something
 * asks for it: `input.vu` exists only when the material carries a texture that samples UV
 * (`standard-flags.js` `NEEDS_UV`), and `normalW` only when lighting is on. Referencing either
 * without it is a WGSL compile error in Lite's own template, so the compiler substitutes a constant
 * instead. A PBR host always has both.
 *
 * @public
 */
export interface SurfaceHostCapabilities {
  /** Which family's slots and variable names to generate for. */
  readonly family: SurfaceHostFamily;
  /** Whether the host declares a UV varying. `false` makes `in.uv` read `(0, 0)`. */
  readonly hasUv: boolean;
  /** Whether the host declares a shading normal. `false` makes a `normal` write a no-op. */
  readonly hasNormal: boolean;
}

/**
 * One hook, as it was found in the file.
 *
 * @internal
 */
export interface SurfaceHook {
  /** Which hook it is. */
  readonly name: SurfaceHookName;
  /** The parameter identifiers, in order, as the author wrote them. */
  readonly parameters: readonly string[];
  /** The statements between the braces, verbatim. */
  readonly body: string;
  /** Where the whole `fn …` declaration starts in the source. */
  readonly start: number;
  /** Where it ends, one past the closing brace. */
  readonly end: number;
}

/**
 * The hooks a file provides, plus everything else it declared.
 *
 * @internal
 */
export interface SurfaceShaderHooks {
  /** The vertex offset hook, or `null`. */
  readonly displace: SurfaceHook | null;
  /** The surface hook, or `null`. */
  readonly surface: SurfaceHook | null;
  /** The post-lighting hook, or `null`. */
  readonly composite: SurfaceHook | null;
  /** The file with the three hook declarations cut out: structs, constants, helper functions. */
  readonly rest: string;
}

/** The members a `displace` hook may read off its parameter. */
const DISPLACE_MEMBERS: readonly string[] = Object.freeze(["position", "normal", "uv", "color", "world"]);

/** Matches the start of a top-level hook declaration. */
const HOOK_START = /\bfn\s+(displace|surface|composite)\s*\(/g;

/** Matches `surfaceUniforms.<identifier>`. */
const UNIFORM_REFERENCE = /\bsurfaceUniforms\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g;

/** Matches a `return <expression>;` statement. */
const RETURN_STATEMENT = /\breturn\b([^;]*);/g;

/** Matches any WGSL control-flow construct a `break` could bind to. */
const BREAKING_CONSTRUCT = /\b(loop|for|while|switch)\b/;

/** Matches the start of any top-level function declaration, capturing its name. */
const FUNCTION_START = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

/**
 * Finds the hooks a `.surface.wgsl` file declares.
 *
 * @remarks
 * A hand-written brace scan rather than a WGSL parser: the file has already been validated by the
 * Vite plugin at build time, and all this needs is the extent of three top-level functions. It
 * looks for `fn displace|surface|composite (` anywhere in the file and then matches the parameter
 * parentheses and the body braces, so a hook may be written in any order and with any formatting.
 *
 * @param source - The whole file.
 * @param address - The asset address, for the error message.
 * @returns The hooks found and the rest of the file.
 * @throws IgnifxError with code `IGX-0723` when the file declares none of the three, or `IGX-0719`
 * when a hook's braces or parentheses do not close.
 *
 * @internal
 */
export function parseSurfaceHooks(source: string, address: string): SurfaceShaderHooks {
  const found = new Map<SurfaceHookName, SurfaceHook>();
  const cuts: { start: number; end: number }[] = [];
  HOOK_START.lastIndex = 0;
  let match = HOOK_START.exec(source);
  while (match !== null) {
    const name = match[1];
    const openParen = match.index + match[0].length - 1;
    const closeParen = matchDelimiter(source, openParen, "(", ")");
    const openBrace = source.indexOf("{", closeParen);
    if (closeParen < 0 || openBrace < 0) {
      throw new IgnifxError(CoreErrorCode.invalidShaderPragma, `${address}: the ${name} hook does not close.`, {
        context: { asset: address, hook: name ?? "" },
        hint: "Check the parentheses and braces of the hook declaration.",
      });
    }
    const closeBrace = matchDelimiter(source, openBrace, "{", "}");
    if (closeBrace < 0) {
      throw new IgnifxError(CoreErrorCode.invalidShaderPragma, `${address}: the ${name} hook's body does not close.`, {
        context: { asset: address, hook: name ?? "" },
        hint: "Add the missing closing brace.",
      });
    }
    if (isSurfaceHookName(name)) {
      found.set(name, {
        name,
        parameters: parseParameterNames(source.slice(openParen + 1, closeParen)),
        body: source.slice(openBrace + 1, closeBrace),
        start: match.index,
        end: closeBrace + 1,
      });
      cuts.push({ start: match.index, end: closeBrace + 1 });
    }
    HOOK_START.lastIndex = closeBrace + 1;
    match = HOOK_START.exec(source);
  }
  if (found.size === 0) {
    throw new IgnifxError(
      CoreErrorCode.surfaceHookMissing,
      `${address} declares a surface shader with none of the hooks displace, surface, or composite.`,
      {
        context: { asset: address },
        hint: "Add fn surface(in: SurfaceInput, s: ptr<function, Surface>), fn composite(in, color), or fn displace(in).",
      },
    );
  }
  return {
    displace: found.get("displace") ?? null,
    surface: found.get("surface") ?? null,
    composite: found.get("composite") ?? null,
    rest: cutRanges(source, cuts),
  };
}

/**
 * What {@link compileSurfaceShader} needs.
 *
 * @internal
 */
export interface SurfaceShaderCompileInput {
  /** The shader's name on the material; it prefixes every generated identifier. */
  readonly name: string;
  /** The asset address, for error messages. */
  readonly address: string;
  /** The whole `.surface.wgsl` file. */
  readonly source: string;
  /** What its pragmas declared. */
  readonly declaration: ShaderDeclaration;
  /** The host material family and what its template exposes. */
  readonly host: SurfaceHostCapabilities;
}

/**
 * A compiled surface shader: the Lite plugin, and the mapping from the names the author declared to
 * the prefixed fields the host material actually carries.
 *
 * @internal
 */
export interface CompiledSurfaceShader {
  /** The Lite plugin definition, whose bindings are named `<shader>_<declared>`. */
  readonly plugin: MaterialPluginDefinition;
  /** The prefix every generated identifier carries, including the trailing underscore. */
  readonly prefix: string;
  /** Which hooks the file provided. */
  readonly hooks: Readonly<Record<SurfaceHookName, boolean>>;
}

/**
 * Compiles a `.surface.wgsl` file into one Babylon Lite material plugin.
 *
 * @remarks
 * Deterministic and device-free, so it is fully testable in Node: the result is the plain
 * {@link MaterialPluginDefinition} the adapter turns into a Lite object.
 *
 * @param input - The shader, its declaration, and the host family.
 * @returns The plugin definition, with the generated WGSL in `code`, and its name prefix.
 * @throws IgnifxError with code `IGX-0723` when the file declares no hook, or a hook the host family
 * has no slot for, or a `displace` that reads a uniform or a texture; `IGX-0712` when a declared
 * name is not usable as a plugin binding; `IGX-0719` when a hook is malformed.
 *
 * @example
 * ```ts
 * const compiled = compileSurfaceShader({
 *   name: "snow",
 *   address: "shaders/snow.surface.wgsl",
 *   source,
 *   declaration,
 *   host: { family: "pbr", hasUv: true, hasNormal: true },
 * });
 * compiled.plugin.code.CUSTOM_FRAGMENT_UPDATE_ALPHA; // builds SurfaceInput and calls snow_surface
 * ```
 *
 * @internal
 */
export function compileSurfaceShader(input: SurfaceShaderCompileInput): CompiledSurfaceShader {
  const hooks = parseSurfaceHooks(input.source, input.address);
  const prefix = `${sanitizeIdentifier(input.name)}_`;
  const isStandard = input.host.family === "standard";
  if (isStandard && hooks.composite !== null) {
    throw new IgnifxError(
      CoreErrorCode.surfaceHookMissing,
      `${input.address} declares the composite hook, which a standard material has no slot for.`,
      {
        context: { asset: input.address, hook: "composite", family: input.host.family },
        hint: "Attach the surface shader to a pbr material, or move the effect into the surface hook.",
      },
    );
  }
  const rewrite = buildRewriter(prefix, input.declaration, isStandard);
  const code: Partial<Record<LiteMaterialPluginPoint, string>> = {};
  const definitions = buildDefinitions(prefix, hooks, rewrite);
  if (definitions !== "") {
    code.CUSTOM_FRAGMENT_DEFINITIONS = definitions;
  }
  if (hooks.surface !== null || hooks.composite !== null) {
    code.CUSTOM_FRAGMENT_UPDATE_ALPHA = buildUpdateAlpha(prefix, hooks, input.host);
    if (hooks.surface !== null && !isStandard) {
      code.CUSTOM_FRAGMENT_UPDATE_DIFFUSE = `if(any(${prefix}normal!=${prefix}in.geometricNormal)){N=normalize(${prefix}normal);}`;
    }
    if (!isStandard) {
      code.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION = buildComposite(prefix, hooks);
    }
  }
  if (hooks.displace !== null) {
    code.CUSTOM_VERTEX_UPDATE_WORLDPOS = buildDisplace(prefix, hooks.displace, input);
  }
  const plugin = defineMaterialPlugin({
    name: input.name,
    uniforms: input.declaration.uniforms.map((uniform) => ({ ...uniform, name: `${prefix}${uniform.name}` })),
    textures: input.declaration.textures.map((texture) => ({ ...texture, name: `${prefix}${texture.name}` })),
    code,
  });
  return {
    plugin,
    prefix,
    hooks: {
      displace: hooks.displace !== null,
      surface: hooks.surface !== null,
      composite: hooks.composite !== null,
    },
  };
}

/**
 * The fragment helper block: the generated structs and everything the file declared, hooks included,
 * with the two fragment hooks given generated signatures.
 *
 * @param prefix - The per-shader identifier prefix.
 * @param hooks - The parsed hooks.
 * @param rewrite - The identifier rewriter.
 * @returns The WGSL, or `""` when the file provides no fragment hook.
 */
function buildDefinitions(prefix: string, hooks: SurfaceShaderHooks, rewrite: (code: string) => string): string {
  if (hooks.surface === null && hooks.composite === null) {
    return "";
  }
  const parts: string[] = [
    `struct ${prefix}SurfaceInput{uv:vec2<f32>,worldPosition:vec3<f32>,geometricNormal:vec3<f32>,viewDirection:vec3<f32>,color:vec4<f32>,}`,
    `struct ${prefix}Surface{baseColor:vec3<f32>,alpha:f32,emissive:vec3<f32>,normal:vec3<f32>,roughness:f32,metallic:f32,}`,
    rewrite(hooks.rest),
  ];
  const surface = hooks.surface;
  if (surface !== null) {
    const input = surface.parameters[0] ?? "in";
    const state = surface.parameters[1] ?? "s";
    parts.push(
      `fn ${prefix}surface(${input}:${prefix}SurfaceInput,${state}:ptr<function,${prefix}Surface>){${rewrite(surface.body)}}`,
    );
  }
  const composite = hooks.composite;
  if (composite !== null) {
    const input = composite.parameters[0] ?? "in";
    const color = composite.parameters[1] ?? "color";
    parts.push(
      `fn ${prefix}composite(${input}:${prefix}SurfaceInput,${color}:vec3<f32>)->vec3<f32>{${rewrite(composite.body)}}`,
    );
  }
  return parts.join("\n");
}

/**
 * The `CUSTOM_FRAGMENT_UPDATE_ALPHA` block: build `SurfaceInput`, call the hook, write back what the
 * template lets us write back, and stash the rest for the later slots.
 *
 * @remarks
 * Deliberately **not** wrapped in braces: the variables it declares are read by the
 * `UPDATE_DIFFUSE` and `BEFORE_FINALCOLORCOMPOSITION` blocks, which Lite injects into the same
 * function scope further down. Every name is prefixed, so two surface shaders on one material
 * declare two sets rather than colliding.
 *
 * @param prefix - The per-shader identifier prefix.
 * @param hooks - The parsed hooks.
 * @param host - The host family and its capabilities.
 * @returns The WGSL statements.
 */
function buildUpdateAlpha(prefix: string, hooks: SurfaceShaderHooks, host: SurfaceHostCapabilities): string {
  const isStandard = host.family === "standard";
  const worldPosition = isStandard ? "input.vp" : "input.worldPos";
  const geometricNormal = isStandard ? "normalize(input.vn)" : "normalize(input.worldNormal)";
  const uv = host.hasUv ? (isStandard ? "input.vu" : "input.uv") : "vec2<f32>(0.0)";
  const emissive = isStandard ? "emissiveContrib" : "emissive";
  const lines: string[] = [
    `var ${prefix}in:${prefix}SurfaceInput;`,
    `${prefix}in.uv=${uv};`,
    `${prefix}in.worldPosition=${worldPosition};`,
    `${prefix}in.geometricNormal=${geometricNormal};`,
    `${prefix}in.viewDirection=normalize(scene.vEyePosition.xyz-${worldPosition});`,
    `${prefix}in.color=vec4<f32>(1.0);`,
    `var ${prefix}emissiveDelta=vec3<f32>(0.0);`,
    `var ${prefix}composited=false;`,
  ];
  if (hooks.surface !== null) {
    lines.push(
      `var ${prefix}s:${prefix}Surface;`,
      `${prefix}s.baseColor=baseColor;`,
      `${prefix}s.alpha=alpha;`,
      `${prefix}s.emissive=${emissive};`,
      `${prefix}s.normal=${prefix}in.geometricNormal;`,
      // Standard has no roughness or metallic at all; PBR has both, as read-only `let`s.
      isStandard ? `${prefix}s.roughness=1.0;` : `${prefix}s.roughness=roughness;`,
      isStandard ? `${prefix}s.metallic=0.0;` : `${prefix}s.metallic=metallic;`,
      `${prefix}surface(${prefix}in,&${prefix}s);`,
      `baseColor=${prefix}s.baseColor;`,
      `alpha=${prefix}s.alpha;`,
      `var ${prefix}normal=${prefix}s.normal;`,
    );
    if (isStandard) {
      // Standard's `/*AC*/` runs before `/*AT*/`, so the normal is written here, and its emissive
      // term is a `var` we can replace outright.
      lines.push(`${emissive}=${prefix}s.emissive;`);
      if (host.hasNormal) {
        lines.push(`if(any(${prefix}normal!=${prefix}in.geometricNormal)){normalW=normalize(${prefix}normal);}`);
      }
    } else {
      lines.push(`${prefix}emissiveDelta=${prefix}s.emissive-${emissive};`);
    }
  }
  return lines.join("\n");
}

/**
 * The `CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION` block: the emissive delta and the `composite`
 * hook, guarded because Lite injects this point twice.
 *
 * @param prefix - The per-shader identifier prefix.
 * @param hooks - The parsed hooks.
 * @returns The WGSL statements.
 */
function buildComposite(prefix: string, hooks: SurfaceShaderHooks): string {
  const inner: string[] = [`${prefix}composited=true;`, `color=color+${prefix}emissiveDelta;`];
  if (hooks.composite !== null) {
    inner.push(`color=${prefix}composite(${prefix}in,color);`);
  }
  return `if(!${prefix}composited){${inner.join("")}}`;
}

/**
 * The `CUSTOM_VERTEX_UPDATE_WORLDPOS` block: the `displace` body, inlined.
 *
 * @remarks
 * Inlined rather than called, because Lite gives a plugin no way to declare a function in the vertex
 * module (`buildPluginFragment` fills `_helperFunctions`, which the composer routes to the fragment
 * template alone). The body is wrapped in a `loop` whose `return` statements are rewritten to
 * `break`, which is what lets an author write ordinary early-returning WGSL: a value-returning
 * function has to return on every path, so the loop always terminates on its first iteration.
 *
 * @param prefix - The per-shader identifier prefix.
 * @param hook - The parsed `displace` hook.
 * @param input - The compile input, for the declaration and the error messages.
 * @returns The WGSL statements.
 * @throws IgnifxError with code `IGX-0723` when the body reads a uniform, a texture, or a member
 * that the vertex stage cannot supply.
 */
function buildDisplace(prefix: string, hook: SurfaceHook, input: SurfaceShaderCompileInput): string {
  assertVertexSafe(hook, input);
  const parameter = hook.parameters[0] ?? "in";
  const uv = input.host.hasUv ? "uv" : "vec2<f32>(0.0)";
  let body = hook.body;
  body = body.replaceAll(new RegExp(`\\b${escapeForRegExp(parameter)}\\s*\\.\\s*position\\b`, "g"), "position");
  body = body.replaceAll(new RegExp(`\\b${escapeForRegExp(parameter)}\\s*\\.\\s*normal\\b`, "g"), "normal");
  body = body.replaceAll(new RegExp(`\\b${escapeForRegExp(parameter)}\\s*\\.\\s*uv\\b`, "g"), uv);
  body = body.replaceAll(new RegExp(`\\b${escapeForRegExp(parameter)}\\s*\\.\\s*color\\b`, "g"), "vec4<f32>(1.0)");
  body = body.replaceAll(new RegExp(`\\b${escapeForRegExp(parameter)}\\s*\\.\\s*world\\b`, "g"), "finalWorld");
  body = body.replaceAll(RETURN_STATEMENT, (_whole: string, expression: string): string => {
    return `{${prefix}offset=${expression.trim()};break;}`;
  });
  return [
    `{var ${prefix}offset=vec3<f32>(0.0);`,
    `loop{${body}}`,
    `finalWorld[3].x+=${prefix}offset.x;`,
    `finalWorld[3].y+=${prefix}offset.y;`,
    `finalWorld[3].z+=${prefix}offset.z;}`,
  ].join("\n");
}

/**
 * Refuses a `displace` body the vertex stage cannot compile.
 *
 * @param hook - The parsed hook.
 * @param input - The compile input.
 * @throws IgnifxError with code `IGX-0723`.
 */
function assertVertexSafe(hook: SurfaceHook, input: SurfaceShaderCompileInput): void {
  const address = input.address;
  if (hook.body.includes(SURFACE_UNIFORM_BLOCK)) {
    throw new IgnifxError(
      CoreErrorCode.surfaceHookMissing,
      `${address}: the displace hook reads ${SURFACE_UNIFORM_BLOCK}, which Babylon Lite declares in the fragment stage only.`,
      {
        context: { asset: address, hook: "displace" },
        hint: "Displace by geometry alone on Lite 1.27.0; a time-driven offset needs a full shader material.",
      },
    );
  }
  for (const texture of input.declaration.textures) {
    if (new RegExp(`\\b${escapeForRegExp(texture.name)}\\b`).test(hook.body)) {
      throw new IgnifxError(
        CoreErrorCode.surfaceHookMissing,
        `${address}: the displace hook samples ${texture.name}, and Babylon Lite's plugin samplers are fragment-stage only.`,
        {
          context: { asset: address, hook: "displace", name: texture.name },
          hint: "Move the texture read into the surface hook, or use a full shader material.",
        },
      );
    }
  }
  if (BREAKING_CONSTRUCT.test(hook.body)) {
    throw new IgnifxError(
      CoreErrorCode.surfaceHookMissing,
      `${address}: the displace hook uses a loop or switch, which this build cannot inline into Babylon Lite's vertex entry point.`,
      {
        context: { asset: address, hook: "displace" },
        hint: "Write the displacement as straight-line code, or use a full shader material.",
      },
    );
  }
  for (const helper of fileFunctions(input.source)) {
    if (new RegExp(`\\b${escapeForRegExp(helper)}\\s*\\(`).test(hook.body)) {
      throw new IgnifxError(
        CoreErrorCode.surfaceHookMissing,
        `${address}: the displace hook calls ${helper}, and Babylon Lite gives a plugin no vertex-stage helper functions.`,
        {
          context: { asset: address, hook: "displace", name: helper },
          hint: "Inline the helper into the displace body, or use a full shader material.",
        },
      );
    }
  }
  const parameter = hook.parameters[0] ?? "in";
  const members = new RegExp(`\\b${escapeForRegExp(parameter)}\\s*\\.\\s*([A-Za-z_][A-Za-z0-9_]*)`, "g");
  let match = members.exec(hook.body);
  while (match !== null) {
    const member = match[1] ?? "";
    if (!DISPLACE_MEMBERS.includes(member)) {
      throw new IgnifxError(
        CoreErrorCode.surfaceHookMissing,
        `${address}: the displace hook reads ${parameter}.${member}, which DisplaceInput does not carry.`,
        {
          context: { asset: address, hook: "displace", name: member },
          hint: `DisplaceInput carries ${DISPLACE_MEMBERS.join(", ")}.`,
        },
      );
    }
    match = members.exec(hook.body);
  }
}

/**
 * The names of every function a file declares that is not one of the three hooks.
 *
 * @param source - The whole `.surface.wgsl` file.
 * @returns The helper names, in declaration order.
 */
function fileFunctions(source: string): readonly string[] {
  const names: string[] = [];
  FUNCTION_START.lastIndex = 0;
  let match = FUNCTION_START.exec(source);
  while (match !== null) {
    const name = match[1] ?? "";
    if (!(SURFACE_HOOK_NAMES as readonly string[]).includes(name)) {
      names.push(name);
    }
    match = FUNCTION_START.exec(source);
  }
  return names;
}

/**
 * Builds the function that rewrites the author's references to the names the host material actually
 * declares.
 *
 * @param prefix - The per-shader identifier prefix.
 * @param declaration - What the file declared, for its texture names.
 * @param isStandard - Whether the host is a Standard material, which reads its plugin uniforms from
 * `pluginUbo` rather than from the PBR material block (`plugin-bridge-shared.js` 99).
 * @returns The rewriter.
 */
function buildRewriter(prefix: string, declaration: ShaderDeclaration, isStandard: boolean): (code: string) => string {
  const block = isStandard ? "pluginUbo" : "material";
  const samplers: string[] = [];
  for (const texture of declaration.textures) {
    samplers.push(`${texture.name}Sampler`, texture.name);
  }
  // Longest first, so `noiseSampler` is not rewritten as the prefix of `noise` plus `Sampler`.
  samplers.sort((left, right) => right.length - left.length);
  const pattern = samplers.length === 0 ? null : new RegExp(`\\b(${samplers.map(escapeForRegExp).join("|")})\\b`, "g");
  return (code: string): string => {
    const withUniforms = code.replaceAll(UNIFORM_REFERENCE, (_whole: string, name: string): string => {
      return `${block}.${prefix}${name}`;
    });
    return pattern === null
      ? withUniforms
      : withUniforms.replaceAll(pattern, (_whole: string, name: string): string => `${prefix}${name}`);
  };
}

/**
 * The index of the delimiter that closes the one at `open`.
 *
 * @param source - The text.
 * @param open - The index of the opening delimiter.
 * @param openChar - The opening delimiter.
 * @param closeChar - The closing delimiter.
 * @returns The closing index, or `-1` when it never closes.
 */
function matchDelimiter(source: string, open: number, openChar: string, closeChar: string): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * The parameter identifiers of a WGSL parameter list.
 *
 * @param list - The text between the parentheses.
 * @returns The names, in order.
 */
function parseParameterNames(list: string): readonly string[] {
  const names: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= list.length; index += 1) {
    const char = list[index];
    if (char === "<" || char === "(") {
      depth += 1;
    } else if (char === ">" || char === ")") {
      depth -= 1;
    } else if ((char === "," && depth === 0) || index === list.length) {
      const parameter = list.slice(start, index).trim();
      const colon = parameter.indexOf(":");
      const name = (colon < 0 ? parameter : parameter.slice(0, colon)).trim();
      if (name !== "") {
        names.push(name);
      }
      start = index + 1;
    }
  }
  return names;
}

/**
 * The text with the given ranges removed.
 *
 * @param source - The text.
 * @param ranges - The ranges to cut, in ascending order.
 * @returns What is left.
 */
function cutRanges(source: string, ranges: readonly { start: number; end: number }[]): string {
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    result += source.slice(cursor, range.start);
    cursor = range.end;
  }
  return result + source.slice(cursor);
}

/**
 * Whether a captured name is one of the three hooks.
 *
 * @param value - The candidate.
 * @returns `true` when it is.
 */
function isSurfaceHookName(value: string | undefined): value is SurfaceHookName {
  return value === "displace" || value === "surface" || value === "composite";
}

/**
 * Turns a shader name into a WGSL identifier prefix.
 *
 * @param name - The shader's name on the material.
 * @returns The sanitized name; a leading digit is prefixed with an underscore.
 *
 * @internal
 */
export function sanitizeIdentifier(name: string): string {
  const replaced = name.replaceAll(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(replaced) ? `_${replaced}` : replaced;
}

/**
 * Escapes a literal for use inside a regular expression.
 *
 * @param value - The literal.
 * @returns The escaped form.
 */
function escapeForRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
