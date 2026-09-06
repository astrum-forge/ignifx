import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

/**
 * The barrel's shape. It is asserted rather than described so that adding an export without adding
 * it to the API report, the skill, and the changeset is a failing test rather than a surprise in a
 * release (`CONSTITUTION.md` Article IV).
 */
describe("@ignifx/3d barrel", () => {
  it("exports the twelve component classes", () => {
    for (const name of [
      "Animator",
      "ThirdPersonController",
      "FirstPersonController",
      "RigidbodyMover",
      "PlatformMover",
      "Projectile",
      "ThirdPersonCamera",
      "NavMeshSurface",
      "NavMeshAgent",
      "NavMeshObstacle",
      "LodGroup",
      "Billboard",
    ]) {
      expect(Object.hasOwn(barrel, name), name).toBe(true);
    }
  });

  it("exports the extension factory, the service, and the error table", () => {
    expect(typeof barrel.threeD).toBe("function");
    expect(typeof barrel.NavigationService).toBe("function");
    expect(barrel.ThreeDErrorCode.invalidAnimatorFile).toBe("IGX-1201");
    expect(barrel.VERSION).toBe("0.0.0");
  });

  it("exports nothing that is not documented as public", () => {
    // `AnimatorMixer` and the navigation plugin adapter are `@internal`; leaking one would put a
    // raw Babylon Lite surface into the published API (`CONSTITUTION.md` §3.4).
    expect(Object.hasOwn(barrel, "AnimatorMixer")).toBe(false);
    expect(Object.hasOwn(barrel, "createPlugin")).toBe(false);
    expect(Object.hasOwn(barrel, "ActionSlot")).toBe(false);
  });
});
