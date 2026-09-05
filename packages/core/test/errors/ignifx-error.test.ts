import { describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { assertNever, formatErrorMessage, IgnifxError, isIgnifxError } from "../../src/errors/ignifx-error.js";

describe("formatErrorMessage", () => {
  it("spells out the code, the message, the context, and the hint in development", () => {
    const message = formatErrorMessage(
      "IGX-0201",
      "Mover requires Rigidbody.",
      { component: "mygame/Mover", entity: "01ARZ3NDEK" },
      "Add a Rigidbody to the entity.",
      "development",
    );
    expect(message).toBe(
      "IGX-0201: Mover requires Rigidbody. [component=mygame/Mover, entity=01ARZ3NDEK] Hint: Add a Rigidbody to the entity.",
    );
  });

  it("keeps only the code and the context keys in production", () => {
    const message = formatErrorMessage(
      "IGX-0201",
      "Mover requires Rigidbody.",
      { component: "mygame/Mover", entity: "01ARZ3NDEK" },
      "Add a Rigidbody to the entity.",
      "production",
    );
    expect(message).toBe("IGX-0201 [component, entity]");
  });

  it("reduces to the bare code in production when there is no context", () => {
    expect(formatErrorMessage("IGX-0701", "WebGPU is missing.", {}, null, "production")).toBe("IGX-0701");
  });

  it("omits the context section in development when there is no context", () => {
    expect(formatErrorMessage("IGX-0701", "WebGPU is missing.", {}, null, "development")).toBe(
      "IGX-0701: WebGPU is missing.",
    );
  });

  it("renders null, boolean, and numeric context values", () => {
    expect(formatErrorMessage("IGX-0601", "Bad field.", { x: null, y: 3, z: false }, null, "development")).toBe(
      "IGX-0601: Bad field. [x=null, y=3, z=false]",
    );
  });

  it("ignores an empty hint", () => {
    expect(formatErrorMessage("IGX-0701", "WebGPU is missing.", {}, "", "development")).toBe(
      "IGX-0701: WebGPU is missing.",
    );
  });
});

describe("IgnifxError", () => {
  it("carries the code, the context, and the hint as structured properties", () => {
    const error = new IgnifxError(CoreErrorCode.unknownLayer, "Enemy is not a declared layer.", {
      context: { layer: "Enemy" },
      hint: "Declare it in ignifx.config.ts.",
    });
    expect(error.code).toBe("IGX-0303");
    expect(error.context).toEqual({ layer: "Enemy" });
    expect(error.hint).toBe("Declare it in ignifx.config.ts.");
    expect(error.name).toBe("IgnifxError");
  });

  it("defaults to an empty context, no hint, and development formatting", () => {
    const error = new IgnifxError(CoreErrorCode.assetNotLoaded, "Still loading.");
    expect(error.context).toEqual({});
    expect(error.hint).toBeNull();
    expect(error.message).toBe("IGX-0501: Still loading.");
  });

  it("compacts its message when constructed in production mode", () => {
    const error = new IgnifxError(CoreErrorCode.assetNotLoaded, "Still loading.", {
      context: { asset: "atlas/ui" },
      mode: "production",
    });
    expect(error.message).toBe("IGX-0501 [asset]");
    expect(error.context).toEqual({ asset: "atlas/ui" });
  });

  it("keeps the original failure as its cause", () => {
    const cause = new Error("boom");
    const error = new IgnifxError(CoreErrorCode.assetLoadAborted, "Aborted.", { cause });
    expect(error.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    expect(new IgnifxError(CoreErrorCode.assetNotLoaded, "x")).toBeInstanceOf(Error);
  });
});

describe("isIgnifxError", () => {
  it("accepts an ignifx error", () => {
    expect(isIgnifxError(new IgnifxError(CoreErrorCode.assetNotLoaded, "x"))).toBe(true);
  });

  it("rejects a plain error and a non-error", () => {
    expect(isIgnifxError(new Error("x"))).toBe(false);
    expect(isIgnifxError("IGX-0501")).toBe(false);
    expect(isIgnifxError(null)).toBe(false);
  });
});

describe("assertNever", () => {
  it("throws with the unreachable-case code and the value that got through", () => {
    const value = "surprise" as never;
    try {
      assertNever(value, "log level");
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error)).toBe(true);
      if (isIgnifxError(error)) {
        expect(error.code).toBe(CoreErrorCode.unreachableCase);
        expect(error.context).toEqual({ what: "log level", value: "surprise" });
      }
    }
  });
});
