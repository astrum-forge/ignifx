/**
 * Apply CSP through response headers so it covers the full document and supports `frame-ancestors`.
 * Allow inline styles for UI widgets and templates, but never inline scripts or `unsafe-eval`.
 * The narrower `wasm-unsafe-eval` permission supports physics; `wasm: false` removes it.
 */

import { IGNIFX_ORIGIN } from "../host-contract.js";

/**
 * The protocols a game window may load a subresource from, beyond its own origin.
 *
 * @remarks
 * `data:` covers the inline fonts and the one-pixel textures a template embeds; `blob:` covers the
 * object URLs `@ignifx/audio` and the glTF loader create for decoded buffers. Neither can execute
 * script under this policy, because `script-src` does not list them.
 *
 * @public
 */
export const CSP_ASSET_SCHEMES: readonly string[] = Object.freeze(["data:", "blob:"]);

/**
 * What {@link cspFor} accepts.
 *
 * @public
 */
export interface CspOptions {
  /**
   * Where the renderer is loaded from.
   *
   * @defaultValue `"production"` — the packaged `ignifx://app` origin and nothing else.
   */
  readonly mode?: "production" | "development";
  /**
   * The dev server's origin, for example `"http://localhost:5173"`. Only consulted when `mode` is
   * `"development"`, where it is added to `default-src`, `script-src`, `style-src`, `img-src`,
   * `media-src`, `font-src`, and `connect-src`, and its `ws:`/`wss:` twin is added to
   * `connect-src` so that hot reload's socket connects.
   *
   * @defaultValue `null` — no dev server.
   */
  readonly devServerOrigin?: string | null;
  /**
   * Whether `script-src` carries `'wasm-unsafe-eval'`.
   *
   * @defaultValue `true` — the physics extensions need it, and it does not permit `eval`.
   */
  readonly wasm?: boolean;
  /**
   * Extra origins added to `connect-src`, for a game that talks to a backend.
   *
   * @defaultValue `[]` — a desktop build reaches nothing but itself.
   */
  readonly connectSources?: readonly string[];
}

/**
 * The directive names {@link cspFor} emits, in the order it emits them.
 *
 * @remarks
 * The order is fixed so that two calls with the same options produce byte-identical strings, which
 * is what lets the security-checklist test compare against a literal.
 *
 * @public
 */
export const CSP_DIRECTIVE_ORDER: readonly string[] = Object.freeze([
  "default-src",
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "media-src",
  "connect-src",
  "worker-src",
  "child-src",
  "object-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
  "frame-src",
  "manifest-src",
]);

/**
 * Turns an origin into the `ws:`/`wss:` origin its dev server's hot-reload socket uses.
 *
 * @param origin - An `http:` or `https:` origin.
 * @returns The websocket origin, or `null` when `origin` is neither.
 */
function websocketOriginOf(origin: string): string | null {
  if (origin.startsWith("http://")) {
    return `ws://${origin.slice("http://".length)}`;
  }
  if (origin.startsWith("https://")) {
    return `wss://${origin.slice("https://".length)}`;
  }
  return null;
}

/**
 * Builds the Content-Security-Policy header value for a game window.
 *
 * @remarks
 * Pure: it reads nothing from Electron and nothing from the file system, which is what lets the
 * security checklist assert the exact policy without launching a browser.
 *
 * @param options - The mode, the dev server, and the two widening switches.
 * @returns The header value, directives separated by `"; "`, with no trailing semicolon.
 *
 * @example
 * ```ts
 * cspFor();
 * // "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; …"
 * ```
 *
 * @public
 */
export function cspFor(options: CspOptions = {}): string {
  const isDevelopment = (options.mode ?? "production") === "development";
  const devOrigin = isDevelopment ? (options.devServerOrigin ?? null) : null;
  const dev: readonly string[] = devOrigin === null ? [] : [devOrigin];
  const socket = devOrigin === null ? null : websocketOriginOf(devOrigin);

  const self = "'self'";
  const assets = CSP_ASSET_SCHEMES;
  const script: string[] = [self, ...dev];
  if (options.wasm ?? true) {
    script.push("'wasm-unsafe-eval'");
  }
  const connect: string[] = [
    self,
    ...assets,
    ...dev,
    ...(socket === null ? [] : [socket]),
    ...(options.connectSources ?? []),
  ];

  const directives: Readonly<Record<string, readonly string[]>> = {
    // `'none'` rather than `'self'`: every fetching directive below is listed explicitly, so a
    // resource kind nobody thought about is refused instead of quietly inheriting the origin.
    "default-src": ["'none'"],
    "script-src": script,
    // See the module comment: inline styles are what `@ignifx/ui` and every template use.
    "style-src": [self, "'unsafe-inline'", ...dev],
    "img-src": [self, ...assets, ...dev],
    "font-src": [self, "data:", ...dev],
    "media-src": [self, ...assets, ...dev],
    "connect-src": connect,
    // Babylon Lite and the asset pipeline create workers from blob URLs.
    "worker-src": [self, "blob:"],
    "child-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    // Header-only, and the reason this policy is a header rather than a `<meta>` tag.
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "manifest-src": [self],
  };

  const parts: string[] = [];
  for (let index = 0; index < CSP_DIRECTIVE_ORDER.length; index += 1) {
    const name = CSP_DIRECTIVE_ORDER[index] ?? "";
    const values = directives[name] ?? [];
    parts.push(`${name} ${values.join(" ")}`);
  }
  return parts.join("; ");
}

/**
 * The policy a packaged build is served under: {@link cspFor} with every default.
 *
 * @remarks
 * A function rather than a constant, because a constant would have to call `cspFor()` at module
 * scope and coding standards §4 keeps module scope to declarations and immutable literals. It is
 * cheap: string concatenation over a fixed table, called once per window.
 *
 * `'self'` resolves to {@link PACKAGED_ORIGIN} in a packaged window, because that is the origin the
 * document was loaded from.
 *
 * @returns The header value.
 *
 * @example
 * ```ts
 * installCspHeader(window.webContents.session, defaultCsp());
 * ```
 *
 * @public
 */
export function defaultCsp(): string {
  return cspFor();
}

/**
 * The origin `'self'` resolves to in a packaged game window, quoted here so a test can say what it
 * is asserting.
 *
 * @public
 */
export const PACKAGED_ORIGIN: string = IGNIFX_ORIGIN;
