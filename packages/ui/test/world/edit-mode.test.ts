import { describe, expect, it } from "vitest";
import { HudText } from "../../src/text/hud-text.js";
import { createUiApp, fixtureFiles } from "../support/app.js";
import type { FontAsset } from "@ignifx/core";

/**
 * `@ignifx/ui` in an edit-mode app (ADR-0028): the UI system keeps running, so text from a scene
 * file is shaped and shows in an editor's scene view.
 */

describe("the UI system in an edit-mode app", () => {
  it("shapes a text block", async () => {
    const h = await createUiApp({ files: fixtureFiles(), editMode: true });
    try {
      const font = await h.load<FontAsset>("ui/ShareTechMono-Regular.ttf");
      const label = h.app.world.createEntity("score").addComponent(HudText);
      label.font = font;
      label.text = "Hello";
      h.step();
      expect(label.block).not.toBeNull();
      expect(label.metrics.width).toBeCloseTo(86.4, 5);
    } finally {
      h.dispose();
    }
  });
});
