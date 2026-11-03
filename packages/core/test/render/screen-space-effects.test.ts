import { afterEach, describe, expect, it, vi } from "vitest";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { ScreenSpaceEffects } from "../../src/render/screen-space-effects.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { RendererImpl } from "../../src/render/renderer.js";

/**
 * When `ScreenSpaceEffects` builds, rebuilds and tears down contact shadows and SSGI (GI plan G10,
 * G11), over a fake renderer and fake GPU chunks. What the passes draw is
 * `screen-space-effects.browser.test.ts`; this file pins the build key and the lifecycle around it.
 */

const gpu = vi.hoisted(() => ({
  contact: [] as { update: ReturnType<typeof vi.fn> }[],
  ssgi: [] as { update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; usePlugin: boolean }[],
  installed: [] as { taskCount: number; dispose: ReturnType<typeof vi.fn> }[],
  failInstall: false,
}));

vi.mock("../../src/lite/gpu/contact-shadows.js", () => ({
  createContactShadowsPass: () => {
    const pass = { update: vi.fn() };
    gpu.contact.push(pass);
    return pass;
  },
}));

vi.mock("../../src/lite/gpu/ssgi.js", () => ({
  createSsgiPass: (_e: unknown, _s: unknown, _d: unknown, _c: unknown, options: { usePlugin: boolean }) => {
    const pass = { update: vi.fn(), dispose: vi.fn(), usePlugin: options.usePlugin };
    gpu.ssgi.push(pass);
    return pass;
  },
}));

vi.mock("../../src/lite/gpu/scene-color-passes.js", () => ({
  installSceneColorPasses: (_e: unknown, _s: unknown, _p: unknown, passes: readonly unknown[]) => {
    if (gpu.failInstall) {
      throw new Error("install failed");
    }
    const installed = { taskCount: passes.length, dispose: vi.fn() };
    gpu.installed.push(installed);
    return installed;
  },
}));

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
  gpu.contact.length = 0;
  gpu.ssgi.length = 0;
  gpu.installed.length = 0;
  gpu.failInstall = false;
});

/** A renderer with only what `ScreenSpaceEffects` reads. */
interface FakeRenderer {
  isHeadless: boolean;
  presenter: object | null;
  scene: { camera: object | null };
  engine: object;
  isSceneRegistered: boolean;
  settings: { hdr: boolean };
  features: { materialPlugins: boolean };
  errors: string[];
  releases: number;
  inputsAvailable: boolean;
  app: { log: { error: (message: string) => void } };
  acquireSceneInputs: () => Promise<{ depthTarget: object; release: () => void } | null>;
}

/**
 * Builds a fake renderer.
 *
 * @returns The fake.
 */
function fakeRenderer(): FakeRenderer {
  const fake: FakeRenderer = {
    isHeadless: false,
    presenter: {},
    scene: { camera: {} },
    engine: {},
    isSceneRegistered: true,
    settings: { hdr: false },
    features: { materialPlugins: false },
    errors: [],
    releases: 0,
    inputsAvailable: true,
    app: {
      log: {
        error: (message: string): void => {
          fake.errors.push(message);
        },
      },
    },
    acquireSceneInputs: () =>
      Promise.resolve(
        fake.inputsAvailable
          ? {
              depthTarget: {},
              release: (): void => {
                fake.releases += 1;
              },
            }
          : null,
      ),
  };
  return fake;
}

/**
 * The fake as the renderer type `sync` takes.
 *
 * @param fake - The fake.
 * @returns The same object.
 */
function asRenderer(fake: FakeRenderer): RendererImpl {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return fake as unknown as RendererImpl;
}

/** Lets the dynamic imports and the build settle. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10);
  });
}

/**
 * Fresh records, as a stack declares them.
 *
 * @returns The two records.
 */
function records(): Pick<PostProcessStack, "contactShadows" | "ssgi"> {
  const stack = new PostProcessStack();
  return { contactShadows: { ...stack.contactShadows }, ssgi: { ...stack.ssgi } };
}

describe("ScreenSpaceEffects", () => {
  it("builds nothing while both records are off, the stack is disabled, or there is no device", async () => {
    const effects = new ScreenSpaceEffects();
    const fake = fakeRenderer();
    const { contactShadows, ssgi } = records();
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    contactShadows.enabled = true;
    effects.sync(asRenderer(fake), contactShadows, ssgi, false);
    fake.isHeadless = true;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    fake.isHeadless = false;
    fake.presenter = null;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    fake.presenter = {};
    fake.scene.camera = null;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    await settle();
    expect(effects.isBuilt).toBe(false);
    expect(effects.taskCount).toBe(0);
    expect(gpu.installed).toHaveLength(0);
  });

  it("builds contact shadows alone, then pushes live tuning without rebuilding", async () => {
    const effects = new ScreenSpaceEffects();
    const fake = fakeRenderer();
    const { contactShadows, ssgi } = records();
    contactShadows.enabled = true;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    await settle();
    expect(effects.isBuilt).toBe(true);
    expect(effects.taskCount).toBe(1);
    expect(gpu.contact).toHaveLength(1);
    expect(gpu.ssgi).toHaveLength(0);
    contactShadows.intensity = 2;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    expect(gpu.contact[0]?.update).toHaveBeenLastCalledWith(contactShadows);
    expect(gpu.installed).toHaveLength(1);
    effects.dispose(true);
    expect(effects.isBuilt).toBe(false);
    expect(gpu.installed[0]?.dispose).toHaveBeenCalledOnce();
    expect(fake.releases).toBe(1);
  });

  it("builds both, and rebuilds when SSGI's resolution or the camera changes", async () => {
    const effects = new ScreenSpaceEffects();
    const fake = fakeRenderer();
    fake.settings.hdr = true;
    const { contactShadows, ssgi } = records();
    contactShadows.enabled = true;
    ssgi.enabled = true;
    ssgi.halfResolution = true;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    await settle();
    expect(effects.taskCount).toBe(2);
    expect(gpu.ssgi[0]?.usePlugin).toBe(true);
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    expect(gpu.ssgi[0]?.update).toHaveBeenLastCalledWith(ssgi, true);

    ssgi.halfResolution = false;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    expect(gpu.ssgi[0]?.dispose).toHaveBeenCalledWith(true);
    await settle();
    expect(gpu.installed).toHaveLength(2);

    fake.scene.camera = {};
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    await settle();
    expect(gpu.installed).toHaveLength(3);
    expect(fake.releases).toBe(2);
    effects.dispose(false);
  });

  it("builds SSGI alone without the plugin when neither hdr nor material plugins are on", async () => {
    const effects = new ScreenSpaceEffects();
    const fake = fakeRenderer();
    const { contactShadows, ssgi } = records();
    ssgi.enabled = true;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    await settle();
    expect(gpu.contact).toHaveLength(0);
    expect(gpu.ssgi[0]?.usePlugin).toBe(false);
    // Nothing in the key changed, so the pass is only re-tuned.
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    expect(gpu.installed).toHaveLength(1);
    effects.dispose(false);
  });

  it("drops a build that a newer sync superseded, releasing its inputs", async () => {
    const effects = new ScreenSpaceEffects();
    const fake = fakeRenderer();
    const { contactShadows, ssgi } = records();
    contactShadows.enabled = true;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    effects.sync(asRenderer(fake), contactShadows, ssgi, false);
    await settle();
    expect(effects.isBuilt).toBe(false);
    expect(gpu.installed).toHaveLength(0);
    expect(fake.releases).toBe(1);
  });

  it("builds nothing when the scene inputs are unavailable", async () => {
    const effects = new ScreenSpaceEffects();
    const fake = fakeRenderer();
    fake.inputsAvailable = false;
    const { contactShadows, ssgi } = records();
    contactShadows.enabled = true;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    await settle();
    expect(effects.isBuilt).toBe(false);
    // With nothing built, a sync with the same key does nothing.
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    expect(gpu.contact).toHaveLength(0);
  });

  it("logs a build that throws", async () => {
    gpu.failInstall = true;
    const effects = new ScreenSpaceEffects();
    const fake = fakeRenderer();
    const { contactShadows, ssgi } = records();
    contactShadows.enabled = true;
    effects.sync(asRenderer(fake), contactShadows, ssgi, true);
    await settle();
    expect(effects.isBuilt).toBe(false);
    expect(fake.errors).toEqual(["PostProcessStack could not build contact shadows or SSGI: install failed"]);
  });
});

describe("a stack that asks for contact shadows or SSGI", () => {
  it("warns once when the postProcessing opt-in is off, counting both as effects", async () => {
    harness = await createRenderHarness();
    const stack = harness.world.createEntity("Eye").addComponent(PostProcessStack);
    stack.contactShadows.enabled = true;
    stack.ssgi.enabled = true;
    harness.frame();
    harness.frame();
    const warnings = harness.log.toArray().filter((record) => record.message.includes("post-processing"));
    expect(warnings).toHaveLength(1);
    expect(stack.taskCount).toBe(0);
  });
});
