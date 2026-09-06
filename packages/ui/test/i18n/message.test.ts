import { describe, expect, it } from "vitest";
import { createPluralSelector, parseMessage, renderMessage } from "../../src/i18n/message.js";
import type { MessageParams } from "../../src/i18n/message.js";

/**
 * The ICU-style message subset (`docs/architecture/13-ui.md` §3).
 */

/**
 * Parses and renders in one step, with English plural rules.
 *
 * @param pattern - The pattern.
 * @param params - The parameters.
 * @returns The rendered string.
 */
function render(pattern: string, params: MessageParams = {}): string {
  return renderMessage(parseMessage(pattern), params, createPluralSelector("en"));
}

describe("interpolation", () => {
  it("substitutes a named parameter", () => {
    expect(render("Score: {score}", { score: 42 })).toBe("Score: 42");
  });

  it("substitutes the same parameter more than once", () => {
    expect(render("{a} and {a}", { a: "x" })).toBe("x and x");
  });

  it("leaves a parameter that was not supplied visible in the output", () => {
    expect(render("Hello {name}")).toBe("Hello {name}");
  });

  it("passes a pattern with no arguments through unchanged", () => {
    expect(render("Paused")).toBe("Paused");
  });

  it("tolerates whitespace around an argument name", () => {
    expect(render("{ name }", { name: "Ada" })).toBe("Ada");
  });
});

describe("plurals", () => {
  const lives = "{count, plural, =0 {No lives left} one {# life} other {# lives}}";

  it("selects the exact match before the category", () => {
    expect(render(lives, { count: 0 })).toBe("No lives left");
  });

  it("selects the one category and substitutes the hash", () => {
    expect(render(lives, { count: 1 })).toBe("1 life");
  });

  it("selects the other category", () => {
    expect(render(lives, { count: 7 })).toBe("7 lives");
  });

  it("accepts a numeric string as the count", () => {
    expect(render(lives, { count: "3" })).toBe("3 lives");
  });

  it("shows the placeholder when the count is absent or not a number", () => {
    expect(render(lives)).toBe("{count}");
    expect(render(lives, { count: "many" })).toBe("{count}");
  });

  it("substitutes other parameters inside a branch", () => {
    expect(render("{n, plural, one {{who} has # apple} other {{who} has # apples}}", { n: 2, who: "Ada" })).toBe(
      "Ada has 2 apples",
    );
  });

  it("uses the locale's own categories", () => {
    const pattern = "{n, plural, one {un} few {quelques} many {beaucoup} other {des}}";
    expect(renderMessage(parseMessage(pattern), { n: 1 }, createPluralSelector("fr"))).toBe("un");
    expect(renderMessage(parseMessage(pattern), { n: 30 }, createPluralSelector("fr"))).toBe("des");
  });

  it("falls back to English rules for a tag Intl cannot parse", () => {
    const select = createPluralSelector("not a tag");
    expect(select(1)).toBe("one");
    expect(select(2)).toBe("other");
  });
});

describe("rejected patterns", () => {
  it("reports a plural with no other branch", () => {
    const parsed = parseMessage("{count, plural, one {# life}}");
    expect(parsed.error).toBe("plural count has no other branch");
  });

  it("reports an unbalanced opening brace", () => {
    expect(parseMessage("Hello {name").error).toBe("argument name is missing its closing brace");
  });

  it("treats a stray closing brace in prose as literal text", () => {
    expect(parseMessage("Hello }").error).toBeNull();
    expect(render("Hello }")).toBe("Hello }");
  });

  it("reports an argument with no name", () => {
    expect(parseMessage("{}").error).toBe("an argument has no name");
  });

  it("reports an unsupported argument form", () => {
    expect(parseMessage("{g, select, male {he} other {they}}").error).toBe(
      "argument g uses the unsupported form select",
    );
  });

  it("reports an unknown plural branch", () => {
    expect(parseMessage("{n, plural, lots {many} other {some}}").error).toBe("plural n has the unknown branch lots");
  });

  it("reports a branch with no body", () => {
    expect(parseMessage("{n, plural, one other {x}}").error).toBe("branch one of plural n has no body");
  });

  it("reports an unterminated branch list", () => {
    expect(parseMessage("{n, plural, other {x}").error).toBe("plural n is missing its closing brace");
  });

  it("reports an unterminated branch body", () => {
    expect(parseMessage("{n, plural, other {x").error).toBe("a branch is missing its closing brace");
  });

  it("renders an unreadable pattern as its own raw text", () => {
    expect(render("Hello {name")).toBe("Hello {name");
  });
});
