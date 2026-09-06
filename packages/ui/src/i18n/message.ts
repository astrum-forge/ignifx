/**
 * The ICU-style message subset `app.i18n.t` understands (`docs/architecture/13-ui.md` §3:
 * "a tiny key/value service with ICU-style plurals"*).
 *
 * ## What is supported
 *
 * - `{name}` — substitutes a parameter. A parameter that was not supplied is left as written, so a
 *   missing value shows up in the interface instead of silently becoming `undefined`.
 * - `{count, plural, one {a life} other {# lives}}` — selects a branch with `Intl.PluralRules` for
 *   the active locale, and replaces `#` inside the chosen branch with the number.
 * - `{count, plural, =0 {no lives} one {…} other {…}}` — an exact match, checked before the
 *   category, exactly as ICU orders them.
 *
 * ## What is not
 *
 * `select`, `selectordinal`, number and date skeletons, and ICU's apostrophe quoting. Braces are
 * structural: a literal `{` has to arrive through a parameter. Anything the parser cannot read is
 * reported rather than guessed at, and the service turns that report into `IGX-1304`.
 *
 * The parser is pure and allocates only while parsing; parsed patterns are cached by the service,
 * so a `t()` in `update` walks a node list and appends strings rather than re-parsing.
 */

/** The categories `Intl.PluralRules` can return, plus the exact-match form this parser also takes. */
const PLURAL_CATEGORIES: readonly string[] = Object.freeze(["zero", "one", "two", "few", "many", "other"]);

/**
 * What a message's parameters may be.
 *
 * @public
 */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Chooses a plural category for a number, in one locale.
 *
 * @public
 */
export type PluralSelector = (value: number) => string;

/**
 * A run of literal text.
 *
 * @public
 */
export interface TextNode {
  /** The discriminator. */
  readonly kind: "text";
  /** The literal. */
  readonly value: string;
}

/**
 * A `{name}` substitution.
 *
 * @public
 */
export interface ArgumentNode {
  /** The discriminator. */
  readonly kind: "argument";
  /** The parameter name. */
  readonly name: string;
}

/**
 * A `{name, plural, …}` selection.
 *
 * @public
 */
export interface PluralNode {
  /** The discriminator. */
  readonly kind: "plural";
  /** The parameter name holding the number. */
  readonly name: string;
  /** The branches, keyed by `"=0"`-style exact matches and by plural category. */
  readonly branches: ReadonlyMap<string, readonly MessageNode[]>;
}

/**
 * One piece of a parsed message.
 *
 * @public
 */
export type MessageNode = TextNode | ArgumentNode | PluralNode;

/**
 * A parsed message, or the reason it could not be parsed.
 *
 * @public
 */
export interface MessagePattern {
  /** The nodes to render. Holds the raw pattern as one text node when {@link MessagePattern.error} is set. */
  readonly nodes: readonly MessageNode[];
  /** Why the pattern could not be read, or `null` when it parsed. */
  readonly error: string | null;
}

/** The parser's mutable position, kept in one object so the recursive helpers share it. */
interface Cursor {
  /** The pattern being read. */
  readonly source: string;
  /** The next index to read. */
  index: number;
}

/**
 * Reads literal text until an unescaped `{` or `}`.
 *
 * @param cursor - The parser position.
 * @param stopAtClose - Whether a `}` ends the run, which it does inside a branch.
 * @returns The text read; possibly empty.
 */
function readText(cursor: Cursor, stopAtClose: boolean): string {
  const start = cursor.index;
  while (cursor.index < cursor.source.length) {
    const char = cursor.source[cursor.index];
    if (char === "{" || (char === "}" && stopAtClose)) {
      break;
    }
    cursor.index += 1;
  }
  return cursor.source.slice(start, cursor.index);
}

/**
 * Reads an identifier — a parameter name or a branch selector.
 *
 * @param cursor - The parser position.
 * @returns The identifier, trimmed; possibly empty.
 */
function readIdentifier(cursor: Cursor): string {
  const start = cursor.index;
  while (cursor.index < cursor.source.length) {
    const char = cursor.source[cursor.index];
    if (char === undefined || char === "," || char === "{" || char === "}" || /\s/u.test(char)) {
      break;
    }
    cursor.index += 1;
  }
  return cursor.source.slice(start, cursor.index);
}

/**
 * Skips whitespace.
 *
 * @param cursor - The parser position.
 */
function skipSpace(cursor: Cursor): void {
  while (cursor.index < cursor.source.length) {
    const char = cursor.source[cursor.index];
    if (char === undefined || !/\s/u.test(char)) {
      break;
    }
    cursor.index += 1;
  }
}

/** Thrown inside the parser and converted into {@link MessagePattern.error} at the top. */
class PatternError extends Error {}

/**
 * Parses a sequence of nodes up to the end of the pattern or to the branch's closing brace.
 *
 * @param cursor - The parser position.
 * @param nested - Whether a `}` ends this sequence.
 * @returns The nodes.
 * @throws PatternError when a brace is unbalanced or an argument form is unknown.
 */
function parseNodes(cursor: Cursor, nested: boolean): MessageNode[] {
  const nodes: MessageNode[] = [];
  for (;;) {
    const text = readText(cursor, nested);
    if (text.length > 0) {
      nodes.push({ kind: "text", value: text });
    }
    const char = cursor.source[cursor.index];
    if (char === undefined) {
      if (nested) {
        throw new PatternError("a branch is missing its closing brace");
      }
      return nodes;
    }
    if (char === "}") {
      // Only reachable inside a branch: `readText` swallows a stray `}` at the top level, so an
      // unmatched closing brace in ordinary prose is literal text rather than an authoring error.
      return nodes;
    }
    cursor.index += 1;
    nodes.push(parseArgument(cursor));
  }
}

/**
 * Parses one `{…}` argument, having already consumed the opening brace.
 *
 * @param cursor - The parser position.
 * @returns The node.
 * @throws PatternError when the argument is malformed or names an unsupported form.
 */
function parseArgument(cursor: Cursor): MessageNode {
  skipSpace(cursor);
  const name = readIdentifier(cursor);
  if (name.length === 0) {
    throw new PatternError("an argument has no name");
  }
  skipSpace(cursor);
  if (cursor.source[cursor.index] === "}") {
    cursor.index += 1;
    return { kind: "argument", name };
  }
  if (cursor.source[cursor.index] !== ",") {
    throw new PatternError(`argument ${name} is missing its closing brace`);
  }
  cursor.index += 1;
  skipSpace(cursor);
  const form = readIdentifier(cursor);
  if (form !== "plural") {
    throw new PatternError(`argument ${name} uses the unsupported form ${form === "" ? "(empty)" : form}`);
  }
  return { kind: "plural", name, branches: parseBranches(cursor, name) };
}

/**
 * Parses the branch list of a plural argument, up to and including its closing brace.
 *
 * @param cursor - The parser position.
 * @param name - The argument's name, for error messages.
 * @returns The branches.
 * @throws PatternError when a selector is unknown or the list is unterminated.
 */
function parseBranches(cursor: Cursor, name: string): ReadonlyMap<string, readonly MessageNode[]> {
  const branches = new Map<string, readonly MessageNode[]>();
  for (;;) {
    skipSpace(cursor);
    if (cursor.source[cursor.index] === ",") {
      cursor.index += 1;
      continue;
    }
    if (cursor.source[cursor.index] === "}") {
      cursor.index += 1;
      if (!branches.has("other")) {
        throw new PatternError(`plural ${name} has no other branch`);
      }
      return branches;
    }
    const selector = readIdentifier(cursor);
    if (selector.length === 0) {
      throw new PatternError(`plural ${name} is missing its closing brace`);
    }
    if (!PLURAL_CATEGORIES.includes(selector) && !/^=\d+$/u.test(selector)) {
      throw new PatternError(`plural ${name} has the unknown branch ${selector}`);
    }
    skipSpace(cursor);
    if (cursor.source[cursor.index] !== "{") {
      throw new PatternError(`branch ${selector} of plural ${name} has no body`);
    }
    cursor.index += 1;
    branches.set(selector, parseNodes(cursor, true));
    cursor.index += 1;
  }
}

/**
 * Parses one message pattern.
 *
 * @param pattern - The pattern, as written in the `.i18n.json` document.
 * @returns The parsed nodes, or the raw text plus the reason it could not be parsed.
 *
 * @example
 * ```ts
 * parseMessage("{count, plural, one {# life} other {# lives}}").error; // null
 * parseMessage("{count, plural, one {# life}}").error; // "plural count has no other branch"
 * ```
 *
 * @public
 */
export function parseMessage(pattern: string): MessagePattern {
  const cursor: Cursor = { source: pattern, index: 0 };
  try {
    return { nodes: parseNodes(cursor, false), error: null };
  } catch (error: unknown) {
    const reason = error instanceof PatternError ? error.message : "the pattern could not be read";
    return { nodes: [{ kind: "text", value: pattern }], error: reason };
  }
}

/**
 * Builds the plural selector for a locale.
 *
 * @remarks
 * `Intl.PluralRules` is present in every browser and in Node, but a stripped runtime without
 * `Intl` still has to work, so the fallback is English's two-category rule.
 *
 * @param locale - The BCP 47 locale tag.
 * @returns A function from a number to a plural category.
 *
 * @example
 * ```ts
 * createPluralSelector("en")(1); // "one"
 * ```
 *
 * @public
 */
export function createPluralSelector(locale: string): PluralSelector {
  if (typeof Intl !== "object" || typeof Intl.PluralRules !== "function") {
    return (value: number): string => (value === 1 ? "one" : "other");
  }
  try {
    const rules = new Intl.PluralRules(locale);
    return (value: number): string => rules.select(value);
  } catch {
    // An unparseable tag — `Intl.PluralRules` throws a `RangeError` for one — falls back rather
    // than taking the frame down over a translation file.
    return (value: number): string => (value === 1 ? "one" : "other");
  }
}

/**
 * Reads a parameter as a number, for a plural selection.
 *
 * @param value - The supplied parameter.
 * @returns The number, or `null` when the parameter is absent or not numeric.
 */
function asNumber(value: string | number | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim().length > 0 ? parsed : null;
}

/**
 * Renders parsed nodes with a set of parameters.
 *
 * @param nodes - The nodes from {@link parseMessage}.
 * @param params - The values to substitute.
 * @param select - The active locale's plural selector.
 * @param hash - What `#` stands for in the branch being rendered, or `null` at the top level.
 * @returns The rendered string.
 */
function render(
  nodes: readonly MessageNode[],
  params: MessageParams,
  select: PluralSelector,
  hash: string | null,
): string {
  let out = "";
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) {
      continue;
    }
    if (node.kind === "text") {
      out += hash === null ? node.value : node.value.replaceAll("#", hash);
      continue;
    }
    if (node.kind === "argument") {
      const value = Object.hasOwn(params, node.name) ? params[node.name] : undefined;
      out += value === undefined ? `{${node.name}}` : String(value);
      continue;
    }
    const raw = Object.hasOwn(params, node.name) ? params[node.name] : undefined;
    const count = asNumber(raw);
    if (count === null) {
      out += `{${node.name}}`;
      continue;
    }
    const branch =
      node.branches.get(`=${String(count)}`) ?? node.branches.get(select(count)) ?? node.branches.get("other");
    out += branch === undefined ? "" : render(branch, params, select, String(count));
  }
  return out;
}

/**
 * Renders a parsed message.
 *
 * @param pattern - The parsed pattern.
 * @param params - The values to substitute.
 * @param select - The active locale's plural selector.
 * @returns The rendered string.
 *
 * @example
 * ```ts
 * const pattern = parseMessage("{count, plural, one {# life} other {# lives}}");
 * renderMessage(pattern, { count: 3 }, createPluralSelector("en")); // "3 lives"
 * ```
 *
 * @public
 */
export function renderMessage(pattern: MessagePattern, params: MessageParams, select: PluralSelector): string {
  return render(pattern.nodes, params, select, null);
}
