import { isWebGpuAvailable } from "../webgpu.js";
import type { WebGpuInfo } from "../platform.js";

/**
 * The one call that needs a real `navigator.gpu`: the adapter probe behind `app.platform.webgpu`
 * (`docs/architecture/14-platform-electron.md` §1). It is unreachable from Node, so this file sits
 * under `src/platform/web/**` and is covered by the Vitest `browser` project, under the same rule
 * as `src/lite/gpu/**`.
 *
 * Requesting an adapter is not requesting a device: it allocates nothing, cannot fail the way
 * `requestDevice` can, and leaves Babylon Lite's own adapter untouched (`requestAdapter` may be
 * called any number of times; only `requestDevice` consumes one).
 */

/**
 * Asks the host what its WebGPU adapter can do.
 *
 * @returns The adapter report, or `null` when the host exposes no `navigator.gpu`, when no adapter
 * is available, or when the request itself failed — an absent capability is an expected absence,
 * not an error (coding standards §5.5).
 *
 * @example
 * ```ts
 * const webgpu = await probeWebGpuInfo();
 * console.log(webgpu?.adapterInfo.vendor);
 * ```
 *
 * @internal
 */
export async function probeWebGpuInfo(): Promise<WebGpuInfo | null> {
  if (!isWebGpuAvailable()) {
    return null;
  }
  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch {
    return null;
  }
  if (adapter === null) {
    return null;
  }
  const features: string[] = [];
  for (const feature of adapter.features) {
    features.push(feature);
  }
  const limits: Record<string, number> = {};
  // `GPUSupportedLimits` declares its members on the prototype, so `Object.keys` returns nothing
  // and `for...in` is the only enumeration that sees them. The type declares no index signature,
  // which is what the assertion below models (coding standards §5.2).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const source = adapter.limits as unknown as Record<string, unknown>;
  for (const name in source) {
    const value = source[name];
    if (typeof value === "number") {
      limits[name] = value;
    }
  }
  const info = adapter.info;
  return {
    adapterInfo: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
    },
    features: features.toSorted(),
    limits,
  };
}
