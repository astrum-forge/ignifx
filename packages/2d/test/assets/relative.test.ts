import { describe, expect, it } from "vitest";
import { normalisePath, resolveRelative } from "../../src/assets/relative.js";

/**
 * Every reference `@ignifx/2d` reads out of a file is relative to the file that names it, which is
 * what every atlas packer and map editor emits (`docs/architecture/05-assets-and-loading.md` §2).
 */

describe("resolveRelative", () => {
  it("joins a sibling onto the document's directory", () => {
    expect(resolveRelative("2d/hero.atlas.json", "hero.png")).toBe("2d/hero.png");
  });

  it("walks up with ..", () => {
    expect(resolveRelative("2d/levels/one.tilemap.json", "../tiles.atlas.json")).toBe("2d/tiles.atlas.json");
  });

  it("treats a document in the root as having no directory", () => {
    expect(resolveRelative("hero.atlas.json", "hero.png")).toBe("hero.png");
  });

  it("leaves an absolute path alone", () => {
    expect(resolveRelative("2d/hero.atlas.json", "/sprites/hero.png")).toBe("/sprites/hero.png");
  });

  it("leaves a URL alone", () => {
    for (const url of ["http://x/y.png", "https://x/y.png", "data:image/png;base64,AA", "blob:abc", "//cdn/y.png"]) {
      expect(resolveRelative("2d/hero.atlas.json", url)).toBe(url);
    }
  });

  it("answers an empty reference with an empty string", () => {
    expect(resolveRelative("2d/hero.atlas.json", "")).toBe("");
  });
});

describe("normalisePath", () => {
  it("collapses . and empty segments", () => {
    expect(normalisePath("a/./b//c")).toBe("a/b/c");
  });

  it("collapses ..", () => {
    expect(normalisePath("a/b/../c")).toBe("a/c");
  });

  it("drops segments that would escape the root", () => {
    expect(normalisePath("../../a")).toBe("a");
  });

  it("answers an empty path with an empty string", () => {
    expect(normalisePath("")).toBe("");
  });
});
