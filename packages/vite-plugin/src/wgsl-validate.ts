/**
 * Build-time validation of the `.wgsl` shader assets under the asset root
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1, coding standards §14: "shader source comes
 * from assets validated at build time").
 *
 * The plugin has no dependency on `@ignifx/core` (`docs/architecture/00-overview.md` §2), so every
 * check here is self-contained: `wgsl_reflect` supplies the parse and the reflection, and the
 * `// @ignifx …` pragma lines a shader declares its uniforms with are read by a reader that knows
 * only the four pragmas these rules need. The full pragma grammar — defaults, ranges, editor hints,
 * blend and pipeline state — belongs to `@ignifx/core`, which is what actually builds the material;
 * anything this file does not recognise is left alone rather than rejected.
 *
 * What these rules add over the browser's own WGSL compiler is a file and a line. The browser
 * compiles what Lite generated — the shader's source with a scene UBO, `shaderSystem`,
 * `shaderUniforms`, a sampler pair per texture and a `VertexInput` struct in front of it — so its
 * diagnostics carry line numbers that exist in nothing the author wrote.
 */

import { readFile } from "node:fs/promises";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { VitePluginErrorCode } from "./errors.js";
import type { ScannedAsset } from "./manifest.js";
import type { ValidationProblem } from "./validate.js";
import type { FunctionInfo } from "wgsl_reflect/wgsl_reflect.module.js";

/**
 * The file extension that marks a shader asset. Both `*.surface.wgsl` and `*.post.wgsl` end in it;
 * the pragma inside the file, not its name, decides which of the three forms it is.
 *
 * @public
 */
export const WGSL_EXTENSION = ".wgsl";

/**
 * The three forms a `.wgsl` file can declare with its `// @ignifx shader|surface|post` line
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1–§3.3).
 *
 * @public
 */
export type WgslShaderKind = "post" | "shader" | "surface";

/** The three kinds, as a lookup for the pragma reader. */
const SHADER_KINDS: readonly WgslShaderKind[] = ["shader", "surface", "post"];

/**
 * The system uniforms Babylon Lite 1.27.0 generates into `shaderSystem`
 * (`@babylonjs/lite`'s `index.d.ts` line 11445). There is no `time` and there are no lights: those
 * are ignifx's, and they arrive through {@link IGNIFX_SYSTEM_UNIFORMS} instead.
 *
 * @public
 */
export const LITE_SYSTEM_UNIFORMS: readonly string[] = [
  "world",
  "view",
  "projection",
  "viewProjection",
  "worldView",
  "worldViewProjection",
  "cameraPosition",
  "screenSize",
  "alphaCutoff",
];

/**
 * The uniforms ignifx supplies on top of Lite's, uploaded once per frame per material that declares
 * them (`docs/plan/2026-09-terrain-particles-shaders.md` §3.1). They live beside a shader's own
 * custom uniforms, so a shader reads them as `shaderUniforms.time`, not `shaderSystem.time`.
 *
 * @public
 */
export const IGNIFX_SYSTEM_UNIFORMS: readonly string[] = [
  "time",
  "unscaledTime",
  "deltaTime",
  "mainLightDirection",
  "mainLightColor",
  "ambientColor",
];

/** The texture a `post` file samples the chain's current colour from; ignifx binds it. */
const POST_INPUT_TEXTURE = "inputTexture";

/**
 * The uniforms every post effect's generated `shaderUniforms` block carries before the file's own
 * (`packages/core/src/render/post-effect.ts`, `POST_EFFECT_BUILTIN_UNIFORMS`). A post effect has no
 * `shaderSystem` block at all, so `screenSize` is read from `shaderUniforms` there and from
 * `shaderSystem` in a `shader` file. Module-local: it is a fact about the generated module, not part
 * of this plugin's API.
 */
const POST_BUILTIN_UNIFORMS: readonly string[] = ["screenSize", "time", "unscaledTime", "deltaTime"];

/** The entry point Lite calls for the vertex stage of a full shader material. */
const VERTEX_ENTRY = "mainVertex";

/** The entry point Lite calls for the fragment stage of a full shader material or a post effect. */
const FRAGMENT_ENTRY = "mainFragment";

/** The vertex-stage hook of a surface shader, which runs inside Lite's PBR/Standard template. */
const DISPLACE_HOOK = "displace";

/** The hooks a surface shader may implement; it must implement at least one. */
const SURFACE_HOOKS: readonly string[] = [DISPLACE_HOOK, "surface", "composite"];

/** `// @ignifx <directive> <rest>` on a line of its own, which is how a declaration is written. */
const PRAGMA_LINE = /^\s*\/\/\s*@ignifx\s+(\S+)\s*(.*)$/u;

/** A `name:` at the head of a pragma's arguments — how `uniform` and `storage` name themselves. */
const TYPED_NAME = /^([A-Za-z_]\w*)\s*:/u;

/** A bare `name` at the head of a pragma's arguments — how `texture` names itself. */
const BARE_NAME = /^([A-Za-z_]\w*)/u;

/**
 * Matches `shaderUniforms.x`, `shaderSystem.x` or `surfaceUniforms.x`, whichever is asked for.
 *
 * @param structName - The generated struct's name.
 * @returns A global pattern whose first group is the member name.
 */
function structMemberPattern(structName: string): RegExp {
  return new RegExp(String.raw`\b${structName}\s*\.\s*([A-Za-z_]\w*)`, "gu");
}

/**
 * A texture built-in whose first argument is a plain identifier. The trailing `[,)]` is what keeps
 * the match to a bare name: `textureSample(t.x, …)` or `textureSample(pick(a), …)` do not match, and
 * a name this pattern cannot read is left unchecked rather than guessed at.
 */
const TEXTURE_BUILTIN_CALL = /\b(?:textureSample\w*|textureLoad|textureDimensions)\s*\(\s*([A-Za-z_]\w*)\s*[,)]/gu;

/** `textureSample(` exactly — the one texture built-in WGSL forbids outside the fragment stage. */
const TEXTURE_SAMPLE_CALL = /\btextureSample\s*\(/u;

/** Any texture built-in, for the surface `displace` hook, where Lite binds no sampler at all. */
const ANY_TEXTURE_BUILTIN = /\b(?:textureSample\w*|textureLoad|textureDimensions)\s*\(/u;

/**
 * Matches the global `var` declaration of a name, which is how a hand-declared binding is written.
 *
 * @param name - The variable's name.
 * @returns A pattern that matches the declaration's line.
 */
function variableDeclarationPattern(name: string): RegExp {
  return new RegExp(String.raw`\bvar\b[^;]*\b${name}\b`, "u");
}

/** `Line: 12` or `Line 12`, which is how `wgsl_reflect`'s parser puts a position in its message. */
const PARSER_ERROR_LINE = /\bLine:?\s*(\d+)/u;

/**
 * One shader problem, addressed by line.
 *
 * @public
 */
export interface WgslProblem {
  /** The 1-based line the problem is on; `1` when the rule is about the file as a whole. */
  readonly line: number;
  /** What is wrong, in one sentence, with the fix where there is one. */
  readonly message: string;
  /** The diagnostic code: `IGX-0654` for a parse failure, `IGX-0655` for a contract violation. */
  readonly code: VitePluginErrorCode;
}

/** What the pragma reader found, which is the declaration half of the contract. */
interface Declarations {
  /** The kinds declared, with their lines; exactly one is legal. */
  readonly kinds: readonly { readonly kind: WgslShaderKind; readonly line: number }[];
  /** Names from `// @ignifx uniform NAME: …`. */
  readonly uniforms: ReadonlySet<string>;
  /** Names from `// @ignifx texture NAME …`. */
  readonly textures: ReadonlySet<string>;
  /** Names from `// @ignifx storage NAME: …`. */
  readonly storage: ReadonlySet<string>;
  /** Names from `// @ignifx system a, b, …`. */
  readonly systems: ReadonlySet<string>;
}

/**
 * Blanks out every comment while keeping the source's shape.
 *
 * @remarks
 * Comments are replaced character for character with spaces and newlines are kept, so a line number
 * taken from the result is the line number in the file. WGSL has no string literals, so there is no
 * context in which `//` means anything but a comment.
 *
 * @param source - The shader source.
 * @returns The same text with comment bodies replaced by spaces.
 */
function stripComments(source: string): string {
  const out = source.split("");
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      while (index < source.length && source[index] !== "\n") {
        out[index] = " ";
        index += 1;
      }
      continue;
    }
    if (source.startsWith("/*", index)) {
      // WGSL block comments nest, so the depth is counted rather than the first `*/` taken.
      let depth = 0;
      while (index < source.length) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          out[index] = " ";
          out[index + 1] = " ";
          index += 2;
          continue;
        }
        if (source.startsWith("*/", index)) {
          depth -= 1;
          out[index] = " ";
          out[index + 1] = " ";
          index += 2;
          if (depth === 0) {
            break;
          }
          continue;
        }
        if (source[index] !== "\n") {
          out[index] = " ";
        }
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * Reads the pragma declarations a shader file carries.
 *
 * @param source - The shader source, comments intact — the pragmas *are* comments.
 * @returns The declared kind lines and names.
 */
function readDeclarations(source: string): Declarations {
  const kinds: { kind: WgslShaderKind; line: number }[] = [];
  const uniforms = new Set<string>();
  const textures = new Set<string>();
  const storage = new Set<string>();
  const systems = new Set<string>();

  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = PRAGMA_LINE.exec(lines[index] ?? "");
    if (match === null) {
      continue;
    }
    const directive = match[1] ?? "";
    const rest = (match[2] ?? "").trim();
    const kind = SHADER_KINDS.find((candidate) => candidate === directive);
    if (kind !== undefined) {
      kinds.push({ kind, line: index + 1 });
      continue;
    }
    if (directive === "uniform") {
      const name = TYPED_NAME.exec(rest)?.[1];
      if (name !== undefined) {
        uniforms.add(name);
      }
      continue;
    }
    if (directive === "storage") {
      const name = TYPED_NAME.exec(rest)?.[1];
      if (name !== undefined) {
        storage.add(name);
      }
      continue;
    }
    if (directive === "texture") {
      const name = BARE_NAME.exec(rest)?.[1];
      if (name !== undefined) {
        textures.add(name);
      }
      continue;
    }
    if (directive === "system") {
      for (const name of rest.split(",")) {
        const trimmed = name.trim();
        if (trimmed !== "") {
          systems.add(trimmed);
        }
      }
    }
  }

  return { kinds, uniforms, textures, storage, systems };
}

/**
 * Splits a `wgsl_reflect` parse failure into a line and a message.
 *
 * @remarks
 * The parser appends its position to the message (`"Expected ';'.. Line: 12"`), so the number is
 * lifted out and the duplicated sentence terminator trimmed rather than shown to the reader twice.
 *
 * @param error - The caught value.
 * @returns The line, `1` when the message carries none, and the message without its position.
 */
function readParserError(error: unknown): { readonly line: number; readonly message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("call stack")) {
    // `wgsl_reflect` resolves the call graph recursively, so a function that calls itself exhausts
    // the stack instead of producing a message. WGSL forbids recursion outright, so the file is
    // invalid either way — but the raw message would send the reader looking in the wrong place.
    return {
      line: 1,
      message:
        "the parser ran out of stack, which happens on a recursive call; WGSL forbids recursion, so " +
        "check for a function that calls itself, directly or through another",
    };
  }
  const match = PARSER_ERROR_LINE.exec(raw);
  if (match === null) {
    return { line: 1, message: raw.trim() };
  }
  const message = raw.slice(0, match.index).replace(/[.\s]+$/u, "");
  // The capture group is `\d+`, so a plain coercion is exact.
  const line = Number(match[1] ?? "1");
  return { line: Number.isFinite(line) && line > 0 ? line : 1, message: message === "" ? raw.trim() : message };
}

/**
 * Finds the line a global variable is declared on.
 *
 * @param lines - The comment-stripped source, split by line.
 * @param name - The variable's name.
 * @returns The 1-based line, or `1` when no `var` line mentions the name.
 */
function declarationLine(lines: readonly string[], name: string): number {
  const pattern = variableDeclarationPattern(name);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index] ?? "")) {
      return index + 1;
    }
  }
  return 1;
}

/**
 * Expands a set of functions to everything they call, transitively.
 *
 * @remarks
 * `wgsl_reflect`'s AST holds cyclic parent references, so a naive recursive walk over its nodes
 * overflows the stack; `FunctionInfo.calls` is the typed edge list, and the visited set makes the
 * traversal terminate whatever the graph looks like.
 *
 * @param roots - The functions to start from.
 * @returns Every function reachable from a root, the roots included.
 */
function reachableFunctions(roots: readonly FunctionInfo[]): readonly FunctionInfo[] {
  const seen = new Set<FunctionInfo>();
  const pending = [...roots];
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined || seen.has(next)) {
      continue;
    }
    seen.add(next);
    for (const callee of next.calls) {
      if (!seen.has(callee)) {
        pending.push(callee);
      }
    }
  }
  return [...seen];
}

/**
 * Finds the first line inside a function's body that matches a pattern.
 *
 * @param lines - The comment-stripped source, split by line.
 * @param fn - The function, whose `startLine`/`endLine` are 1-based and inclusive.
 * @param pattern - What to look for.
 * @returns The 1-based line, or `null` when the body does not match.
 */
function lineInFunction(lines: readonly string[], fn: FunctionInfo, pattern: RegExp): number | null {
  const first = Math.max(1, fn.startLine);
  const last = Math.min(lines.length, fn.endLine);
  for (let line = first; line <= last; line += 1) {
    if (pattern.test(lines[line - 1] ?? "")) {
      return line;
    }
  }
  return null;
}

/**
 * Reports every use of a generated struct's members that the file never declared.
 *
 * @param lines - The comment-stripped source, split by line.
 * @param structName - The generated struct being read (`shaderUniforms`, `shaderSystem`, …).
 * @param allowed - The member names that are legal.
 * @param explain - Renders the message for one unknown member name.
 * @returns One problem per unknown member, in file order.
 */
function checkStructMembers(
  lines: readonly string[],
  structName: string,
  allowed: ReadonlySet<string>,
  explain: (member: string) => string,
): readonly WgslProblem[] {
  const problems: WgslProblem[] = [];
  const pattern = structMemberPattern(structName);
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0;
    let match = pattern.exec(lines[index] ?? "");
    while (match !== null) {
      const member = match[1] ?? "";
      if (!allowed.has(member)) {
        problems.push({
          line: index + 1,
          message: explain(member),
          code: VitePluginErrorCode.wgslContractViolation,
        });
      }
      match = pattern.exec(lines[index] ?? "");
    }
  }
  return problems;
}

/**
 * Reports every texture built-in whose first argument names a texture the file never declared.
 *
 * @param lines - The comment-stripped source, split by line.
 * @param declared - The declared texture names, plus whatever ignifx binds for this kind.
 * @returns One problem per undeclared texture name, in file order.
 */
function checkTextureNames(lines: readonly string[], declared: ReadonlySet<string>): readonly WgslProblem[] {
  const problems: WgslProblem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    TEXTURE_BUILTIN_CALL.lastIndex = 0;
    let match = TEXTURE_BUILTIN_CALL.exec(lines[index] ?? "");
    while (match !== null) {
      const name = match[1] ?? "";
      if (!declared.has(name)) {
        problems.push({
          line: index + 1,
          message:
            `samples "${name}", which is not a declared texture; add ` +
            `"// @ignifx texture ${name}" (its sampler is then "${name}Sampler")`,
          code: VitePluginErrorCode.wgslContractViolation,
        });
      }
      match = TEXTURE_BUILTIN_CALL.exec(lines[index] ?? "");
    }
  }
  return problems;
}

/**
 * Reports the entry points the declared kind needs and the file does not have.
 *
 * @param reflect - The parsed shader.
 * @param kind - The declared kind.
 * @param kindLine - The line the kind pragma is on, where a missing entry point is reported.
 * @returns One problem per missing entry point.
 */
function checkEntryPoints(reflect: WgslReflect, kind: WgslShaderKind, kindLine: number): readonly WgslProblem[] {
  const problems: WgslProblem[] = [];
  const missing = (message: string): void => {
    problems.push({ line: kindLine, message, code: VitePluginErrorCode.wgslContractViolation });
  };

  if (kind === "shader") {
    if (!reflect.entry.vertex.some((fn) => fn.name === VERTEX_ENTRY)) {
      missing(`declares "shader" but has no "@vertex fn ${VERTEX_ENTRY}"; Lite calls that entry point by name`);
    }
    if (!reflect.entry.fragment.some((fn) => fn.name === FRAGMENT_ENTRY)) {
      missing(`declares "shader" but has no "@fragment fn ${FRAGMENT_ENTRY}"; Lite calls that entry point by name`);
    }
    return problems;
  }
  if (kind === "post") {
    // A **plain** function, not an entry point: Lite's fullscreen path hard-codes the entry-point
    // name `effectFragment`, so `@ignifx/core` generates that entry point and makes it forward to
    // the file's `mainFragment` (`packages/core/src/render/post-effect.ts`). WGSL forbids calling
    // an entry point, so a `@fragment fn mainFragment` here would compile in the browser only to be
    // rejected as soon as the generated module wraps it.
    if (!reflect.functions.some((fn) => fn.stage === null && fn.name === FRAGMENT_ENTRY)) {
      missing(
        `declares "post" but has no "fn ${FRAGMENT_ENTRY}(in: PostInput) -> vec4<f32>"; ` +
          "ignifx generates the @fragment entry point and forwards to that function",
      );
    }
    return problems;
  }
  const hooks = reflect.functions.filter((fn) => fn.stage === null && SURFACE_HOOKS.includes(fn.name));
  if (hooks.length === 0) {
    missing(
      `declares "surface" but implements none of ${SURFACE_HOOKS.map((hook) => `"${hook}"`).join(", ")}; ` +
        "a surface shader is one or more of those three hooks",
    );
  }
  return problems;
}

/**
 * Reports every binding the file declares by hand.
 *
 * @remarks
 * Lite generates the whole bind-group layout for a shader material — the scene UBO at
 * `@group(0)`, `shaderSystem`/`shaderUniforms` and every sampler and storage buffer at
 * `@group(1)` — from the declaration, so a `var<uniform>` or a `var texture_2d<f32>` in the source
 * either collides with a generated binding or lands in a group nothing binds.
 *
 * @param reflect - The parsed shader.
 * @param lines - The comment-stripped source, split by line.
 * @param declarations - What the pragmas declared, so a name declared twice says so.
 * @returns One problem per declared resource, in file order.
 */
function checkHandDeclaredBindings(
  reflect: WgslReflect,
  lines: readonly string[],
  declarations: Declarations,
): readonly WgslProblem[] {
  const resources = [
    ...reflect.uniforms,
    ...reflect.storage,
    ...reflect.textures,
    ...reflect.samplers,
    ...reflect.immediates,
  ];
  const declared = new Set([...declarations.uniforms, ...declarations.textures, ...declarations.storage]);
  return resources.map((resource) => ({
    line: declarationLine(lines, resource.name),
    message:
      `declares the binding "${resource.name}" at @group(${String(resource.group)}) ` +
      `@binding(${String(resource.binding)}) by hand; ${
        declared.has(resource.name)
          ? 'the "// @ignifx" pragma above already declares it and ignifx generates the binding, so delete ' +
            "this line"
          : "ignifx and Lite generate every binding from the " +
            '"// @ignifx uniform|texture|storage" declarations, so remove it and declare it as a pragma'
      }`,
    code: VitePluginErrorCode.wgslContractViolation,
  }));
}

/**
 * Reports texture sampling that reaches a stage where it cannot run.
 *
 * @remarks
 * WGSL allows `textureSample` only in the fragment stage (gpuweb #4814); vertex code has to use
 * `textureSampleLevel` or `textureLoad`. The browser rejects it too, but names no file — and in a
 * surface shader the vertex hook is worse off still, because Lite binds plugin samplers with
 * `STAGE_FRAGMENT` visibility only (`lib/material/plugin/plugin-bridge-shared.js`), so *no* texture
 * built-in works there.
 *
 * @param reflect - The parsed shader.
 * @param lines - The comment-stripped source, split by line.
 * @param kind - The declared kind, or `null` when the file declared none.
 * @returns One problem per offending function.
 */
function checkVertexStageSampling(
  reflect: WgslReflect,
  lines: readonly string[],
  kind: WgslShaderKind | null,
): readonly WgslProblem[] {
  const problems: WgslProblem[] = [];
  for (const fn of reachableFunctions(reflect.entry.vertex)) {
    const line = lineInFunction(lines, fn, TEXTURE_SAMPLE_CALL);
    if (line !== null) {
      problems.push({
        line,
        message:
          `calls textureSample in "${fn.name}", which the vertex stage reaches; ` +
          "WGSL allows textureSample in the fragment stage only — use textureSampleLevel or textureLoad",
        code: VitePluginErrorCode.wgslContractViolation,
      });
    }
  }
  if (kind === "surface") {
    const displace = reflect.functions.filter((fn) => fn.name === DISPLACE_HOOK && fn.stage === null);
    for (const fn of reachableFunctions(displace)) {
      const line = lineInFunction(lines, fn, ANY_TEXTURE_BUILTIN);
      if (line !== null) {
        problems.push({
          line,
          message:
            `reads a texture in "${fn.name}", which the "displace" hook reaches; Lite binds a plugin's ` +
            'samplers to the fragment stage only, so sample in "surface" or "composite" instead',
          code: VitePluginErrorCode.wgslContractViolation,
        });
      }
    }
  }
  return problems;
}

/**
 * Validates one shader source against the ignifx WGSL contract.
 *
 * @remarks
 * The rules, each reported with the line it is on: the file parses; it declares exactly one
 * `// @ignifx shader|surface|post`; every `shaderUniforms`/`shaderSystem`/`surfaceUniforms` member
 * and every sampled texture is declared; the declared kind's entry points exist; no binding is
 * declared by hand; and no vertex-stage code samples a texture. Full type checking stays with the
 * browser's WGSL compiler.
 *
 * @param source - The shader source.
 * @returns Every problem found, ordered by line; a parse failure is returned on its own, because
 * every other rule reads the parse.
 *
 * @example
 * ```ts
 * validateWgslSource("// @ignifx shader\n@vertex fn mainVertex() {}\n");
 * // [{ line: 1, message: 'declares "shader" but has no "@fragment fn mainFragment"…', code: "IGX-0655" }]
 * ```
 *
 * @public
 */
export function validateWgslSource(source: string): readonly WgslProblem[] {
  let reflect: WgslReflect;
  try {
    reflect = new WgslReflect(source);
  } catch (error) {
    const { line, message } = readParserError(error);
    return [{ line, message: `is not valid WGSL (${message})`, code: VitePluginErrorCode.wgslSyntaxError }];
  }

  const problems: WgslProblem[] = [];
  const declarations = readDeclarations(source);
  const lines = stripComments(source).split("\n");

  const [first, second] = declarations.kinds;
  if (first === undefined) {
    problems.push({
      line: 1,
      message: 'declares no form; add exactly one "// @ignifx shader", "// @ignifx surface" or "// @ignifx post" line',
      code: VitePluginErrorCode.wgslContractViolation,
    });
  } else if (second !== undefined) {
    problems.push({
      line: second.line,
      message: `declares "${second.kind}" as well as "${first.kind}" on line ${String(first.line)}; a shader file is exactly one form`,
      code: VitePluginErrorCode.wgslContractViolation,
    });
  }
  const kind = first?.kind ?? null;
  const kindLine = first?.line ?? 1;

  if (kind === "shader") {
    // A `shader` file's `shaderUniforms`/`shaderSystem` blocks are generated from the declaration
    // alone (`packages/core/src/render/shader-material.ts`, `toShaderMaterialOptions`), so an
    // engine uniform the file reads but never lists on an `// @ignifx system` line is simply not a
    // member of the generated struct.
    const ignifxNames = IGNIFX_SYSTEM_UNIFORMS.filter((name) => declarations.systems.has(name));
    const liteNames = LITE_SYSTEM_UNIFORMS.filter((name) => declarations.systems.has(name));
    problems.push(
      ...checkStructMembers(lines, "shaderUniforms", new Set([...declarations.uniforms, ...ignifxNames]), (member) =>
        IGNIFX_SYSTEM_UNIFORMS.includes(member)
          ? `reads shaderUniforms.${member}, which the file does not declare; add "// @ignifx system ${member}"`
          : `reads shaderUniforms.${member}, which is not declared; add "// @ignifx uniform ${member}: <type> = <default>"` +
            ` or, for an engine-supplied value, "// @ignifx system <name>" with one of ${IGNIFX_SYSTEM_UNIFORMS.join(", ")}`,
      ),
      ...checkStructMembers(lines, "shaderSystem", new Set(liteNames), (member) =>
        LITE_SYSTEM_UNIFORMS.includes(member)
          ? `reads shaderSystem.${member}, which the file does not declare; add "// @ignifx system ${member}"`
          : `reads shaderSystem.${member}, which Babylon Lite does not supply; its system uniforms are ` +
            `${LITE_SYSTEM_UNIFORMS.join(", ")} — ignifx's own (${IGNIFX_SYSTEM_UNIFORMS.join(", ")}) are read from shaderUniforms`,
      ),
    );
  }
  if (kind === "post") {
    // A post effect's bindings are the post-process stack's, not a shader material's: ignifx
    // generates one `shaderUniforms` block carrying {@link POST_BUILTIN_UNIFORMS} followed by the
    // file's own declarations, and no `shaderSystem` block at all
    // (`packages/core/src/render/post-effect.ts`, `buildFragmentModule`).
    problems.push(
      ...checkStructMembers(
        lines,
        "shaderUniforms",
        new Set([...declarations.uniforms, ...POST_BUILTIN_UNIFORMS]),
        (member) =>
          `reads shaderUniforms.${member}, which is not declared; add ` +
          `"// @ignifx uniform ${member}: <type> = <default>" — a post effect's built-in uniforms are ` +
          POST_BUILTIN_UNIFORMS.join(", "),
      ),
      ...checkStructMembers(
        lines,
        "shaderSystem",
        new Set<string>(),
        (member) =>
          `reads shaderSystem.${member}, which a post effect has no such block for; its built-in ` +
          `uniforms (${POST_BUILTIN_UNIFORMS.join(", ")}) are read from shaderUniforms`,
      ),
    );
  }
  if (kind === "surface") {
    problems.push(
      ...checkStructMembers(
        lines,
        "surfaceUniforms",
        declarations.uniforms,
        (member) =>
          `reads surfaceUniforms.${member}, which is not declared; add ` +
          `"// @ignifx uniform ${member}: <type> = <default>"`,
      ),
    );
  }
  if (kind !== null) {
    const textures = new Set(declarations.textures);
    if (kind === "post") {
      textures.add(POST_INPUT_TEXTURE);
    }
    problems.push(...checkTextureNames(lines, textures), ...checkEntryPoints(reflect, kind, kindLine));
  }

  problems.push(
    ...checkHandDeclaredBindings(reflect, lines, declarations),
    ...checkVertexStageSampling(reflect, lines, kind),
  );
  // `toSorted` is stable, so two rules that fire on one line keep the order the rules ran in.
  return problems.toSorted((left, right) => left.line - right.line);
}

/**
 * Validates one `.wgsl` file that lives under the asset root.
 *
 * @param address - The asset address, used in messages.
 * @param filePath - The absolute path of the file.
 * @param source - The file's contents.
 * @returns Every problem found, in the shared shape the plugin reports JSON failures in. The line
 * heads the message, because a WGSL file has no JSON pointer to address a problem with.
 *
 * @example
 * ```ts
 * const problems = validateWgslAsset("shaders/x.wgsl", "/p/assets/shaders/x.wgsl", "// @ignifx shader\n");
 * // [{ address: "shaders/x.wgsl", pointer: "", message: 'line 1: declares "shader" but has no …' }]
 * ```
 *
 * @public
 */
export function validateWgslAsset(address: string, filePath: string, source: string): readonly ValidationProblem[] {
  return validateWgslSource(source).map((problem) => ({
    address,
    filePath,
    pointer: "",
    message: `line ${String(problem.line)}: ${problem.message}`,
    code: problem.code,
  }));
}

/**
 * Validates every `.wgsl` asset in a scan.
 *
 * @param assets - The scanned assets to check; anything that is not a `.wgsl` file is skipped.
 * @returns Every problem found, ordered by address (the order `scanAssetRoot` returns) and, within
 * one file, by line.
 *
 * @public
 */
export async function validateWgslAssets(assets: readonly ScannedAsset[]): Promise<readonly ValidationProblem[]> {
  const shaders = assets.filter((asset) => asset.address.toLowerCase().endsWith(WGSL_EXTENSION));
  const sources = await Promise.all(shaders.map((asset) => readFile(asset.filePath, "utf8")));
  return shaders.flatMap((asset, index) => validateWgslAsset(asset.address, asset.filePath, sources[index] ?? ""));
}
