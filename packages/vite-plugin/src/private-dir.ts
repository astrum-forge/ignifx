/**
 * Keeps `.ignifx/` off every server the plugin runs in. The ignifx editor writes per-project private
 * state there, among it `.ignifx/mcp.json` with the bearer token of the project's MCP server, and
 * Vite's CORS lets any `http://localhost:*` page read what the dev server answers.
 */

import type { Connect } from "vite";

/** The editor-private directory at a project's root. */
export const PRIVATE_DIR_NAME = ".ignifx";

/**
 * `server.fs.deny` patterns for the private directory. Vite matches a pattern without a `/` at any
 * depth, so `.ignifx` denies the directory itself wherever it is and the glob denies its contents.
 */
export const PRIVATE_DIR_DENY: readonly string[] = [PRIVATE_DIR_NAME, `**/${PRIVATE_DIR_NAME}/**`];

/**
 * Vite 8's own `server.fs.deny` defaults. A deny list returned from a `config` hook replaces them
 * when the user set none, so the plugin restates them; a test compares this list with Vite's.
 */
export const VITE_DEFAULT_FS_DENY: readonly string[] = [
  ".env",
  ".env.*",
  "*.{crt,pem,key,p12,pfx,cer,der}",
  ".npmrc",
  ".yarnrc.yml",
  "**/.git/**",
];

/** Percent-decoding passes before a path counts as private regardless of what it decodes to. */
const MAX_DECODE_PASSES = 8;

/** Windows 8.3 short names of `.ignifx` (`IGNIFX~1`), which resolve to it on NTFS. */
const SHORT_NAME_RE = /^ignifx~\d+$/u;

/**
 * The `server.fs.deny` list the plugin contributes to the user's config.
 *
 * @param userDeny - The deny list the config holds so far, or `undefined` when none is set.
 * @returns The patterns to return from the `config` hook. Vite concatenates them with a list the user
 * set; with none set, Vite's defaults come first so returning a list does not drop them.
 */
export function privateDirDenyPatterns(userDeny: readonly string[] | undefined): string[] {
  return userDeny === undefined ? [...VITE_DEFAULT_FS_DENY, ...PRIVATE_DIR_DENY] : [...PRIVATE_DIR_DENY];
}

/**
 * Decodes every `%XX` escape, byte by byte, so a malformed sequence never stops decoding.
 *
 * @param text - The text to decode.
 * @returns The text with each escape replaced by the byte it names.
 */
function decodeEscapes(text: string): string {
  return text.replaceAll(/%([0-9a-f]{2})/giu, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/**
 * Reports whether one path segment names the private directory.
 *
 * @param segment - One decoded segment.
 * @returns `true` for `.ignifx` in any case, with Windows' ignored trailing dots and spaces, an
 * alternate data stream suffix, or as an 8.3 short name.
 */
function isPrivateSegment(segment: string): boolean {
  const name = (segment.normalize("NFKC").toLowerCase().split(":")[0] ?? "").replace(/[. ]+$/u, "");
  return name === PRIVATE_DIR_NAME || SHORT_NAME_RE.test(name);
}

/**
 * Reports whether a request URL reaches into the private directory.
 *
 * @remarks
 * The query and fragment are dropped, then escapes are decoded until the path stops changing (so
 * `%252e` counts as `.`). Every segment between `/`, `\`, `?` and `#` is checked: resolving `.` and
 * `..` only removes segments, so a path that names no `.ignifx` segment cannot reach one, and this
 * covers `/@fs/<absolute path>` and `/@id/` forms alike.
 *
 * @param url - The request URL as the server received it.
 * @returns `true` when the request must be refused.
 */
export function isPrivateRequestPath(url: string): boolean {
  let path = url.split(/[?#]/u, 1)[0] ?? "";
  for (let pass = 0; ; pass += 1) {
    const decoded = decodeEscapes(path);
    if (decoded === path) {
      break;
    }
    if (pass === MAX_DECODE_PASSES) {
      return true;
    }
    path = decoded;
  }
  return path.split(/[/\\?#]/u).some(isPrivateSegment);
}

/**
 * Connect middleware that answers 404, with no body, to every request into the private directory.
 *
 * @param request - The incoming request.
 * @param response - The response.
 * @param next - Passes the request on.
 */
export const privateDirMiddleware: Connect.NextHandleFunction = (request, response, next) => {
  if (!isPrivateRequestPath(request.url ?? "")) {
    next();
    return;
  }
  response.statusCode = 404;
  response.setHeader("Cache-Control", "no-store");
  response.end();
};
