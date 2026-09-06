/**
 * The whole HTML layer of the site: a string builder with escaping.
 *
 * There is no template engine and no client-side renderer. Every page is a string assembled here at
 * build time, which is what lets `public/_headers` ship a Content-Security-Policy with no
 * `unsafe-inline` for either scripts or styles: nothing on a page carries a `style` attribute or an
 * inline `<script>`, and `test/site.test.ts` asserts that over the built output.
 */

/** Attribute values accepted by {@link h}. `true` renders a bare attribute; `null`/`false` omit it. */
export type Attributes = Readonly<Record<string, string | number | boolean | null>>;

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

const ESCAPABLE = /[&<>"']/gu;

/** Elements that never take children and are written without a closing tag. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * Escapes text for use as HTML content or as a quoted attribute value.
 *
 * @param value - Plain text.
 * @returns The text with the five HTML-significant characters replaced by entities.
 */
export function esc(value: string): string {
  return value.replaceAll(ESCAPABLE, (character) => ENTITIES.get(character) ?? character);
}

/**
 * Renders one attribute list.
 *
 * @param attributes - Attribute names and values.
 * @returns The serialized attributes, each preceded by a space, or an empty string.
 */
function renderAttributes(attributes: Attributes): string {
  let out = "";
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === false) {
      continue;
    }
    out += value === true ? ` ${name}` : ` ${name}="${esc(String(value))}"`;
  }
  return out;
}

/**
 * Builds one element. Children are **already HTML**: call {@link esc} on anything that came from a
 * file or a heading before passing it in.
 *
 * @param tag - Element name.
 * @param attributes - Attributes to set, or `{}`.
 * @param children - Child HTML, joined in order. Ignored for void elements.
 * @returns The element's HTML.
 */
export function h(tag: string, attributes: Attributes = {}, children: string | readonly string[] = ""): string {
  const open = `<${tag}${renderAttributes(attributes)}>`;
  if (VOID_ELEMENTS.has(tag)) {
    return open;
  }
  const inner = typeof children === "string" ? children : children.join("");
  return `${open}${inner}</${tag}>`;
}

/**
 * Joins a list of HTML fragments.
 *
 * @param parts - Fragments, in order. `null` entries are dropped, which is how optional blocks are
 *   written without a conditional at every call site.
 * @returns The concatenated HTML.
 */
export function join(...parts: readonly (string | null)[]): string {
  let out = "";
  for (const part of parts) {
    if (part !== null) {
      out += part;
    }
  }
  return out;
}

/**
 * Maps a list to HTML and joins it.
 *
 * @param items - The source items.
 * @param render - Turns one item into HTML.
 * @returns The concatenated HTML.
 * @typeParam T - Item type.
 */
export function each<T>(items: readonly T[], render: (item: T, index: number) => string): string {
  let out = "";
  for (const [index, item] of items.entries()) {
    out += render(item, index);
  }
  return out;
}
