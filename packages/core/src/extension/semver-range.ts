/**
 * The semver range matcher the extension host uses for `Extension.engine`
 * (`docs/architecture/04-extensions.md` §1, §2 rule 3). It is deliberately in-house and tiny:
 * coding standards §13 makes every runtime dependency an ADR paragraph, and the only ranges the
 * contract asks for are the comparator forms below.
 *
 * ## Supported grammar
 *
 * ```text
 * range      := set ( " || " set )*
 * set        := comparator ( " " comparator )*
 * comparator := ( "^" | ">=" | "<=" | ">" | "<" | "=" )? version
 * version    := <digits> "." <digits> "." <digits>
 * ```
 *
 * A range matches when **any** set matches; a set matches when **every** comparator in it matches.
 * `^` follows npm's rules, including the 0.x special cases: `^1.2.3` is `>=1.2.3 <2.0.0`,
 * `^0.2.3` is `>=0.2.3 <0.3.0`, and `^0.0.3` is `>=0.0.3 <0.0.4`.
 *
 * Not supported, and rejected rather than guessed at: prerelease and build metadata (`1.0.0-rc.1`),
 * `x`/`*` wildcards, hyphen ranges, and `~`. A range this module cannot parse never matches, so the
 * extension host reports `IGX-0404` naming the range, which is the actionable failure.
 */

/** A parsed `major.minor.patch` triple. */
interface Version {
  /** The major component. */
  readonly major: number;
  /** The minor component. */
  readonly minor: number;
  /** The patch component. */
  readonly patch: number;
}

/** `major.minor.patch`, digits only. */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/u;

/** The comparator prefixes, longest first so `>=` is matched before `>`. */
const OPERATORS: readonly string[] = Object.freeze([">=", "<=", "^", ">", "<", "="]);

/**
 * Parses a `major.minor.patch` string.
 *
 * @param text - The candidate version.
 * @returns The parsed triple, or `null` when the text is not a plain three-part version.
 */
function parseVersion(text: string): Version | null {
  const match = VERSION_PATTERN.exec(text.trim());
  if (match === null) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Orders two versions.
 *
 * @param left - The first version.
 * @param right - The second version.
 * @returns A negative number when `left` is older, `0` when they are equal, a positive number when
 * `left` is newer.
 */
function compare(left: Version, right: Version): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

/**
 * The exclusive upper bound of a caret comparator, following npm's 0.x rules.
 *
 * @param version - The caret's base version.
 * @returns The first version the caret no longer accepts.
 */
function caretLimit(version: Version): Version {
  if (version.major > 0) {
    return { major: version.major + 1, minor: 0, patch: 0 };
  }
  if (version.minor > 0) {
    return { major: 0, minor: version.minor + 1, patch: 0 };
  }
  return { major: 0, minor: 0, patch: version.patch + 1 };
}

/**
 * Tests one comparator.
 *
 * @param version - The version being checked.
 * @param comparator - One comparator, for example `">=0.1.0"`.
 * @returns `true` when the version satisfies it; `false` when it does not, or when the comparator
 * cannot be parsed.
 */
function satisfiesComparator(version: Version, comparator: string): boolean {
  let operator = "=";
  let rest = comparator;
  for (let index = 0; index < OPERATORS.length; index += 1) {
    const candidate = OPERATORS[index];
    if (candidate !== undefined && comparator.startsWith(candidate)) {
      operator = candidate;
      rest = comparator.slice(candidate.length);
      break;
    }
  }
  const bound = parseVersion(rest);
  if (bound === null) {
    return false;
  }
  const order = compare(version, bound);
  switch (operator) {
    case ">=": {
      return order >= 0;
    }
    case "<=": {
      return order <= 0;
    }
    case ">": {
      return order > 0;
    }
    case "<": {
      return order < 0;
    }
    case "^": {
      return order >= 0 && compare(version, caretLimit(bound)) < 0;
    }
    default: {
      return order === 0;
    }
  }
}

/**
 * Reports whether a version satisfies a range.
 *
 * @param version - The `major.minor.patch` version being checked, normally the running
 * `@ignifx/core` version.
 * @param range - The range an extension declared in `Extension.engine`.
 * @returns `true` when the version satisfies the range. An empty range matches everything; a range
 * this module cannot parse matches nothing.
 *
 * @example
 * ```ts
 * satisfiesRange("0.4.2", ">=0.4.0 <1.0.0"); // true
 * satisfiesRange("1.0.0", "^0.4.0 || ^1.0.0"); // true
 * satisfiesRange("0.0.0", ">=0.1.0"); // false
 * ```
 *
 * @internal
 */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  const trimmed = range.trim();
  if (parsed === null) {
    return false;
  }
  if (trimmed === "") {
    return true;
  }
  const sets = trimmed.split("||");
  for (let index = 0; index < sets.length; index += 1) {
    const set = sets[index]?.trim() ?? "";
    if (set === "") {
      continue;
    }
    const comparators = set.split(" ");
    let matches = true;
    for (let at = 0; at < comparators.length; at += 1) {
      const comparator = comparators[at]?.trim() ?? "";
      if (comparator === "") {
        continue;
      }
      if (!satisfiesComparator(parsed, comparator)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }
  return false;
}
