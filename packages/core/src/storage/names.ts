import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";

/**
 * The syntax rules `app.storage` enforces on namespaces and keys before a backend ever sees them
 * (`docs/architecture/14-platform-electron.md` §2), and the reasons they are as narrow as they are.
 *
 * A **namespace** ends up as a directory on disk and as part of a compound IndexedDB key, so its
 * alphabet has to survive every file system ignifx runs on: it is deliberately small, and the
 * validator refuses the two names — `.` and `..` — that mean something else to a path resolver. A
 * **key** is opaque: it may hold anything a game wants to name a save slot, including `/`, `..`,
 * `:` and characters Windows forbids, because backends encode keys rather than resolve them
 * (`./file-names.ts`). All a key may not be is empty, unreasonably long, or full of control
 * characters that would make a listing unreadable.
 */

/**
 * The namespace `app.storage` itself reads and writes before `namespace(name)` is called.
 *
 * @remarks
 * Every backend call carries a namespace, so the root storage needs a name of its own rather than
 * an empty string that each backend would have to special-case. `"default"` is a legal namespace
 * name, which means a game that writes `app.storage.namespace("default")` reaches the same values —
 * intentionally, since the two are the same store.
 *
 * @public
 */
export const DEFAULT_STORAGE_NAMESPACE = "default";

/**
 * The longest one segment of a namespace path may be.
 *
 * @public
 */
export const NAMESPACE_SEGMENT_MAX_LENGTH = 64;

/**
 * The longest a storage key may be.
 *
 * @remarks
 * 512 UTF-16 code units is comfortably below the ~255 *byte* file-name limit once percent-encoding
 * has expanded the key, which is why the file backend hashes nothing and truncates nothing: a key
 * that passes this check always encodes to a name a file system accepts.
 *
 * @public
 */
export const STORAGE_KEY_MAX_LENGTH = 512;

/** The characters a namespace segment may contain. */
const NAMESPACE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-";

/** The two segment names a path resolver would read as navigation rather than as a name. */
// oxlint-disable-next-line unicorn/prefer-set-has -- two entries; a Set would allocate at import.
const RESERVED_SEGMENTS: readonly string[] = [".", ".."];

/** The upper bound of the C0 control block, exclusive of the space that follows it. */
const C0_END = 0x20;

/** The start of the DEL/C1 control block. */
const C1_START = 0x7f;

/** The end of the C1 control block. */
const C1_END = 0x9f;

/**
 * Reports whether a code point is a C0 or C1 control character.
 *
 * @param code - The UTF-16 code unit.
 * @returns `true` when the character is a control character.
 */
function isControlCharacter(code: number): boolean {
  return code < C0_END || (code >= C1_START && code <= C1_END);
}

/**
 * Refuses a namespace name that is not a single legal segment.
 *
 * @param name - The name handed to `Storage.namespace(name)`.
 * @throws IgnifxError with code `IGX-1421` when the name is empty, too long, contains a character
 * outside `A`–`Z`, `a`–`z`, `0`–`9`, `.`, `_`, `-`, or is `.` or `..`.
 *
 * @example
 * ```ts
 * assertNamespaceName("saves"); // fine
 * assertNamespaceName("../etc"); // IGX-1421
 * ```
 *
 * @internal
 */
export function assertNamespaceName(name: string): void {
  let reason: string | null = null;
  if (name.length === 0) {
    reason = "it is empty";
  } else if (name.length > NAMESPACE_SEGMENT_MAX_LENGTH) {
    reason = `it is longer than ${String(NAMESPACE_SEGMENT_MAX_LENGTH)} characters`;
  } else if (RESERVED_SEGMENTS.includes(name)) {
    reason = "it is a path navigation name";
  } else {
    for (const character of name) {
      if (!NAMESPACE_ALPHABET.includes(character)) {
        reason = `it contains ${JSON.stringify(character)}`;
        break;
      }
    }
  }
  if (reason === null) {
    return;
  }
  throw new IgnifxError(
    CoreErrorCode.storageInvalidNamespace,
    `${JSON.stringify(name)} is not a valid storage namespace because ${reason}.`,
    {
      context: { namespace: name },
      hint: "Namespace names are 1-64 characters of A-Z, a-z, 0-9, dot, underscore, or hyphen.",
    },
  );
}

/**
 * Appends a child namespace to a namespace path.
 *
 * @param parent - The parent namespace path; already validated.
 * @param child - The child segment; validated here.
 * @returns The joined path, `"saves/coop"` for `("saves", "coop")`.
 * @throws IgnifxError with code `IGX-1421` when the child is not a legal segment.
 *
 * @internal
 */
export function joinNamespace(parent: string, child: string): string {
  assertNamespaceName(child);
  return `${parent}/${child}`;
}

/**
 * Refuses a key no backend could store legibly.
 *
 * @param key - The key handed to `get`, `set`, or `delete`.
 * @throws IgnifxError with code `IGX-1422` when the key is empty, longer than
 * {@link STORAGE_KEY_MAX_LENGTH}, or contains a control character.
 *
 * @example
 * ```ts
 * assertStorageKey("saves/slot 1"); // fine — keys are opaque, slashes and spaces included
 * assertStorageKey(""); // IGX-1422
 * ```
 *
 * @internal
 */
export function assertStorageKey(key: string): void {
  let reason: string | null = null;
  if (key.length === 0) {
    reason = "it is empty";
  } else if (key.length > STORAGE_KEY_MAX_LENGTH) {
    reason = `it is longer than ${String(STORAGE_KEY_MAX_LENGTH)} characters`;
  } else {
    for (let index = 0; index < key.length; index += 1) {
      if (isControlCharacter(key.charCodeAt(index))) {
        reason = `it contains a control character at position ${String(index)}`;
        break;
      }
    }
  }
  if (reason === null) {
    return;
  }
  throw new IgnifxError(CoreErrorCode.storageInvalidKey, `That storage key is invalid because ${reason}.`, {
    context: { length: key.length },
    hint: "Keys are 1-512 characters of any printable Unicode; backends encode them for you.",
  });
}
