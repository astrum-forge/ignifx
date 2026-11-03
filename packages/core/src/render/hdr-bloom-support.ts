import type { HdrBloom } from "../lite/gpu/bloom-hdr.js";
import type { HdrOutputHandle } from "../lite/gpu/render-path.js";
import type { LiteEngine, LiteScene } from "../lite/scene.js";

/**
 * The gate `PostProcessStack` reaches HDR bloom through (`docs/plan/2026-11-gi-phase-1-execution-plan.md`,
 * step G12). The chain is its own chunk, imported the first time a stack asks for bloom while
 * `rendering.hdr` is on, so a project without both loads none of it (`CONSTITUTION.md` §2.5).
 */

/** The part of `../lite/gpu/bloom-hdr.ts` the stack calls. */
export interface HdrBloomSupport {
  /** Builds the chain and inserts it before the HDR output pass. */
  installHdrBloom(engine: LiteEngine, scene: LiteScene, hdr: HdrOutputHandle, isFrameGraphBuilt: boolean): HdrBloom;
}

/** The loaded module, memoised for the process. */
let layer: HdrBloomSupport | null = null;

/** The pending import, so concurrent callers share it. */
let loading: Promise<HdrBloomSupport> | null = null;

/**
 * Loads the HDR bloom chunk, once per process.
 *
 * @returns The module.
 *
 * @internal
 */
export async function loadHdrBloomSupport(): Promise<HdrBloomSupport> {
  // The annotation is what checks the interface against the module it stands for.
  loading ??= import("../lite/gpu/bloom-hdr.js").then((module: HdrBloomSupport) => {
    layer = module;
    return module;
  });
  return loading;
}

/**
 * The HDR bloom chunk, if it has been loaded.
 *
 * @returns The module, or `null` before {@link loadHdrBloomSupport} settled.
 *
 * @internal
 */
export function hdrBloomSupport(): HdrBloomSupport | null {
  return layer;
}
