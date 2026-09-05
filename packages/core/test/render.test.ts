import { describe, expect, it } from "vitest";
import { createRenderEngine, disposeRenderEngine, IgnifxError } from "../src/index.js";

/**
 * Node-side contract of the rendering adapter. The GPU path itself lives in
 * `engine.browser.test.ts`; here we prove the WebGPU capability gate and the nominal guards,
 * which are exactly the parts that must behave correctly when WebGPU is absent.
 */
describe("render adapter without WebGPU", () => {
  it("rejects with IGX-0001 when navigator.gpu is absent", async () => {
    await expect(createRenderEngine(null as never)).rejects.toThrow(IgnifxError);
    await createRenderEngine(null as never).catch((error: unknown) => {
      expect(error).toBeInstanceOf(IgnifxError);
      expect((error as IgnifxError).code).toBe("IGX-0001");
    });
  });

  it("rejects objects it did not create", () => {
    const foreign = { lite: { engine: undefined }, isDisposed: false };
    expect(() => disposeRenderEngine(foreign as never)).toThrow(/createRenderEngine/u);
  });
});
