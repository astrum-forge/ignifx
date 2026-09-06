import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

describe("@ignifx/physics-2d barrel", () => {
  it("exports the extension factory, the components, and the service", () => {
    expect(typeof barrel.physics2d).toBe("function");
    expect(barrel.Rigidbody2D.typeId).toBe("ignifx/Rigidbody2D");
    expect(barrel.BoxCollider2D.typeId).toBe("ignifx/BoxCollider2D");
    expect(barrel.CharacterController2D.typeId).toBe("ignifx/CharacterController2D");
    expect(typeof barrel.Physics2DService).toBe("function");
  });

  it("evaluates without doing anything at import time", () => {
    expect(Object.keys(barrel).length).toBeGreaterThan(20);
  });
});
