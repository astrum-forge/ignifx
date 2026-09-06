/**
 * Origin arithmetic for the main process.
 *
 * ## Why `URL.origin` is not enough
 *
 * `ignifx` is a **privileged** scheme inside Chromium — `registerSchemesAsPrivileged` declares it
 * `standard`, which is what gives `ignifx://app` a real, hierarchical, tuple origin — but it is not
 * a *special* scheme to the WHATWG URL parser that Node (and therefore the main process) uses.
 * Measured on Node 25.2.1:
 *
 * ```
 * new URL("ignifx://app/index.html").origin  // "null"
 * new URL("ignifx://evil/index.html").origin // "null"
 * ```
 *
 * Both collapse to the string `"null"`, so an equality test written on `URL.origin` compares
 * `"null"` with `"null"` and passes for **every** `ignifx://` authority. {@link originOfUrl}
 * rebuilds the tuple from `protocol` and `host` instead, which is the value Chromium itself reports
 * as the frame's origin for a `standard` scheme.
 */

/**
 * The origin of a URL, as `scheme://host[:port]`.
 *
 * @remarks
 * Returns `null` — never a guess — for anything with no tuple origin: a URL that does not parse, an
 * opaque-origin URL such as `data:`, `blob:`, `javascript:` or `file:`, and a scheme-relative
 * reference. A `null` result is a refusal at every call site, so a new URL form is denied rather
 * than quietly admitted.
 *
 * @param url - The URL to read.
 * @returns The origin, or `null` when the URL has no tuple origin.
 *
 * @example
 * ```ts
 * originOfUrl("ignifx://app/index.html"); // "ignifx://app"
 * originOfUrl("http://localhost:5173/");  // "http://localhost:5173"
 * originOfUrl("file:///etc/passwd");      // null
 * ```
 *
 * @public
 */
export function originOfUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // A parser that already knows the scheme gives the tuple directly; `"null"` is the WHATWG
  // spelling of "opaque origin", which is exactly what must not be treated as an origin.
  if (parsed.origin !== "null" && parsed.origin !== "") {
    return parsed.origin;
  }
  if (parsed.host === "") {
    return null;
  }
  return `${parsed.protocol}//${parsed.host}`;
}
