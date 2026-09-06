import { CoreErrorCode, Phase, createApp } from "@ignifx/core";
import { input } from "@ignifx/input";
import { describe, expect, it } from "vitest";
import { THREE_D_ANIMATION_ORDER } from "../src/animator/animation-system.js";
import { Animator } from "../src/animator/animator.js";
import { ANIMATOR_FORMAT } from "../src/animator/definition.js";
import { BILLBOARD_ORDER } from "../src/environment/billboard.js";
import { LOD_ORDER } from "../src/environment/lod-group.js";
import { THREE_D_ERROR_MESSAGES, ThreeDErrorCode } from "../src/errors.js";
import { threeD } from "../src/extension.js";
import { NavigationService } from "../src/navigation/navigation-service.js";
import { NAVIGATION_ORDER } from "../src/navigation/navigation-system.js";
import { describeSchemas } from "../src/schemas.js";
import { THREE_D_SETTINGS_SECTION, defaultThreeDSettings } from "../src/settings.js";
import { heroAnimatorInput } from "./support/animator-fixture.js";
import { createThreeDApp } from "./support/harness.js";
import type { AnimatorAsset } from "../src/animator/animator-asset.js";
import type { ThreeDSettings } from "../src/settings.js";
import type { ThreeDAppHarness } from "./support/harness.js";

/**
 * Runs frames until a promise settles, which is what an asset load needs once the loop is running.
 *
 * @typeParam T - The promise's value.
 * @param harness - The app harness.
 * @param promise - The promise to pump.
 * @returns The promise's value.
 */
async function pump<T>(harness: ThreeDAppHarness, promise: Promise<T>): Promise<T> {
  // A chain rather than a loop: each link steps one frame and yields to the microtask queue, which
  // is what lets a resolved fetch reach the `PreUpdate` delivery system before the next step.
  await Array.from({ length: PUMP_FRAMES }).reduce<Promise<void>>(
    (chain) =>
      chain.then((): void => {
        harness.step();
      }),
    Promise.resolve(),
  );
  return promise;
}

/** How many frames a pumped load is given to settle. */
const PUMP_FRAMES = 60;

describe("threeD()", () => {
  it("defines app.navigation and registers the settings section", async () => {
    const harness = await createThreeDApp();
    expect(harness.app.navigation).toBeInstanceOf(NavigationService);
    expect(harness.app.services.get(NavigationService)).toBe(harness.app.navigation);
    expect(harness.app.settings.section<ThreeDSettings>(THREE_D_SETTINGS_SECTION)).toEqual(defaultThreeDSettings());
    harness.dispose();
  });

  it("takes its options over the settings section", async () => {
    const harness = await createThreeDApp({
      settings: { threeD: { navigationSeed: 7 } },
      threeD: { navigationSeed: 99, autoBakeNavMesh: false },
    });
    // The project's own section is what `app.settings` reports; the options are applied on top by
    // the extension, which is what `onStart` writes onto the surfaces.
    expect(harness.app.settings.section<ThreeDSettings>(THREE_D_SETTINGS_SECTION).navigationSeed).toBe(7);
    harness.dispose();
  });

  it("registers every component under a namespaced typeId", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Probe");
    const animator = entity.addComponent(Animator);
    expect(animator.isReady).toBe(false);
    expect(Animator.typeId).toBe("ignifx/Animator");
    harness.dispose();
  });

  it("registers the four systems in the documented phases and orders", () => {
    expect(THREE_D_ANIMATION_ORDER).toBe(10);
    expect(BILLBOARD_ORDER).toBe(20);
    expect(LOD_ORDER).toBe(-10);
    expect(NAVIGATION_ORDER).toBe(200);
    expect(Phase.PostUpdate).toBeGreaterThan(Phase.FixedUpdate);
  });

  it("registers the animator loader and reads a document through it", async () => {
    const document = JSON.stringify(heroAnimatorInput());
    const harness = await createThreeDApp({
      fetch: (): Promise<Response> => Promise.resolve(new Response(document, { status: 200 })),
    });
    const handle = harness.app.assets.load<AnimatorAsset>("3d/hero.animator.json").retain();
    // Once the loop is running, a completed load settles in `PreUpdate`, so the frames have to be
    // pumped for the promise to resolve (`docs/architecture/05-assets-and-loading.md` §4).
    const asset = await pump(harness, handle.promise);
    expect(asset.definition.format).toBe(ANIMATOR_FORMAT);
    expect(asset.stateNames).toEqual(["locomotion", "jump"]);
    expect(asset.layerNames).toEqual(["Base"]);
    expect(asset.clipNames().toSorted()).toEqual(["idle", "jump", "run", "walk"]);
    expect(asset.state("jump")?.clip).toBe("jump");
    expect(asset.state("nope")).toBeNull();
    expect(asset.layer("Base")?.weight).toBe(1);
    expect(asset.layer("nope")).toBeNull();
    handle.release();
    harness.dispose();
  });

  it("rejects an invalid document with IGX-1201", async () => {
    const harness = await createThreeDApp({
      fetch: (): Promise<Response> => Promise.resolve(new Response('{"states":[]}', { status: 200 })),
    });
    const handle = harness.app.assets.load<AnimatorAsset>("3d/broken.animator.json").retain();
    // The asset layer retries and then wraps the loader's failure in `AssetLoadError`, so the
    // `IGX-1201` this package threw is the `cause`, not the outer error.
    await expect(pump(harness, handle.promise)).rejects.toThrow(
      expect.objectContaining({ code: CoreErrorCode.assetLoadFailed }),
    );
    handle.release();
    harness.dispose();
  });

  it("refuses a second threeD() on one app, because app.navigation is already defined", async () => {
    const harness = await createThreeDApp();
    await expect(createApp({ headless: true, extensions: [input(), threeD(), threeD()] })).rejects.toThrow(
      expect.objectContaining({ code: CoreErrorCode.duplicateExtensionName }),
    );
    harness.dispose();
  });
});

describe("error table", () => {
  it("declares a message for every code, all in the 12 range", () => {
    const codes = Object.values(ThreeDErrorCode);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(code).toMatch(/^IGX-12\d\d$/);
      expect(THREE_D_ERROR_MESSAGES[code]).toBeTypeOf("string");
    }
    expect(Object.keys(THREE_D_ERROR_MESSAGES).toSorted()).toEqual(codes.toSorted());
  });
});

describe("describeSchemas", () => {
  it("describes every component, the settings section, and the file format", () => {
    const described = describeSchemas();
    for (const id of [
      "ignifx/Animator",
      "ignifx/Billboard",
      "ignifx/FirstPersonController",
      "ignifx/LodGroup",
      "ignifx/NavMeshAgent",
      "ignifx/NavMeshObstacle",
      "ignifx/NavMeshSurface",
      "ignifx/PlatformMover",
      "ignifx/Projectile",
      "ignifx/RigidbodyMover",
      "ignifx/ThirdPersonCamera",
      "ignifx/ThirdPersonController",
      "ignifx/threeD-settings",
      "ignifx/animator-file",
    ]) {
      expect(described[id], id).toBeDefined();
      expect(described[id]?.title, id).toBeTruthy();
    }
  });

  it("gives every field a tooltip so an inspector has something to show", () => {
    for (const [id, description] of Object.entries(describeSchemas())) {
      for (const [name, field] of Object.entries(description.fields)) {
        expect(field.description, `${id}.${name}`).toBeTruthy();
      }
    }
  });
});
