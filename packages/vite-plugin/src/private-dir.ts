/**
 * Keeps `.ignifx/` off every server the plugin runs in and out of every build. The ignifx editor
 * writes per-project private state there, among it `.ignifx/mcp.json` with the bearer token of the
 * project's MCP server, and Vite's CORS lets any `http://localhost:*` page read what the dev server
 * answers. `@ignifx/editor-host` keeps a copy (`src/vite/private-dir.ts`), byte-identical below the
 * header comment; its test fails when the two differ, so change both together.
 */

import { existsSync, realpathSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  const path = decodedRequestPath(url);
  return path === null || hasPrivateSegment(path);
}

/**
 * The path part of a request URL with every escape decoded, nested ones included.
 *
 * @param url - The request URL as the server received it.
 * @returns The decoded path, or `null` when it still changes after the last decoding pass.
 */
function decodedRequestPath(url: string): string | null {
  let path = url.split(/[?#]/u, 1)[0] ?? "";
  for (let pass = 0; ; pass += 1) {
    const decoded = decodeEscapes(path);
    if (decoded === path) {
      return path;
    }
    if (pass === MAX_DECODE_PASSES) {
      return null;
    }
    path = decoded;
  }
}

/**
 * Reports whether a path names the private directory in any of its segments.
 *
 * @param path - A path with `/` or `\` separators, relative or absolute.
 * @returns `true` when a segment between separators is a spelling of `.ignifx`.
 */
export function hasPrivateSegment(path: string): boolean {
  return path.split(/[/\\?#]/u).some(isPrivateSegment);
}

/**
 * Reports whether a file, once every symbolic link on its path is followed, lies in a private
 * directory.
 *
 * @remarks
 * A link such as `src/link -> ../.ignifx` hides the directory from every check that reads the path
 * as written. The deepest part of `path` that exists is resolved with `realpath` and the rest
 * appended, so a request for a file the server would find by adding an extension is judged too.
 * Only the part of the real path below `realBase` and its common ancestor with the file counts:
 * a project that itself lives under some `.ignifx` directory is not refused wholesale.
 *
 * @param realBase - The real path the result is measured from, normally the project root.
 * @param path - An absolute path, existing or not.
 * @returns `true` when the real path has a `.ignifx` segment, or when it cannot be resolved for a
 * reason other than not existing (the check fails closed).
 *
 * It is synchronous, like Vite's own file lookups: a few `realpath` calls per request or module.
 */
export function isPrivateRealPath(realBase: string, path: string): boolean {
  let current = path;
  const rest: string[] = [];
  for (;;) {
    try {
      return hasPrivateSegment(relative(realBase, join(realpathSync.native(current), ...rest)));
    } catch (error) {
      const missing = isMissingFileError(error);
      const parent = dirname(current);
      if (!missing || parent === current) {
        return !missing;
      }
      rest.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Reports whether a caught failure means "there is no such file".
 *
 * @param error - The caught value.
 * @returns `true` for `ENOENT` and `ENOTDIR`.
 */
function isMissingFileError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Resolves a path to its real path, or returns it unchanged when it cannot be resolved.
 *
 * @param path - An absolute path.
 * @returns The real path.
 */
export function realPathOrSelf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/**
 * Answers 404 with no body and no caching.
 *
 * @param response - The response to end.
 */
function refuse(response: Parameters<Connect.NextHandleFunction>[1]): void {
  response.statusCode = 404;
  response.setHeader("Cache-Control", "no-store");
  response.end();
}

/** Where a server finds the file a request URL names. */
export interface PrivateDirGuardOptions {
  /** The real path of the project root, which real paths are judged against. */
  readonly realRoot: string;
  /** The server's `base`; a URL is tried with and without it. */
  readonly base: string;
  /** The directories a root-relative URL is served from: the root and `publicDir` in dev, `outDir` in preview. */
  readonly serveDirs: readonly string[];
  /** `resolve.alias`, which Vite's static middleware applies to request paths in dev; `[]` in preview. */
  readonly alias: readonly { readonly find: string | RegExp; readonly replacement: string }[];
  /** `resolve.extensions`, which Vite tries for a module request whose file does not exist. */
  readonly extensions: readonly string[];
}

/** The `/@fs/` prefix Vite serves absolute paths under, and `/@id/` for unresolved ids. */
const FS_PREFIX = "/@fs/";
const ID_PREFIX = "/@id/";
const DRIVE_RE = /^[a-z]:/iu;

/**
 * The files a decoded request path could be served from.
 *
 * @param path - The decoded request path, `/`-separated.
 * @param options - The server's directories and base.
 * @returns Absolute paths, existing or not.
 */
function candidateFiles(path: string, options: PrivateDirGuardOptions): string[] {
  const basePath = options.base.startsWith("/") ? options.base : "/";
  const forms = [path];
  if (basePath !== "/" && path.startsWith(basePath)) {
    forms.push(`/${path.slice(basePath.length)}`);
  }
  const candidates: string[] = [];
  for (const form of forms) {
    const relativeForms = [form];
    // Vite's static middleware rewrites a path the first alias matches and serves it from the root.
    const alias = options.alias.find(({ find }) =>
      typeof find === "string" ? form.startsWith(find) : find.test(form),
    );
    if (alias !== undefined) {
      const redirected = form.replace(alias.find, alias.replacement);
      candidates.push(redirected);
      relativeForms.push(redirected);
    }
    for (const prefix of [FS_PREFIX, ID_PREFIX]) {
      if (form.startsWith(prefix)) {
        const rest = form.slice(prefix.length);
        candidates.push(DRIVE_RE.test(rest) ? rest : `/${rest.replace(/^\/+/u, "")}`);
        relativeForms.push(`/${rest}`);
      }
    }
    for (const directory of options.serveDirs) {
      candidates.push(...relativeForms.map((relativeForm) => join(directory, relativeForm)));
    }
  }
  // `resolve` folds `.` and `..` the way a server normalises a URL, before anything is looked up.
  return candidates.filter((candidate) => isAbsolute(candidate)).map((candidate) => resolve(candidate));
}

/**
 * Reports whether a candidate file, or the file Vite would find by adding an extension to it, is
 * private once links are followed.
 *
 * @param file - An absolute candidate path.
 * @param options - The real root and `resolve.extensions`.
 * @returns `true` when the request must be refused.
 */
function isPrivateCandidate(file: string, options: PrivateDirGuardOptions): boolean {
  if (isPrivateRealPath(options.realRoot, file)) {
    return true;
  }
  // Extensions are only worth trying where Vite would: the file is missing and its directory is not.
  if (existsSync(file) || !existsSync(dirname(file))) {
    return false;
  }
  return options.extensions.some((extension) => isPrivateRealPath(options.realRoot, `${file}${extension}`));
}

/**
 * Connect middleware that answers 404, with no body, to every request into the private directory:
 * one whose path names it ({@link isPrivateRequestPath}), and one whose file lies in it once
 * symbolic links are followed (`src/link -> ../.ignifx`).
 *
 * @remarks
 * For the second, it maps the URL to the files Vite could serve for it (root, `publicDir` or
 * `outDir`, `/@fs/` and `/@id/` absolute paths, with and without `base`, and the path a
 * `resolve.alias` entry rewrites it to) and checks each with {@link isPrivateRealPath}. A missing
 * file is judged by its deepest existing ancestor and, when its directory exists, with each of
 * `resolve.extensions` appended, as Vite completes a module request. The plugin's `load` hook
 * covers what Vite resolves some other way.
 *
 * @param options - Returns the server's directories; read per request, as they are only known once
 * the config is resolved.
 * @returns The middleware.
 */
export function createPrivateDirGuard(options: () => PrivateDirGuardOptions): Connect.NextHandleFunction {
  return (request, response, next) => {
    const decoded = decodedRequestPath(request.url ?? "");
    if (decoded === null || hasPrivateSegment(decoded)) {
      refuse(response);
      return;
    }
    const resolved = options();
    const path = decoded.replaceAll("\\", "/");
    if (candidateFiles(path, resolved).some((file) => isPrivateCandidate(file, resolved))) {
      refuse(response);
      return;
    }
    next();
  };
}

/**
 * Lists what a build put in its output directory from a private directory: any entry with a
 * `.ignifx` segment, any link whose real path is private, and the copy of any `publicDir` entry
 * whose real path is private (Vite copies `publicDir` following symbolic links, so
 * `public/tok.json -> ../.ignifx/mcp.json` arrives as a plain file holding the token).
 *
 * @param outDir - The absolute output directory.
 * @param publicDir - The absolute `publicDir` the build copied, or `null` when it copied none.
 * @returns The absolute paths to remove from `outDir`, outermost first; `[]` when there are none.
 */
export async function findPrivateOutputs(outDir: string, publicDir: string | null): Promise<string[]> {
  const found = new Set<string>();
  const entries = await readdir(outDir, { recursive: true, withFileTypes: true }).catch(() => []);
  const realOutDir = realPathOrSelf(outDir);
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    const segments = relative(outDir, path).split(/[/\\]/u);
    const index = segments.findIndex(isPrivateSegment);
    if (index !== -1) {
      found.add(join(outDir, ...segments.slice(0, index + 1)));
    } else if (entry.isSymbolicLink() && isPrivateRealPath(realOutDir, path)) {
      found.add(path);
    }
  }
  if (publicDir !== null) {
    const realPublic = realPathOrSelf(publicDir);
    await collectPrivatePublicEntries(publicDir, realPublic, outDir, new Set([realPublic]), found);
  }
  return [...found].toSorted();
}

/**
 * Walks `publicDir` the way Vite's copy does and records the output path of every private entry.
 *
 * @param directory - The directory being read.
 * @param realPublic - The real path of `publicDir`.
 * @param outDirectory - Where `directory`'s entries are copied to.
 * @param visited - Real directories already walked, so a link cycle ends.
 * @param found - Receives the output paths.
 */
async function collectPrivatePublicEntries(
  directory: string,
  realPublic: string,
  outDirectory: string,
  visited: Set<string>,
  found: Set<string>,
): Promise<void> {
  const names = await readdir(directory).catch(() => []);
  await Promise.all(
    names.map(async (name) => {
      const source = join(directory, name);
      const target = join(outDirectory, name);
      if (isPrivateRealPath(realPublic, source)) {
        found.add(target);
        return;
      }
      const isDirectory = await stat(source).then(
        (stats) => stats.isDirectory(),
        () => false,
      );
      const real = realPathOrSelf(source);
      if (isDirectory && !visited.has(real)) {
        visited.add(real);
        await collectPrivatePublicEntries(source, realPublic, target, visited, found);
      }
    }),
  );
}

/**
 * Removes the private entries {@link findPrivateOutputs} found.
 *
 * @param paths - The paths to remove.
 */
export async function removePrivateOutputs(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
}
