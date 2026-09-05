import { afterEach, describe, expect, it } from "vitest";
import { InputActionsAsset, PlayerInput, pinToDeviceSlot } from "../../src/index.js";
import { createInputApp, demoActions, required } from "../support/app.js";
import type { InputAppHarness } from "../support/app.js";

let harness: InputAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Publishes the demo document as an in-memory asset and returns its handle. */
async function withAsset(): Promise<InputAppHarness> {
  const built = await createInputApp();
  harness = built;
  return built;
}

describe("pinToDeviceSlot", () => {
  it("rewrites gamepad paths and leaves everything else alone", () => {
    const pinned = pinToDeviceSlot(demoActions(), 2, "");
    const move = required(required(pinned.maps[0], "the Player map").actions[0], "the move action");
    expect(required(move.bindings[0], "the composite binding").up).toBe("<Keyboard>/w");
    expect(required(move.bindings[1], "the stick binding").path).toBe("<Gamepad>{2}/leftStick");
  });

  it("leaves a path that already names a slot alone", () => {
    const document = pinToDeviceSlot(
      {
        format: "ignifx.inputactions",
        formatVersion: 1,
        controlSchemes: [],
        maps: [{ name: "P", actions: [{ name: "a", bindings: [{ path: "<Gamepad>{3}/buttonSouth" }] }] }],
      },
      1,
      "",
    );
    const action = required(required(document.maps[0], "the map").actions[0], "the action");
    expect(required(action.bindings[0], "the binding").path).toBe("<Gamepad>{3}/buttonSouth");
  });

  it("drops bindings tagged with another scheme when a scheme is named", () => {
    const pinned = pinToDeviceSlot(demoActions(), 0, "Gamepad");
    const map = required(pinned.maps[0], "the Player map");
    const move = required(map.actions[0], "the move action");
    expect(move.bindings).toHaveLength(1);
    expect(required(move.bindings[0], "the stick binding").path).toBe("<Gamepad>{0}/leftStick");
    // An untagged binding belongs to every scheme and survives.
    expect(required(map.actions[1], "the jump action").bindings).toHaveLength(2);
  });
});

describe("PlayerInput", () => {
  it("declares the documented type id and schema fields", () => {
    expect(PlayerInput.typeId).toBe("ignifx/PlayerInput");
    expect(Object.keys(PlayerInput.schema)).toEqual(["actions", "deviceSlot", "scheme"]);
  });

  it("builds a private copy of the maps bound to its slot", async () => {
    const built = await withAsset();
    const handle = built.app.assets.register(new InputActionsAsset("", demoActions()), {
      type: "inputactions",
    });
    const entity = built.app.world.createEntity("player two");
    const player = entity.addComponent(PlayerInput, { actions: handle, deviceSlot: 1 });
    expect(player.input).not.toBeNull();
    built.app.input.simulate({ "<Gamepad>{1}/leftStick": { x: 1, y: 0 } });
    built.step();
    expect(player.input?.get("move").vector.x).toBeCloseTo(1, 5);
    // Slot 0 is a different pad, so the shared service's own maps see nothing.
    built.app.input.loadActions(demoActions());
    built.step();
    expect(built.app.input.actions.get("move").vector.x).toBe(0);
  });

  it("keeps two players' action state separate", async () => {
    const built = await withAsset();
    const handle = built.app.assets.register(new InputActionsAsset("", demoActions()), { type: "inputactions" });
    const one = built.app.world.createEntity("p1").addComponent(PlayerInput, { actions: handle, deviceSlot: 0 });
    const two = built.app.world.createEntity("p2").addComponent(PlayerInput, { actions: handle, deviceSlot: 1 });
    built.app.input.simulate({ "<Gamepad>{0}/buttonSouth": 1 });
    built.step();
    expect(one.input?.get("jump").isPressed).toBe(true);
    expect(two.input?.get("jump").isPressed).toBe(false);
  });

  it("reports no lookup until a loaded document is assigned", async () => {
    const built = await withAsset();
    const entity = built.app.world.createEntity("player");
    const player = entity.addComponent(PlayerInput);
    expect(player.input).toBeNull();
    expect(player.rebuild()).toBe(false);
    const handle = built.app.assets.register(new InputActionsAsset("", demoActions()), { type: "inputactions" });
    player.actions = handle;
    expect(player.rebuild()).toBe(true);
    expect(player.input).not.toBeNull();
  });

  it("stops resolving once the component is removed", async () => {
    const built = await withAsset();
    const handle = built.app.assets.register(new InputActionsAsset("", demoActions()), { type: "inputactions" });
    const entity = built.app.world.createEntity("player");
    const player = entity.addComponent(PlayerInput, { actions: handle });
    const view = player.input;
    expect(view).not.toBeNull();
    entity.destroyImmediate();
    built.step();
    expect(player.input).toBeNull();
  });

  it("filters bindings by the scheme field", async () => {
    const built = await withAsset();
    const handle = built.app.assets.register(new InputActionsAsset("", demoActions()), { type: "inputactions" });
    const player = built.app.world.createEntity("p").addComponent(PlayerInput, { actions: handle, scheme: "Gamepad" });
    built.app.input.simulate({ "<Keyboard>/d": 1 });
    built.step();
    expect(player.input?.get("move").vector.x).toBe(0);
  });
});
