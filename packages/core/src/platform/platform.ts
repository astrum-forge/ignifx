import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";

/**
 * `app.platform`: what the engine knows about the host it is running on
 * (`docs/architecture/14-platform-electron.md` §1). Extensions branch on it — the input extension to
 * decide whether pointer lock is worth offering, the renderer to size its budgets — and game code
 * rarely should.
 *
 * ## Decisions the documents left open
 *
 * - **Detection is a pure function of a `PlatformHost` record.** §1 says the service is
 *   "populated at `createApp`" and nothing else. Reading the globals and *interpreting* them are
 *   two different jobs, and only the first one needs a browser: `readPlatformHost` scrapes
 *   `globalThis` and `detectPlatform` turns the result into a {@link PlatformInfo}. That is
 *   what lets the whole of the interpretation — every operating system, every mobile heuristic — be
 *   unit-tested under Node with a fabricated host.
 * - **`kind` is `"browser"` until something proves otherwise.** An Electron renderer *is* a browser
 *   as far as the kernel can tell; guessing from the user agent would be worse than being honest.
 *   `@ignifx/electron` detects its own preload bridge and calls
 *   `platformInternals(app.platform).setKind("electron")`, which is the one supported mutation.
 * - **`webgpu` describes the adapter, not the device.** Babylon Lite's public `index.d.ts` (v1.27.0)
 *   exposes neither the `GPUAdapter` nor the `GPUDevice` it acquired — `EngineContext` declares only
 *   `surfaces`, `drawCallCount`, `gpuFrameTimeMs`, `useHighPrecisionMatrix` and `useFloatingOrigin`
 *   — so reaching the engine's device would mean an assertion onto an undocumented `_device`
 *   property. `createApp` asks `navigator.gpu` for a *second* adapter instead, which costs nothing
 *   (an adapter is not a device) and reports what the hardware can do rather than what Lite asked
 *   for. `features` and `limits` are therefore an upper bound on the running device's.
 * - **Every field is plain data.** `features` is a sorted string array and `limits` a number record,
 *   not the live `GPUSupportedFeatures`/`GPUSupportedLimits` objects, so the whole record survives
 *   `JSON.stringify` into a bug report or a devtools panel.
 */

/**
 * Where an app is running.
 *
 * @public
 */
export type PlatformKind = "browser" | "electron" | "node";

/**
 * Which operating system the host runs, as far as it will admit.
 *
 * @remarks
 * `"unknown"` is a real answer, not a failure: a locked-down browser that freezes its user agent
 * and exposes no `navigator.userAgentData` genuinely does not say, and code that branches on the
 * operating system has to have a default anyway.
 *
 * @public
 */
export type PlatformOs = "macos" | "windows" | "linux" | "ios" | "android" | "unknown";

/**
 * Who made the GPU, as WebGPU reports it.
 *
 * @remarks
 * Browsers deliberately blur these strings — most return an empty `architecture` and `device` on
 * the default, non-`unmaskHints` path — so treat every field as a hint for a bug report rather than
 * as something to branch on.
 *
 * @public
 */
export interface GpuAdapterInfo {
  /** The GPU vendor, `"apple"` or `"nvidia"`; `""` when the browser withholds it. */
  readonly vendor: string;
  /** The GPU family, `"metal-3"`; `""` when the browser withholds it. */
  readonly architecture: string;
  /** The specific device; `""` when the browser withholds it. */
  readonly device: string;
  /** A human-readable summary; `""` when the browser withholds it. */
  readonly description: string;
}

/**
 * What the host's WebGPU adapter offers.
 *
 * @public
 */
export interface WebGpuInfo {
  /** Who made the adapter. */
  readonly adapterInfo: GpuAdapterInfo;
  /** The optional features the adapter supports, sorted ascending. */
  readonly features: readonly string[];
  /** The adapter's limits, by their WebGPU names. */
  readonly limits: Readonly<Record<string, number>>;
}

/**
 * What the kernel knows about the host, reached as `app.platform`.
 *
 * @example
 * ```ts
 * if (app.platform.isMobile) {
 *   app.renderer.resolutionScale = 0.75;
 * }
 * if (app.platform.reducedMotion) {
 *   disableScreenShake();
 * }
 * ```
 *
 * @public
 */
export interface PlatformInfo {
  /** Whether the app runs in a document, in an Electron renderer, or in a bare JavaScript runtime. */
  readonly kind: PlatformKind;
  /** The operating system, or `"unknown"` when the host does not say. */
  readonly os: PlatformOs;
  /** `true` on a phone or a tablet. */
  readonly isMobile: boolean;
  /** `true` when the host implements the Pointer Lock API. */
  readonly hasPointerLock: boolean;
  /** `true` when the host implements the Gamepad API. */
  readonly hasGamepads: boolean;
  /** What WebGPU offers, or `null` in a headless app and on a host with no WebGPU. */
  readonly webgpu: WebGpuInfo | null;
  /** The host's BCP 47 language tag, `"en-AU"`. Never empty. */
  readonly locale: string;
  /** `true` when the user asked their system for reduced motion. */
  readonly reducedMotion: boolean;
}

/**
 * The raw host readings `detectPlatform` interprets. Every field is exactly one global read, so a
 * test can fabricate any host without touching `globalThis`.
 *
 * @internal
 */
export interface PlatformHost {
  /** `true` when both a `document` and a `window` are reachable. */
  readonly hasDocument: boolean;
  /** `navigator.userAgent`, or `null`. */
  readonly userAgent: string | null;
  /** The deprecated `navigator.platform`, or `null`. */
  readonly navigatorPlatform: string | null;
  /** `navigator.userAgentData.platform`, or `null` on a browser that has no client hints. */
  readonly userAgentDataPlatform: string | null;
  /** `navigator.userAgentData.mobile`, or `null` on a browser that has no client hints. */
  readonly userAgentDataMobile: boolean | null;
  /** `navigator.maxTouchPoints`, `0` when the host has none. */
  readonly maxTouchPoints: number;
  /** `true` when the document implements pointer lock. */
  readonly hasPointerLock: boolean;
  /** `true` when the navigator implements the Gamepad API. */
  readonly hasGamepads: boolean;
  /** The BCP 47 language tag the host reports. */
  readonly locale: string;
  /** `true` when `(prefers-reduced-motion: reduce)` matches. */
  readonly reducedMotion: boolean;
  /** Node's `process.platform`, or `null` outside Node. */
  readonly processPlatform: string | null;
}

/** How `process.platform` maps onto {@link PlatformOs}. */
const NODE_PLATFORMS: Readonly<Record<string, PlatformOs>> = {
  darwin: "macos",
  win32: "windows",
  linux: "linux",
  android: "android",
  freebsd: "linux",
  openbsd: "linux",
  sunos: "linux",
  aix: "linux",
};

/** How a client-hint or `navigator.platform` string maps onto {@link PlatformOs}. */
const BROWSER_PLATFORMS: readonly (readonly [string, PlatformOs])[] = [
  ["iphone", "ios"],
  ["ipad", "ios"],
  ["ipod", "ios"],
  ["ios", "ios"],
  ["android", "android"],
  ["macos", "macos"],
  ["mac", "macos"],
  ["windows", "windows"],
  ["win", "windows"],
  ["chrome os", "linux"],
  ["chromeos", "linux"],
  ["cros", "linux"],
  ["linux", "linux"],
  ["x11", "linux"],
];

/** How many simultaneous touches make a "Macintosh" an iPad. */
const IPAD_TOUCH_POINTS = 1;

/**
 * Maps a host-supplied platform or user-agent string onto an operating system.
 *
 * @param text - The string to inspect; matched case-insensitively.
 * @returns The operating system, or `null` when nothing matched.
 */
function matchOs(text: string): PlatformOs | null {
  const lowered = text.toLowerCase();
  for (let index = 0; index < BROWSER_PLATFORMS.length; index += 1) {
    const entry = BROWSER_PLATFORMS[index];
    if (entry !== undefined && lowered.includes(entry[0])) {
      return entry[1];
    }
  }
  return null;
}

/**
 * Works out the operating system of a host that is not Node.
 *
 * @param host - The host readings.
 * @returns The operating system.
 */
function browserOs(host: PlatformHost): PlatformOs {
  const hinted = host.userAgentDataPlatform;
  const matched =
    (hinted === null ? null : matchOs(hinted)) ??
    matchOs(host.navigatorPlatform ?? "") ??
    matchOs(host.userAgent ?? "");
  // iPadOS 13 and later report themselves as "Macintosh" in every string a page can read; the only
  // thing that separates an iPad from a Mac is that the iPad has a touch screen.
  if (matched === "macos" && host.maxTouchPoints > IPAD_TOUCH_POINTS) {
    return "ios";
  }
  return matched ?? "unknown";
}

/**
 * Works out whether the host is a phone or a tablet.
 *
 * @param host - The host readings.
 * @param os - The operating system already worked out.
 * @returns `true` on a mobile host.
 */
function detectMobile(host: PlatformHost, os: PlatformOs): boolean {
  if (host.userAgentDataMobile !== null) {
    // A tablet answers `mobile: false`, so the operating system still has the last word.
    return host.userAgentDataMobile || os === "ios" || os === "android";
  }
  return os === "ios" || os === "android";
}

/**
 * The mutable `PlatformInfo` the app owns.
 *
 * @internal
 */
export class PlatformInfoImpl implements PlatformInfo {
  /** The operating system. */
  readonly os: PlatformOs;

  /** `true` on a phone or a tablet. */
  readonly isMobile: boolean;

  /** `true` when the host implements pointer lock. */
  readonly hasPointerLock: boolean;

  /** `true` when the host implements the Gamepad API. */
  readonly hasGamepads: boolean;

  /** The host's BCP 47 language tag. */
  readonly locale: string;

  /** `true` when the user asked for reduced motion. */
  readonly reducedMotion: boolean;

  #kind: PlatformKind;

  #webgpu: WebGpuInfo | null = null;

  /**
   * Builds the record from one set of host readings.
   *
   * @param host - What `readPlatformHost` scraped, or what a test fabricated.
   */
  constructor(host: PlatformHost) {
    this.#kind = host.hasDocument ? "browser" : "node";
    const nodeOs = host.processPlatform === null ? null : (NODE_PLATFORMS[host.processPlatform] ?? "unknown");
    this.os = host.hasDocument || nodeOs === null ? browserOs(host) : nodeOs;
    this.isMobile = host.hasDocument && detectMobile(host, this.os);
    this.hasPointerLock = host.hasPointerLock;
    this.hasGamepads = host.hasGamepads;
    this.locale = host.locale;
    this.reducedMotion = host.reducedMotion;
  }

  /**
   * Where the app is running.
   *
   * @returns The host kind.
   */
  get kind(): PlatformKind {
    return this.#kind;
  }

  /**
   * What WebGPU offers.
   *
   * @returns The adapter report, or `null` in a headless app.
   */
  get webgpu(): WebGpuInfo | null {
    return this.#webgpu;
  }

  /**
   * Records that this browser is in fact an Electron renderer.
   *
   * @param kind - The host kind to report from now on.
   */
  setKind(kind: PlatformKind): void {
    this.#kind = kind;
  }

  /**
   * Records what the WebGPU adapter offered.
   *
   * @param webgpu - The adapter report, or `null` to clear it.
   */
  setWebGpu(webgpu: WebGpuInfo | null): void {
    this.#webgpu = webgpu;
  }
}

/**
 * Scrapes `globalThis` once.
 *
 * @returns One reading per host global, for `detectPlatform` to interpret.
 *
 * @internal
 */
export function readPlatformHost(): PlatformHost {
  const hasDocument = "document" in globalThis && "window" in globalThis;
  const host = hostNavigator();
  return {
    hasDocument,
    userAgent: readString(host, "userAgent"),
    navigatorPlatform: readString(host, "platform"),
    userAgentDataPlatform: readString(userAgentData(host), "platform"),
    userAgentDataMobile: userAgentDataMobile(host),
    maxTouchPoints: maxTouchPoints(host),
    hasPointerLock: hasDocument && "pointerLockElement" in globalThis.document,
    hasGamepads: host !== null && "getGamepads" in host,
    locale: readString(host, "language") ?? Intl.DateTimeFormat().resolvedOptions().locale,
    reducedMotion: "matchMedia" in globalThis && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
    processPlatform: hostProcessPlatform(),
  };
}

/**
 * Builds the platform record.
 *
 * @param host - The host readings; defaults to `readPlatformHost`'s.
 * @returns The record, with `webgpu` still `null` — `createApp` fills that in once it knows whether
 * the app has a canvas.
 *
 * @internal
 */
export function detectPlatform(host: PlatformHost = readPlatformHost()): PlatformInfoImpl {
  return new PlatformInfoImpl(host);
}

/**
 * Reaches the mutable half of `app.platform`, the way `rendererInternals` does for the renderer.
 * `@ignifx/electron` uses it to record that the browser it detected is an Electron renderer.
 *
 * @param platform - The record, normally `app.platform`.
 * @returns The implementation.
 * @throws IgnifxError with code `IGX-0702` when the record was not created by this copy of
 * `@ignifx/core`.
 *
 * @example
 * ```ts
 * platformInternals(app.platform).setKind("electron");
 * ```
 *
 * @internal
 */
export function platformInternals(platform: PlatformInfo): PlatformInfoImpl {
  if (platform instanceof PlatformInfoImpl) {
    return platform;
  }
  throw new IgnifxError(CoreErrorCode.invalidRuntime, "app.platform was not created by this copy of @ignifx/core.", {
    context: { member: "app.platform" },
    hint: "Reach the service through the app that created it.",
  });
}

/**
 * Reads one property off a host object the TypeScript DOM library does not declare —
 * `navigator.userAgentData`, Node's `process.platform`.
 *
 * @param source - The object to read from.
 * @param key - The property name; own or inherited.
 * @returns The value, or `undefined` when the property is absent.
 */
function readKey(source: object, key: string): unknown {
  // Boundary assertion (coding standards §5.2): these are host objects read by name, and no lib
  // declares `userAgentData` or a `process` global in a DOM-only type environment.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const view = source as Record<string, unknown>;
  return view[key];
}

/**
 * Reads a non-empty string property off a host object.
 *
 * @param source - The object to read from, or `null`.
 * @param key - The property name.
 * @returns The value, or `null` when it is absent, not a string, or empty.
 */
function readString(source: object | null, key: string): string | null {
  const found = source === null ? undefined : readKey(source, key);
  return typeof found === "string" && found.length > 0 ? found : null;
}

/**
 * The host's `navigator`, when it has one.
 *
 * @returns The object, or `null`.
 */
function hostNavigator(): object | null {
  const scope: object = globalThis;
  if (!("navigator" in scope)) {
    return null;
  }
  const found = scope.navigator;
  return typeof found === "object" && found !== null ? found : null;
}

/**
 * Reads `navigator.userAgentData`, which no TypeScript DOM library declares yet.
 *
 * @param host - The navigator object, or `null`.
 * @returns The client-hint object, or `null`.
 */
function userAgentData(host: object | null): object | null {
  const found = host === null ? undefined : readKey(host, "userAgentData");
  return typeof found === "object" && found !== null ? found : null;
}

/**
 * Reads `navigator.userAgentData.mobile`.
 *
 * @param host - The navigator object, or `null`.
 * @returns The mobile hint, or `null` on a browser that has no client hints.
 */
function userAgentDataMobile(host: object | null): boolean | null {
  const data = userAgentData(host);
  const found = data === null ? undefined : readKey(data, "mobile");
  return typeof found === "boolean" ? found : null;
}

/**
 * Reads `navigator.maxTouchPoints`.
 *
 * @param host - The navigator object, or `null`.
 * @returns The count, or `0`.
 */
function maxTouchPoints(host: object | null): number {
  const found = host === null ? undefined : readKey(host, "maxTouchPoints");
  return typeof found === "number" ? found : 0;
}

/**
 * Reads Node's `process.platform` without making `@ignifx/core` depend on `@types/node`.
 *
 * @returns The value, or `null` outside Node.
 */
function hostProcessPlatform(): string | null {
  const scope: object = globalThis;
  if (!("process" in scope)) {
    return null;
  }
  const host = scope.process;
  return typeof host === "object" && host !== null ? readString(host, "platform") : null;
}
