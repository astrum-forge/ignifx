import { describe, expect, it } from "vitest";
import {
  isAbsoluteAddress,
  joinRoot,
  matchExtension,
  normalizeExtension,
  splitFragment,
} from "../../src/assets/address.js";

describe("splitFragment", () => {
  it("returns the whole address when there is no fragment", () => {
    expect(splitFragment("models/hero.glb")).toEqual({ path: "models/hero.glb", fragment: null });
  });

  it("splits at the first hash and keeps the rest as the fragment", () => {
    expect(splitFragment("models/hero.glb#animation:Run")).toEqual({
      path: "models/hero.glb",
      fragment: "animation:Run",
    });
  });

  it("hands a fragment grammar containing further hashes through intact", () => {
    expect(splitFragment("ui.atlas.json#frame:a#b").fragment).toBe("frame:a#b");
  });

  it("never splits a data URL, whose payload may contain a hash", () => {
    const address = "data:text/plain;base64,YSNi";
    expect(splitFragment(address)).toEqual({ path: address, fragment: null });
  });

  it("produces an empty fragment for a trailing hash", () => {
    expect(splitFragment("a.json#")).toEqual({ path: "a.json", fragment: "" });
  });
});

describe("isAbsoluteAddress", () => {
  it("accepts the four URL forms section 2 lists", () => {
    expect(isAbsoluteAddress("https://cdn.example.com/a.png")).toBe(true);
    expect(isAbsoluteAddress("http://localhost/a.png")).toBe(true);
    expect(isAbsoluteAddress("blob:https://example.com/1234")).toBe(true);
    expect(isAbsoluteAddress("data:application/json,{}")).toBe(true);
  });

  it("treats every other address as relative to the asset root", () => {
    expect(isAbsoluteAddress("models/hero.glb")).toBe(false);
    expect(isAbsoluteAddress("/models/hero.glb")).toBe(false);
    expect(isAbsoluteAddress("ftp://example.com/a")).toBe(false);
  });
});

describe("joinRoot", () => {
  it("joins with exactly one separator", () => {
    expect(joinRoot("assets", "models/hero.glb")).toBe("assets/models/hero.glb");
    expect(joinRoot("assets/", "models/hero.glb")).toBe("assets/models/hero.glb");
    expect(joinRoot("assets", "/models/hero.glb")).toBe("assets/models/hero.glb");
    expect(joinRoot("assets/", "/models/hero.glb")).toBe("assets/models/hero.glb");
  });

  it("leaves the address alone when the root is empty", () => {
    expect(joinRoot("", "models/hero.glb")).toBe("models/hero.glb");
  });
});

describe("matchExtension", () => {
  it("prefers the longest registered suffix", () => {
    expect(matchExtension("levels/1.scene.json", [".json", ".scene.json"])).toBe(".scene.json");
  });

  it("is case insensitive", () => {
    expect(matchExtension("Art/Hero.PNG", [".png"])).toBe(".png");
  });

  it("returns null when nothing matches", () => {
    expect(matchExtension("art/hero.tga", [".png", ".jpg"])).toBe(null);
  });
});

describe("normalizeExtension", () => {
  it("lower-cases and adds the leading dot", () => {
    expect(normalizeExtension("PNG")).toBe(".png");
    expect(normalizeExtension(".Json")).toBe(".json");
  });
});
