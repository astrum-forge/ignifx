/**
 * Path helpers shared by the filename-scoped rules. ESLint hands rules an operating-system path,
 * while the rule options in `eslint.config.ts` are written as POSIX globs, so every comparison goes
 * through {@link normalizePath} first.
 *
 * The glob subset is deliberately small — `**`, `*` and `?` — because that is all the repository's
 * rule options need; brace expansion and negation are not supported.
 */

/**
 * Lazily created cache of compiled glob patterns. Coding standards §4 forbids allocating at import
 * time, so the map is created on first use rather than in a module-level initialiser.
 */
let compiledGlobs: Map<string, RegExp> | null = null;

/**
 * Converts one glob segment (the text between two `/`) into a regular-expression fragment.
 *
 * @param segment - A single path segment of the pattern, which may contain `*` and `?`.
 * @returns The regular-expression source matching that segment and nothing across a `/`.
 */
function segmentToRegExpSource(segment: string): string {
  let source = "";
  for (const character of segment) {
    if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
    }
  }
  return source;
}

/**
 * Compiles a glob into an anchored regular expression, memoising the result.
 *
 * @param pattern - A POSIX-style glob such as `**\/src\/**`.
 * @returns The compiled, anchored expression for that pattern.
 */
function globToRegExp(pattern: string): RegExp {
  compiledGlobs ??= new Map<string, RegExp>();
  const cached = compiledGlobs.get(pattern);
  if (cached !== undefined) {
    return cached;
  }
  const segments = pattern.split("/");
  let source = "^";
  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;
    if (segment === "**") {
      // A trailing `**` swallows the rest of the path; an inner one swallows whole segments and
      // the separator that follows them, so no extra `/` is appended in that branch.
      source += isLast ? ".*" : "(?:[^/]+/)*";
    } else {
      source += segmentToRegExpSource(segment);
      if (!isLast) {
        source += "/";
      }
    }
  }
  const compiled = new RegExp(`${source}$`, "u");
  compiledGlobs.set(pattern, compiled);
  return compiled;
}

/**
 * Normalises a filesystem path for glob and directory comparison: backslashes become slashes, a
 * Windows drive letter is dropped, and the path is made relative so that `**\/src\/**` matches an
 * absolute path as well as a relative one.
 *
 * @param filePath - The path ESLint reported for the file under lint.
 * @returns A slash-separated, root-relative path.
 */
export function normalizePath(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .replace(/^[A-Za-z]:\//u, "")
    .replace(/^\/+/u, "");
}

/**
 * Reports whether a file path matches at least one of the supplied globs.
 *
 * @param filePath - The path ESLint reported for the file under lint.
 * @param patterns - The globs to test, in the syntax described at the top of this module.
 * @returns `true` when any pattern matches.
 */
export function matchesAnyGlob(filePath: string, patterns: readonly string[]): boolean {
  const normalized = normalizePath(filePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

/**
 * Reports whether a file lives under a directory expressed as a path suffix such as `src/lite/`.
 * The comparison is segment-aligned, so `src/lite/` does not match `vendor/src/liteness/x.ts`.
 *
 * @param filePath - The path ESLint reported for the file under lint.
 * @param directories - Directory suffixes, with or without a trailing slash.
 * @returns `true` when the file sits inside one of the directories at any depth.
 */
export function isUnderDirectory(filePath: string, directories: readonly string[]): boolean {
  const normalized = `/${normalizePath(filePath)}`;
  return directories.some((directory) => {
    const withLeadingSlash = directory.startsWith("/") ? directory : `/${directory}`;
    const withTrailingSlash = withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
    return normalized.includes(withTrailingSlash);
  });
}
