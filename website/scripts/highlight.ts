/**
 * Build-time syntax highlighting with Shiki.
 *
 * Shiki's own `codeToHtml` writes a `style` attribute on every token span. The site ships a
 * Content-Security-Policy with `style-src 'self'` and no `unsafe-inline`, so those attributes would
 * be dropped by the browser and every code block would render in one colour. This module therefore
 * tokenizes instead of rendering: each distinct light/dark colour pair becomes a class (`tk-N`) and
 * the classes are emitted into a real stylesheet at the end of the build.
 *
 * Both themes are declared at once (`defaultColor: false`), so one HTML file serves both palettes
 * and the theme toggle needs no re-render.
 */
import { createHighlighter } from "shiki";
import { each, esc, h, join } from "./html.ts";
import type { BundledLanguage, Highlighter } from "shiki";

/** The two Shiki themes, chosen for low chroma so they sit inside the site's own palette. */
const THEMES = { light: "vitesse-light", dark: "vitesse-dark" } as const;

/** Languages loaded up front. Anything else in a fence renders as plain text. */
const LANGUAGES: readonly BundledLanguage[] = ["typescript", "javascript", "json", "bash", "html"];

/** Fence info strings mapped onto a loaded grammar. `ts run` and `ts ignore-check` are harness tags. */
const ALIASES: ReadonlyMap<string, BundledLanguage> = new Map([
  ["ts", "typescript"],
  ["typescript", "typescript"],
  ["js", "javascript"],
  ["javascript", "javascript"],
  ["json", "json"],
  ["jsonc", "json"],
  ["html", "html"],
  ["sh", "bash"],
  ["bash", "bash"],
  ["shell", "bash"],
]);

/** How one code block is labelled and captioned. */
export interface CodeOptions {
  /** Replaces the language chip, e.g. `main.ts`. */
  readonly label?: string;
  /** A line under the block, in `--ink-2`, e.g. `compiled by the docs harness`. */
  readonly caption?: string;
  /** Whether to colour the tokens. Defaults to `true`. */
  readonly colour?: boolean;
}

/** A highlighter plus the class table it has accumulated so far. */
export interface CodeHighlighter {
  /**
   * Renders one fenced block.
   *
   * @param code - The block's text, without the fences.
   * @param info - The fence info string (`ts`, `ts run`, `json`, `""`).
   * @param options - Label, caption and colouring.
   * @returns A `<figure class="code">` holding a copy button and the highlighted `<pre>`.
   */
  readonly render: (code: string, info: string, options?: CodeOptions) => string;
  /**
   * Renders the stylesheet for every token class handed out so far. Call after the last page.
   *
   * @returns CSS text.
   */
  readonly stylesheet: () => string;
}

/**
 * Reads the grammar name out of a fence info string.
 *
 * @param info - The raw info string.
 * @returns A loaded grammar name, or `null` for plain text.
 */
function grammarFor(info: string): BundledLanguage | null {
  const first = info.trim().split(/\s+/u)[0] ?? "";
  return ALIASES.get(first.toLowerCase()) ?? null;
}

/**
 * Renders the plain-text form of a block: no spans, no classes, just escaped text.
 *
 * @param code - The block's text.
 * @returns The `<code>` inner HTML.
 */
function plainCode(code: string): string {
  return esc(code);
}

/**
 * Creates the highlighter. One instance serves the whole build.
 *
 * @returns The renderer and its stylesheet accessor.
 */
export async function createCodeHighlighter(): Promise<CodeHighlighter> {
  const highlighter: Highlighter = await createHighlighter({
    themes: [THEMES.light, THEMES.dark],
    langs: [...LANGUAGES],
  });
  // Insertion-ordered, so the emitted stylesheet is byte-stable for a given set of inputs.
  const classes = new Map<string, string>();

  /**
   * Interns one light/dark colour pair as a class name.
   *
   * @param light - The light-theme hex colour.
   * @param dark - The dark-theme hex colour.
   * @returns The class name.
   */
  function classFor(light: string, dark: string): string {
    const key = `${light}|${dark}`;
    const existing = classes.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const name = `tk-${String(classes.size)}`;
    classes.set(key, name);
    return name;
  }

  /**
   * Highlights one block.
   *
   * @param code - The block's text.
   * @param info - The fence info string.
   * @returns The `<code>` inner HTML.
   */
  function tokenize(code: string, info: string, colour: boolean): string {
    const lang = grammarFor(info);
    if (lang === null || !colour) {
      return plainCode(code);
    }
    const { tokens } = highlighter.codeToTokens(code, {
      lang,
      themes: THEMES,
      defaultColor: false,
    });
    return each(tokens, (line) =>
      h(
        "span",
        { class: "line" },
        each(line, (token) => {
          const style = token.htmlStyle;
          const light = typeof style === "object" ? (style["--shiki-light"] ?? "") : "";
          const dark = typeof style === "object" ? (style["--shiki-dark"] ?? "") : "";
          const text = esc(token.content);
          return light === "" ? text : h("span", { class: classFor(light, dark) }, text);
        }),
      ),
    );
  }

  return {
    render(code: string, info: string, options: CodeOptions = {}): string {
      const named = options.label !== undefined;
      const label = options.label ?? grammarFor(info) ?? "text";
      const inner = tokenize(code.replace(/\n$/u, ""), info, options.colour ?? true);
      const body = h("pre", { class: "code-pre", tabindex: "0" }, h("code", {}, inner));
      const bar = h("div", { class: "code-bar" }, [
        h("span", { class: named ? "code-lang code-name" : "code-lang" }, esc(label)),
        h("button", { type: "button", class: "code-copy", "data-copy": true }, "Copy"),
      ]);
      const caption =
        options.caption === undefined ? null : h("figcaption", { class: "code-caption" }, esc(options.caption));
      return h("figure", { class: "code" }, join(bar, body, caption));
    },
    stylesheet(): string {
      // One declaration per colour pair; `src/styles/code.css` holds the three rules that pick
      // `--tk` or `--tk-d` per theme, so the generated half stays proportional to the palette.
      let out = `/* Generated at build time from Shiki's ${THEMES.light}/${THEMES.dark} themes. */\n`;
      for (const [key, name] of classes) {
        const [lightColor = "", darkColor = ""] = key.split("|");
        out += `.${name}{--tk:${lightColor};--tk-d:${darkColor}}\n`;
      }
      return out;
    },
  };
}
