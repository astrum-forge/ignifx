import { afterEach, describe, expect, it } from "vitest";
import {
  createInputActionsLoader,
  defineInputActions,
  INPUT_ACTIONS_ASSET_TYPE,
  INPUT_ACTIONS_FILE_EXTENSIONS,
  INPUT_ACTIONS_FORMAT,
  inputActionsJsonSchema,
  InputActionsAsset,
  validateInputActions,
} from "../../src/index.js";
import { createInputApp, demoActions } from "../support/app.js";
import type { InputActionsAsset as InputActionsAssetType } from "../../src/index.js";
import type { InputAppHarness } from "../support/app.js";
import type { IgnifxError } from "@ignifx/core";

let harness: InputAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The `.input.json` document `docs/architecture/08-input.md` §3 prints, as a JSON string. */
function documentJson(): string {
  return JSON.stringify({
    format: "ignifx.inputactions",
    formatVersion: 1,
    controlSchemes: [
      { name: "KeyboardMouse", devices: ["Keyboard", "Mouse"] },
      { name: "Gamepad", devices: ["Gamepad"] },
      { name: "Touch", devices: ["Touch"] },
    ],
    maps: [
      {
        name: "Player",
        actions: [
          {
            name: "move",
            type: "vector2",
            bindings: [
              {
                composite: "2DVector",
                up: "<Keyboard>/w",
                down: "<Keyboard>/s",
                left: "<Keyboard>/a",
                right: "<Keyboard>/d",
                scheme: "KeyboardMouse",
              },
              { path: "<Gamepad>/leftStick", processors: ["deadzone(0.15)"], scheme: "Gamepad" },
            ],
          },
          {
            name: "jump",
            type: "button",
            bindings: [{ path: "<Keyboard>/space" }, { path: "<Gamepad>/buttonSouth" }],
          },
          {
            name: "look",
            type: "vector2",
            bindings: [{ path: "<Mouse>/delta", processors: ["scale(0.1)"] }],
          },
          {
            name: "throttle",
            type: "axis",
            bindings: [{ composite: "1DAxis", negative: "<Keyboard>/s", positive: "<Keyboard>/w" }],
          },
        ],
      },
      {
        name: "UI",
        enabled: false,
        actions: [{ name: "submit", type: "button", bindings: [{ path: "<Keyboard>/enter" }] }],
      },
    ],
  });
}

/** A `fetch` that answers every request with one body. */
function fakeFetch(body: string): typeof globalThis.fetch {
  return (): Promise<Response> =>
    Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
}

/** Runs a call that must throw an `IgnifxError` and returns its code. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as IgnifxError).code;
  }
  return "";
}

describe("the inputactions loader", () => {
  it("declares the documented type and extension", () => {
    const loader = createInputActionsLoader();
    expect(loader.type).toBe(INPUT_ACTIONS_ASSET_TYPE);
    expect(loader.extensions).toEqual(INPUT_ACTIONS_FILE_EXTENSIONS);
    expect(INPUT_ACTIONS_FILE_EXTENSIONS).toEqual([".input.json"]);
  });

  it("loads a document through the asset service and installs it", async () => {
    const built = await createInputApp({ fetch: fakeFetch(documentJson()) });
    harness = built;
    const handle = built.app.assets.load<InputActionsAssetType>("input/default.input.json");
    await built.settle();
    const asset = await handle.promise;
    expect(asset).toBeInstanceOf(InputActionsAsset);
    expect(asset.address).toBe("input/default.input.json");
    expect(asset.mapNames).toEqual(["Player", "UI"]);
    built.app.input.loadActions(asset);
    expect(built.app.input.actions.get("jump").bindings).toHaveLength(2);
  });

  it("resolves the same maps as the equivalent defineInputActions call", async () => {
    const built = await createInputApp({ fetch: fakeFetch(documentJson()) });
    harness = built;
    const handle = built.app.assets.load<InputActionsAssetType>("input/default.input.json");
    await built.settle();
    const asset = await handle.promise;
    expect(asset.definition).toEqual(demoActions());
  });

  it("installs the document the input.actions setting names during start()", async () => {
    const built = await createInputApp({
      fetch: fakeFetch(documentJson()),
      options: { actions: "input/default.input.json" },
    });
    harness = built;
    await built.app.start();
    expect(built.app.input.actionsHandle).not.toBeNull();
    await built.settle();
    await built.app.input.actionsHandle?.promise;
    expect(built.app.input.actions.find("jump")).not.toBeNull();
  });

  it("reports a failed document load through app.onError", async () => {
    const built = await createInputApp({
      fetch: fakeFetch("not json at all"),
      options: { actions: "input/default.input.json" },
      settings: { assets: { retries: 0 } },
    });
    harness = built;
    const reported: string[] = [];
    built.app.onError.connect((report) => reported.push(report.source));
    await built.app.start();
    await built.settle();
    await built.app.input.actionsHandle?.promise.catch(() => undefined);
    await built.settle();
    expect(reported).toContain("asset");
  });
});

describe("document validation", () => {
  it("accepts the documented file", () => {
    const parsed: unknown = JSON.parse(documentJson());
    expect(validateInputActions(parsed, "x.input.json").maps).toHaveLength(2);
  });

  it("defaults controlSchemes to an empty list", () => {
    const document = { format: INPUT_ACTIONS_FORMAT, formatVersion: 1, maps: [] };
    expect(validateInputActions(document, "x.input.json").controlSchemes).toEqual([]);
  });

  it("rejects anything that is not an object", () => {
    expect(codeOf(() => validateInputActions(7, "x.input.json"))).toBe("IGX-0805");
    expect(codeOf(() => validateInputActions(null, "x.input.json"))).toBe("IGX-0805");
    expect(codeOf(() => validateInputActions([], "x.input.json"))).toBe("IGX-0805");
  });

  it("rejects a wrong format header", () => {
    expect(codeOf(() => validateInputActions({ format: "ignifx.scene", formatVersion: 1, maps: [] }, "x"))).toBe(
      "IGX-0805",
    );
  });

  it("rejects a format version this build cannot read", () => {
    expect(codeOf(() => validateInputActions({ format: INPUT_ACTIONS_FORMAT, formatVersion: 2, maps: [] }, "x"))).toBe(
      "IGX-0805",
    );
  });

  it("rejects a missing maps array", () => {
    expect(codeOf(() => validateInputActions({ format: INPUT_ACTIONS_FORMAT, formatVersion: 1 }, "x"))).toBe(
      "IGX-0805",
    );
  });

  it("rejects a malformed map, action, or binding", () => {
    const base = { format: INPUT_ACTIONS_FORMAT, formatVersion: 1 };
    expect(codeOf(() => validateInputActions({ ...base, maps: [7] }, "x"))).toBe("IGX-0805");
    expect(codeOf(() => validateInputActions({ ...base, maps: [{ actions: [] }] }, "x"))).toBe("IGX-0805");
    expect(codeOf(() => validateInputActions({ ...base, maps: [{ name: "P" }] }, "x"))).toBe("IGX-0805");
    expect(codeOf(() => validateInputActions({ ...base, maps: [{ name: "P", actions: [7] }] }, "x"))).toBe("IGX-0805");
    expect(codeOf(() => validateInputActions({ ...base, maps: [{ name: "P", actions: [{ name: "a" }] }] }, "x"))).toBe(
      "IGX-0805",
    );
    expect(
      codeOf(() =>
        validateInputActions(
          { ...base, maps: [{ name: "P", actions: [{ name: "a", type: "quat", bindings: [] }] }] },
          "x",
        ),
      ),
    ).toBe("IGX-0805");
    expect(
      codeOf(() =>
        validateInputActions({ ...base, maps: [{ name: "P", actions: [{ name: "a", bindings: [{}] }] }] }, "x"),
      ),
    ).toBe("IGX-0805");
    expect(
      codeOf(() =>
        validateInputActions(
          {
            ...base,
            maps: [{ name: "P", actions: [{ name: "a", bindings: [{ path: "<Keyboard>/a", processors: [7] }] }] }],
          },
          "x",
        ),
      ),
    ).toBe("IGX-0805");
  });

  it("rejects a malformed control scheme", () => {
    const base = { format: INPUT_ACTIONS_FORMAT, formatVersion: 1, maps: [] };
    expect(codeOf(() => validateInputActions({ ...base, controlSchemes: [7] }, "x"))).toBe("IGX-0805");
    expect(codeOf(() => validateInputActions({ ...base, controlSchemes: [{ name: "K" }] }, "x"))).toBe("IGX-0805");
    expect(codeOf(() => validateInputActions({ ...base, controlSchemes: [{ name: "K", devices: [7] }] }, "x"))).toBe(
      "IGX-0805",
    );
  });

  it("ignores a controlSchemes value that is not an array", () => {
    const document = { format: INPUT_ACTIONS_FORMAT, formatVersion: 1, controlSchemes: 7, maps: [] };
    expect(validateInputActions(document, "x").controlSchemes).toEqual([]);
  });
});

describe("defineInputActions", () => {
  it("fills in the format header", () => {
    const document = defineInputActions({ maps: [] });
    expect(document.format).toBe(INPUT_ACTIONS_FORMAT);
    expect(document.formatVersion).toBe(1);
    expect(document.controlSchemes).toEqual([]);
  });

  it("keeps an explicit version and scheme list", () => {
    const document = defineInputActions({
      formatVersion: 1,
      controlSchemes: [{ name: "Gamepad", devices: ["Gamepad"] }],
      maps: [],
    });
    expect(document.controlSchemes).toHaveLength(1);
  });
});

describe("the JSON schema", () => {
  it("describes the document the loader accepts", () => {
    const schema = inputActionsJsonSchema();
    expect(schema["$id"]).toBe("https://ignifx.com/schemas/ignifx.inputactions.v1.json");
    expect(schema["required"]).toEqual(["format", "formatVersion", "maps"]);
  });
});
