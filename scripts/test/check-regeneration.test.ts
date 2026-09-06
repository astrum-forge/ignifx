import { describe, expect, it } from "vitest";
import { generatedFiles } from "../lib/check-regeneration.ts";
import { REPOSITORY_ROOT } from "./support/skill-tree.ts";

describe("regeneration-diff: the generated set", () => {
  it("covers the generated llms.txt", () => {
    expect(generatedFiles(REPOSITORY_ROOT, [])).toContain("website/public/llms.txt");
  });

  it("covers the generated reference pages but not their hand-written READMEs", () => {
    const files = generatedFiles(REPOSITORY_ROOT, ["skills/ignifx/references/recipes"]);
    expect(files).toContain("skills/ignifx/references/recipes/load-a-model.md");
    expect(files).not.toContain("skills/ignifx/references/recipes/README.md");
  });
});
