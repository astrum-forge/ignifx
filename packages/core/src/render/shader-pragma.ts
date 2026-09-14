import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import {
  IGNIFX_UNIFORM_NAMES,
  LITE_SYSTEM_UNIFORM_NAMES,
  SHADER_ATTRIBUTE_NAMES,
  SHADER_BLEND_MODES,
  SHADER_CULL_MODES,
  SHADER_INSTANCING_MODES,
  SHADER_TEXTURE_FALLBACKS,
  SHADER_UNIFORM_TYPES,
} from "./shader-declaration.js";
import type {
  IgnifxUniformName,
  LiteSystemUniformName,
  ShaderAttributeName,
  ShaderBlendMode,
  ShaderCullMode,
  ShaderDeclaration,
  ShaderDefineDeclaration,
  ShaderInstancingMode,
  ShaderKind,
  ShaderStorageDeclaration,
  ShaderTextureDeclaration,
  ShaderTextureFallback,
  ShaderUniformDeclaration,
  ShaderUniformType,
} from "./shader-declaration.js";

/**
 * Reads the `// @ignifx …` comment pragmas of a `.wgsl` file into a {@link ShaderDeclaration}
 * (grammar: `docs/plan/2026-09-terrain-particles-shaders.md` §3.1; rationale: ADR-0024).
 *
 * Pure string work with no Babylon Lite import, so the build-time validator and the runtime loader
 * can share it. Four rules the grammar itself does not show:
 *
 * - `@ignifx system` mixes Lite's names with ignifx's, and the WGSL reads them from different
 *   structs, so they are split into `declaration.system` and `declaration.ignifx`.
 * - An omitted `attributes` directive means `position`; Lite refuses a shader material without it
 *   (`lib/material/shader/shader-material.js`, error 293).
 * - A `color(…)` default keeps the authored sRGB numbers; `./shader-material.ts` converts.
 * - `cull front` and `transmissive` on an opaque surface are refused here, with a line number,
 *   because Lite has no front-face culling and throws on the second combination (error 295).
 */

/** Matches an `// @ignifx …` line and captures the directive text after it. */
const PRAGMA_LINE = /^\s*\/\/\s*@ignifx\b(.*)$/;

/** Matches a WGSL identifier. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Splits `name: type` at the colon, capturing the identifier and the rest of the line. */
const NAME_AND_TYPE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/;

/** Matches a leading `tooltip("…")` modifier, capturing the quoted text. */
const TOOLTIP_MODIFIER = /^tooltip\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*/;

/** Matches a leading `range(…)`, `step(…)`, or `color(…)`/`color` modifier. */
const CALL_MODIFIER = /^(range|step|color)\s*(?:\(([^)]*)\))?\s*/;

/** Matches a leading `color(…)` default value, capturing the arguments. */
const COLOR_DEFAULT = /^color\s*\(([^)]*)\)\s*/;

/** Matches a leading parenthesised numeric list, capturing the arguments. */
const TUPLE_DEFAULT = /^\(([^)]*)\)\s*/;

/** Matches a leading decimal number, with optional sign and exponent. */
const NUMBER_DEFAULT = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*/;

/** How many elements each uniform type holds. */
const ELEMENT_COUNTS: Readonly<Record<ShaderUniformType, number>> = Object.freeze({
  f32: 1,
  u32: 1,
  i32: 1,
  "vec2<f32>": 2,
  "vec3<f32>": 3,
  "vec4<f32>": 4,
  "mat4x4<f32>": 16,
});

/** The identity matrix a `mat4x4<f32>` uniform starts at when the file declares no default. */
const IDENTITY_MATRIX: readonly number[] = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** The mutable declaration the parser fills in, line by line. */
interface DeclarationDraft {
  kind: ShaderKind | null;
  attributes: ShaderAttributeName[] | null;
  readonly system: LiteSystemUniformName[];
  readonly ignifx: IgnifxUniformName[];
  readonly uniforms: ShaderUniformDeclaration[];
  readonly textures: ShaderTextureDeclaration[];
  readonly storage: ShaderStorageDeclaration[];
  readonly defines: ShaderDefineDeclaration[];
  readonly names: Set<string>;
  blend: ShaderBlendMode | null;
  cull: ShaderCullMode | null;
  depthWrite: boolean | null;
  depthTest: boolean | null;
  transmissive: boolean;
  instancing: ShaderInstancingMode | null;
}

/**
 * Reads a `.wgsl` file's `// @ignifx` pragmas into the declaration the loader, the material
 * builder, and the inspector all read.
 *
 * @param source - The whole file, as text.
 * @param address - The asset address, so a failure names the file.
 * @returns The declaration, with every default filled in.
 * @throws IgnifxError with code `IGX-0719`, carrying the offending `line`, for an unknown directive,
 * a malformed one, a duplicate binding name, an attribute or uniform type Babylon Lite does not
 * have, or a combination it cannot express.
 *
 * @example
 * ```ts
 * const declaration = parseShaderDeclaration("// @ignifx shader\n", "shaders/flat.wgsl");
 * declaration.attributes; // ["position"]
 * ```
 *
 * @public
 */
export function parseShaderDeclaration(source: string, address: string): ShaderDeclaration {
  const draft: DeclarationDraft = {
    kind: null,
    attributes: null,
    system: [],
    ignifx: [],
    uniforms: [],
    textures: [],
    storage: [],
    defines: [],
    names: new Set<string>(),
    blend: null,
    cull: null,
    depthWrite: null,
    depthTest: null,
    transmissive: false,
    instancing: null,
  };
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const matched = PRAGMA_LINE.exec(lines[index] ?? "");
    if (matched === null) {
      continue;
    }
    readDirective(draft, (matched[1] ?? "").trim(), address, index + 1);
  }
  return finish(draft, address);
}

/**
 * Applies one `// @ignifx …` line to the draft.
 *
 * @param draft - The declaration being built.
 * @param text - The directive text, already trimmed.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 */
function readDirective(draft: DeclarationDraft, text: string, address: string, line: number): void {
  if (text.length === 0) {
    throw pragmaError(address, line, "an @ignifx comment declares no directive");
  }
  const separator = text.search(/\s/);
  const directive = separator < 0 ? text : text.slice(0, separator);
  const rest = separator < 0 ? "" : text.slice(separator + 1).trim();
  switch (directive) {
    case "shader":
    case "surface":
    case "post":
      readKind(draft, directive, rest, address, line);
      return;
    case "attributes":
      readAttributes(draft, rest, address, line);
      return;
    case "system":
      readSystem(draft, rest, address, line);
      return;
    case "uniform":
      draft.uniforms.push(readUniform(draft, rest, address, line));
      return;
    case "texture":
      draft.textures.push(readTexture(draft, rest, address, line));
      return;
    case "storage":
      draft.storage.push(readStorage(draft, rest, address, line));
      return;
    case "define":
      draft.defines.push(readDefine(draft, rest, address, line));
      return;
    case "blend":
    case "cull":
    case "depthWrite":
    case "depthTest":
    case "transmissive":
    case "instancing":
      readPipeline(draft, text, address, line);
      return;
    default:
      throw pragmaError(address, line, `${JSON.stringify(directive)} is not an @ignifx directive`);
  }
}

/**
 * Records the file's form, refusing a second one.
 *
 * @param draft - The declaration being built.
 * @param kind - The declared form.
 * @param rest - Whatever followed it, which must be nothing.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 */
function readKind(draft: DeclarationDraft, kind: ShaderKind, rest: string, address: string, line: number): void {
  if (rest.length > 0) {
    throw pragmaError(address, line, `@ignifx ${kind} takes no arguments, but found ${JSON.stringify(rest)}`);
  }
  if (draft.kind !== null) {
    throw pragmaError(address, line, `the file already declared @ignifx ${draft.kind}`);
  }
  draft.kind = kind;
}

/**
 * Records the vertex attributes the vertex stage reads.
 *
 * @param draft - The declaration being built.
 * @param rest - The comma-separated attribute names.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 */
function readAttributes(draft: DeclarationDraft, rest: string, address: string, line: number): void {
  if (draft.attributes !== null) {
    throw pragmaError(address, line, "the file already declared @ignifx attributes");
  }
  const names = splitList(rest, address, line, "attributes");
  const attributes: ShaderAttributeName[] = [];
  for (const name of names) {
    const attribute = matchLiteral(SHADER_ATTRIBUTE_NAMES, name);
    if (attribute === null) {
      throw pragmaError(
        address,
        line,
        `${JSON.stringify(name)} is not a vertex attribute; Babylon Lite has ${SHADER_ATTRIBUTE_NAMES.join(", ")}`,
      );
    }
    if (attributes.includes(attribute)) {
      throw pragmaError(address, line, `the attribute ${attribute} is declared twice`);
    }
    attributes.push(attribute);
  }
  draft.attributes = attributes;
}

/**
 * Records the system uniforms, splitting Babylon Lite's names from ignifx's own.
 *
 * @param draft - The declaration being built.
 * @param rest - The comma-separated uniform names.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 */
function readSystem(draft: DeclarationDraft, rest: string, address: string, line: number): void {
  const names = splitList(rest, address, line, "system");
  for (const name of names) {
    const lite = matchLiteral(LITE_SYSTEM_UNIFORM_NAMES, name);
    if (lite !== null) {
      claimName(draft, lite, address, line, "system uniform");
      draft.system.push(lite);
      continue;
    }
    const ignifx = matchLiteral(IGNIFX_UNIFORM_NAMES, name);
    if (ignifx !== null) {
      claimName(draft, ignifx, address, line, "system uniform");
      draft.ignifx.push(ignifx);
      continue;
    }
    throw pragmaError(
      address,
      line,
      `${JSON.stringify(name)} is not a system uniform; Babylon Lite has ${LITE_SYSTEM_UNIFORM_NAMES.join(", ")} and ignifx adds ${IGNIFX_UNIFORM_NAMES.join(", ")}`,
    );
  }
}

/**
 * Reads one `// @ignifx uniform name: type [= default] [modifiers]` line.
 *
 * @param draft - The declaration being built, for the name namespace.
 * @param rest - The directive body.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @returns The declaration.
 */
function readUniform(draft: DeclarationDraft, rest: string, address: string, line: number): ShaderUniformDeclaration {
  const split = NAME_AND_TYPE.exec(rest);
  if (split === null) {
    throw pragmaError(address, line, `@ignifx uniform expects "name: type", but found ${JSON.stringify(rest)}`);
  }
  const name = split[1] ?? "";
  let tail = (split[2] ?? "").trim();
  const typeSeparator = tail.search(/[\s=]/);
  const typeName = typeSeparator < 0 ? tail : tail.slice(0, typeSeparator);
  tail = (typeSeparator < 0 ? "" : tail.slice(typeName.length)).trim();
  const type = matchLiteral(SHADER_UNIFORM_TYPES, typeName);
  if (type === null) {
    throw pragmaError(
      address,
      line,
      `${JSON.stringify(typeName)} is not a uniform type; Babylon Lite has ${SHADER_UNIFORM_TYPES.join(", ")}`,
    );
  }
  claimName(draft, name, address, line, "uniform");
  let defaultValue: number | readonly number[] | null = null;
  let isColor = false;
  if (tail.startsWith("=")) {
    tail = tail.slice(1).trim();
    const parsed = readDefaultValue(tail, type, name, address, line);
    defaultValue = parsed.value;
    isColor = parsed.color;
    tail = parsed.tail;
  }
  const modifiers = readModifiers(tail, name, type, address, line);
  return {
    name,
    type,
    defaultValue: defaultValue ?? implicitDefault(type),
    color: isColor || modifiers.color,
    range: modifiers.range,
    step: modifiers.step,
    tooltip: modifiers.tooltip,
  };
}

/** A parsed `= …` default value and whatever followed it. */
interface ParsedDefault {
  /** The numbers the file wrote. */
  readonly value: number | readonly number[];
  /** Whether the value was written as `color(…)`. */
  readonly color: boolean;
  /** The rest of the line. */
  readonly tail: string;
}

/**
 * Reads the `= …` half of a uniform declaration.
 *
 * @param text - The text after the `=`.
 * @param type - The declared type, which fixes the element count.
 * @param name - The uniform's name, for diagnostics.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @returns The value, whether it was a colour, and the rest of the line.
 */
function readDefaultValue(
  text: string,
  type: ShaderUniformType,
  name: string,
  address: string,
  line: number,
): ParsedDefault {
  const expected = ELEMENT_COUNTS[type];
  const colorMatch = COLOR_DEFAULT.exec(text);
  if (colorMatch !== null) {
    const numbers = readNumbers(colorMatch[1] ?? "", name, address, line);
    if (type !== "vec3<f32>" && type !== "vec4<f32>") {
      throw pragmaError(address, line, `${name} is a ${type}, so color(…) does not apply to it`);
    }
    assertArity(numbers.length, expected, name, type, address, line);
    return { value: numbers, color: true, tail: text.slice(colorMatch[0].length).trim() };
  }
  const tupleMatch = TUPLE_DEFAULT.exec(text);
  if (tupleMatch !== null) {
    const numbers = readNumbers(tupleMatch[1] ?? "", name, address, line);
    assertArity(numbers.length, expected, name, type, address, line);
    return { value: numbers, color: false, tail: text.slice(tupleMatch[0].length).trim() };
  }
  const numberMatch = NUMBER_DEFAULT.exec(text);
  if (numberMatch !== null) {
    assertArity(1, expected, name, type, address, line);
    return { value: Number(numberMatch[1]), color: false, tail: text.slice(numberMatch[0].length).trim() };
  }
  throw pragmaError(address, line, `${name} declares no readable default value after "="`);
}

/** The optional hints an inspector renders a uniform with. */
interface ParsedModifiers {
  /** Whether the bare `color` modifier was present. */
  readonly color: boolean;
  /** The `range(a, b)` bounds, or `null`. */
  readonly range: readonly [number, number] | null;
  /** The `step(s)` increment, or `null`. */
  readonly step: number | null;
  /** The `tooltip("…")` text, or `null`. */
  readonly tooltip: string | null;
}

/**
 * Reads the `range(…)`, `step(…)`, `color`, and `tooltip("…")` modifiers that close a uniform line.
 *
 * @param text - What is left of the line.
 * @param name - The uniform's name, for diagnostics.
 * @param type - The declared type, which decides whether `color` applies.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @returns The hints.
 */
function readModifiers(
  text: string,
  name: string,
  type: ShaderUniformType,
  address: string,
  line: number,
): ParsedModifiers {
  let rest = text;
  let color = false;
  let range: readonly [number, number] | null = null;
  let step: number | null = null;
  let tooltip: string | null = null;
  while (rest.length > 0) {
    const tooltipMatch = TOOLTIP_MODIFIER.exec(rest);
    if (tooltipMatch !== null) {
      if (tooltip !== null) {
        throw pragmaError(address, line, `${name} declares tooltip twice`);
      }
      tooltip = (tooltipMatch[1] ?? "").replaceAll('\\"', '"');
      rest = rest.slice(tooltipMatch[0].length);
      continue;
    }
    const callMatch = CALL_MODIFIER.exec(rest);
    if (callMatch === null) {
      throw pragmaError(address, line, `${name} declares ${JSON.stringify(rest)}, which is not a uniform modifier`);
    }
    const modifier = callMatch[1] ?? "";
    const argumentText = callMatch[2];
    if (modifier === "color") {
      if (argumentText !== undefined) {
        throw pragmaError(address, line, `${name} declares color(…) after its default value`);
      }
      if (type !== "vec3<f32>" && type !== "vec4<f32>") {
        throw pragmaError(address, line, `${name} is a ${type}, so color does not apply to it`);
      }
      color = true;
    } else if (modifier === "range") {
      if (range !== null) {
        throw pragmaError(address, line, `${name} declares range twice`);
      }
      const bounds = readNumbers(argumentText ?? "", name, address, line);
      const low = bounds[0];
      const high = bounds[1];
      if (bounds.length !== 2 || low === undefined || high === undefined) {
        throw pragmaError(address, line, `${name} declares range(…) with ${String(bounds.length)} bounds, not 2`);
      }
      range = [low, high];
    } else {
      if (step !== null) {
        throw pragmaError(address, line, `${name} declares step twice`);
      }
      const increments = readNumbers(argumentText ?? "", name, address, line);
      const increment = increments[0];
      if (increments.length !== 1 || increment === undefined) {
        throw pragmaError(address, line, `${name} declares step(…) with ${String(increments.length)} values, not 1`);
      }
      step = increment;
    }
    rest = rest.slice(callMatch[0].length);
  }
  return { color, range, step, tooltip };
}

/**
 * Reads one `// @ignifx texture name [srgb] [normal] [default white|black|transparent] [array]`
 * line.
 *
 * @param draft - The declaration being built, for the name namespace.
 * @param rest - The directive body.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @returns The declaration.
 */
function readTexture(draft: DeclarationDraft, rest: string, address: string, line: number): ShaderTextureDeclaration {
  const tokens = rest.split(/\s+/).filter((token) => token.length > 0);
  const name = tokens[0];
  if (name === undefined) {
    throw pragmaError(address, line, "@ignifx texture declares no name");
  }
  assertIdentifier(name, address, line, "texture");
  claimName(draft, name, address, line, "texture");
  claimName(draft, `${name}Sampler`, address, line, "texture sampler");
  let srgb = false;
  let normal = false;
  let array = false;
  let fallback: ShaderTextureFallback | null = null;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === "srgb") {
      srgb = true;
    } else if (token === "normal") {
      normal = true;
    } else if (token === "array") {
      array = true;
    } else if (token === "default") {
      index += 1;
      const named = matchLiteral(SHADER_TEXTURE_FALLBACKS, tokens[index] ?? "");
      if (named === null) {
        throw pragmaError(
          address,
          line,
          `${name} declares default ${JSON.stringify(tokens[index] ?? "")}; expected ${SHADER_TEXTURE_FALLBACKS.join(", ")}`,
        );
      }
      fallback = named;
    } else {
      throw pragmaError(address, line, `${JSON.stringify(token)} is not a texture modifier`);
    }
  }
  return { name, srgb, normal, fallback, array };
}

/**
 * Reads one `// @ignifx storage name: array<T>` line.
 *
 * @param draft - The declaration being built, for the name namespace.
 * @param rest - The directive body.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @returns The declaration.
 */
function readStorage(draft: DeclarationDraft, rest: string, address: string, line: number): ShaderStorageDeclaration {
  const split = NAME_AND_TYPE.exec(rest);
  if (split === null) {
    throw pragmaError(address, line, `@ignifx storage expects "name: type", but found ${JSON.stringify(rest)}`);
  }
  const name = split[1] ?? "";
  const type = (split[2] ?? "").trim();
  if (type.length === 0) {
    throw pragmaError(address, line, `${name} declares no storage buffer type`);
  }
  claimName(draft, name, address, line, "storage buffer");
  return { name, type };
}

/**
 * Reads one `// @ignifx define NAME = value` line.
 *
 * @param draft - The declaration being built, for the name namespace.
 * @param rest - The directive body.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @returns The declaration.
 */
function readDefine(draft: DeclarationDraft, rest: string, address: string, line: number): ShaderDefineDeclaration {
  const equals = rest.indexOf("=");
  if (equals < 0) {
    throw pragmaError(address, line, `@ignifx define expects "NAME = value", but found ${JSON.stringify(rest)}`);
  }
  const name = rest.slice(0, equals).trim();
  const text = rest.slice(equals + 1).trim();
  assertIdentifier(name, address, line, "define");
  claimName(draft, name, address, line, "define");
  if (text === "true" || text === "false") {
    return { name, value: text === "true" };
  }
  const numberMatch = NUMBER_DEFAULT.exec(text);
  if (numberMatch === null || numberMatch[0].trim().length !== text.length) {
    throw pragmaError(address, line, `${name} declares ${JSON.stringify(text)}; a define is true, false, or a number`);
  }
  return { name, value: Number(numberMatch[1]) };
}

/**
 * Reads a pipeline-state line, merging it into whatever earlier lines declared.
 *
 * @param draft - The declaration being built.
 * @param text - The whole directive text, starting at its first keyword.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 */
function readPipeline(draft: DeclarationDraft, text: string, address: string, line: number): void {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  for (let index = 0; index < tokens.length; index += 1) {
    const keyword = tokens[index] ?? "";
    if (keyword === "transmissive") {
      draft.transmissive = true;
      continue;
    }
    index += 1;
    const value = tokens[index] ?? "";
    switch (keyword) {
      case "blend":
        draft.blend = readPipelineValue(SHADER_BLEND_MODES, draft.blend, keyword, value, address, line);
        break;
      case "cull": {
        const cull = readPipelineValue(SHADER_CULL_MODES, draft.cull, keyword, value, address, line);
        if (cull === "front") {
          throw pragmaError(
            address,
            line,
            "Babylon Lite 1.27.0 has no front-face culling for a shader material; declare cull back or cull none and flip the winding",
          );
        }
        draft.cull = cull;
        break;
      }
      case "depthWrite":
        draft.depthWrite = readToggle(draft.depthWrite, keyword, value, address, line);
        break;
      case "depthTest":
        draft.depthTest = readToggle(draft.depthTest, keyword, value, address, line);
        break;
      case "instancing":
        draft.instancing = readPipelineValue(SHADER_INSTANCING_MODES, draft.instancing, keyword, value, address, line);
        break;
      default:
        throw pragmaError(address, line, `${JSON.stringify(keyword)} is not a pipeline keyword`);
    }
  }
}

/**
 * Reads one pipeline keyword's value out of a fixed list, refusing a second declaration of it.
 *
 * @typeParam Value - The literal union the keyword accepts.
 * @param allowed - The accepted values.
 * @param current - What an earlier line declared, or `null`.
 * @param keyword - The keyword, for diagnostics.
 * @param value - The token that followed it.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @returns The value.
 */
function readPipelineValue<Value extends string>(
  allowed: readonly Value[],
  current: Value | null,
  keyword: string,
  value: string,
  address: string,
  line: number,
): Value {
  if (current !== null) {
    throw pragmaError(address, line, `${keyword} is declared twice`);
  }
  const matched = matchLiteral(allowed, value);
  if (matched === null) {
    throw pragmaError(address, line, `${keyword} ${JSON.stringify(value)} is not one of ${allowed.join(", ")}`);
  }
  return matched;
}

/**
 * Reads an `on`/`off` toggle, refusing a second declaration of it.
 *
 * @param current - What an earlier line declared, or `null`.
 * @param keyword - The keyword, for diagnostics.
 * @param value - The token that followed it.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @returns `true` for `on`, `false` for `off`.
 */
function readToggle(current: boolean | null, keyword: string, value: string, address: string, line: number): boolean {
  if (current !== null) {
    throw pragmaError(address, line, `${keyword} is declared twice`);
  }
  if (value !== "on" && value !== "off") {
    throw pragmaError(address, line, `${keyword} ${JSON.stringify(value)} is not on or off`);
  }
  return value === "on";
}

/**
 * Fills in the defaults and checks the whole-file rules.
 *
 * @param draft - The declaration the parser built.
 * @param address - The asset address, for diagnostics.
 * @returns The finished declaration.
 */
function finish(draft: DeclarationDraft, address: string): ShaderDeclaration {
  const kind = draft.kind;
  if (kind === null) {
    throw pragmaError(address, 1, "the file declares no @ignifx shader, @ignifx surface, or @ignifx post directive");
  }
  const declared = draft.attributes;
  if (declared !== null && kind === "shader" && !declared.includes("position")) {
    throw pragmaError(address, 1, "an @ignifx shader file must declare the position attribute");
  }
  const attributes: readonly ShaderAttributeName[] = declared ?? (kind === "shader" ? ["position"] : []);
  const blend = draft.blend ?? "opaque";
  if (draft.transmissive && blend === "opaque") {
    throw pragmaError(
      address,
      1,
      "transmissive needs a blended surface; declare blend alpha, additive, or premultiplied",
    );
  }
  return {
    kind,
    attributes,
    system: draft.system,
    ignifx: draft.ignifx,
    uniforms: draft.uniforms,
    textures: draft.textures,
    storage: draft.storage,
    defines: draft.defines,
    pipeline: {
      blend,
      cull: draft.cull ?? "back",
      // Babylon Lite defaults a blended material to depth-read-only and lets an explicit value win
      // (`lib/material/shader/shader-material.js`), which is the rule reproduced here so the
      // declaration itself carries the effective value.
      depthWrite: draft.depthWrite ?? blend === "opaque",
      depthTest: draft.depthTest ?? true,
      transmissive: draft.transmissive,
      instancing: draft.instancing ?? "none",
    },
  };
}

/**
 * Splits a comma-separated directive body, refusing an empty entry.
 *
 * @param rest - The directive body.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @param directive - The directive name, for diagnostics.
 * @returns The trimmed entries.
 */
function splitList(rest: string, address: string, line: number, directive: string): readonly string[] {
  if (rest.length === 0) {
    throw pragmaError(address, line, `@ignifx ${directive} declares nothing`);
  }
  const parts = rest.split(",");
  const names: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const name = (parts[index] ?? "").trim();
    if (name.length === 0) {
      throw pragmaError(address, line, `@ignifx ${directive} has an empty entry`);
    }
    names.push(name);
  }
  return names;
}

/**
 * Reads a comma-separated list of numbers.
 *
 * @param text - The argument text, without the parentheses.
 * @param name - The declaration's name, for diagnostics.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @returns The numbers.
 */
function readNumbers(text: string, name: string, address: string, line: number): readonly number[] {
  const parts = text.split(",");
  const numbers: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = (parts[index] ?? "").trim();
    const value = Number(part);
    if (part.length === 0 || !Number.isFinite(value)) {
      throw pragmaError(address, line, `${name} declares ${JSON.stringify(part)}, which is not a number`);
    }
    numbers.push(value);
  }
  return numbers;
}

/**
 * Checks that a default value has as many numbers as its type needs.
 *
 * @param actual - How many numbers the file wrote.
 * @param expected - How many the type holds.
 * @param name - The uniform's name, for diagnostics.
 * @param type - The uniform's type, for diagnostics.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 */
function assertArity(
  actual: number,
  expected: number,
  name: string,
  type: ShaderUniformType,
  address: string,
  line: number,
): void {
  if (actual !== expected) {
    throw pragmaError(
      address,
      line,
      `${name} is a ${type}, which takes ${String(expected)} numbers, but its default has ${String(actual)}`,
    );
  }
}

/**
 * The value a uniform starts at when the file declares no default: zeros, or the identity matrix.
 *
 * @param type - The declared type.
 * @returns The default.
 */
function implicitDefault(type: ShaderUniformType): number | readonly number[] {
  if (type === "mat4x4<f32>") {
    return IDENTITY_MATRIX;
  }
  const count = ELEMENT_COUNTS[type];
  if (count === 1) {
    return 0;
  }
  const zeros: number[] = [];
  for (let index = 0; index < count; index += 1) {
    zeros.push(0);
  }
  return zeros;
}

/**
 * Claims one WGSL binding name, refusing a duplicate.
 *
 * @remarks
 * Babylon Lite puts uniforms, samplers, `<name>Sampler` pairs, storage buffers, and defines in one
 * namespace (`assertUniqueName`, `lib/material/shader/shader-material.js`), so the parser checks it
 * here and reports the line instead of letting Lite throw without one.
 *
 * @param draft - The declaration being built.
 * @param name - The name being claimed.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @param what - What kind of binding is claiming it, for diagnostics.
 */
function claimName(draft: DeclarationDraft, name: string, address: string, line: number, what: string): void {
  if (draft.names.has(name)) {
    throw pragmaError(address, line, `${name} is already declared; the ${what} name must be unique in the file`);
  }
  draft.names.add(name);
}

/**
 * Checks that a name is a WGSL identifier.
 *
 * @param name - The candidate.
 * @param address - The asset address, for diagnostics.
 * @param line - The 1-based line number, for diagnostics.
 * @param what - What kind of binding it names, for diagnostics.
 */
function assertIdentifier(name: string, address: string, line: number, what: string): void {
  if (!IDENTIFIER.test(name)) {
    throw pragmaError(address, line, `${JSON.stringify(name)} is not a WGSL identifier for a ${what}`);
  }
}

/**
 * Narrows a token to one of a fixed list of literals.
 *
 * @typeParam Value - The literal union.
 * @param allowed - The accepted values.
 * @param token - The candidate.
 * @returns The matching literal, or `null`.
 */
function matchLiteral<Value extends string>(allowed: readonly Value[], token: string): Value | null {
  for (let index = 0; index < allowed.length; index += 1) {
    const candidate = allowed[index];
    if (candidate !== undefined && candidate === token) {
      return candidate;
    }
  }
  return null;
}

/**
 * Builds the `IGX-0719` failure a malformed pragma produces.
 *
 * @param address - The asset address.
 * @param line - The 1-based line number.
 * @param message - What is wrong.
 * @returns The error to throw.
 */
function pragmaError(address: string, line: number, message: string): IgnifxError {
  return new IgnifxError(CoreErrorCode.invalidShaderPragma, `${address} line ${String(line)}: ${message}.`, {
    context: { asset: address, line, message },
    hint: "The @ignifx pragma grammar is in skills/ignifx/references/formats/wgsl.md.",
  });
}
