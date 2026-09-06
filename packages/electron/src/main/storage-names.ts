/**
 * The key-to-file-name codec the desktop storage backend writes through
 * (`docs/architecture/14-platform-electron.md` §2). Every byte a desktop game persists goes through
 * here, in the **main** process: the renderer holds a `StorageBackend` that forwards over the
 * preload bridge, so a sandboxed renderer never touches `fs`.
 *
 * ## The layout is `@ignifx/core`'s, byte for byte
 *
 * `userData/<encoded namespace segment>/…/<encoded key>.json` for a JSON value, `….bin` for a byte
 * value — exactly what `packages/core/src/storage/node/file-backend.ts` writes, using exactly the
 * codec `packages/core/src/storage/file-names.ts` defines. That is the point: the contract in
 * `packages/core/src/storage/backend.ts` promises that one save file is readable from any backend,
 * and a desktop build that encoded its names differently would quietly break `ignifx bake`, a
 * headless test fixture, and any tool that reads a user's saves outside Electron.
 *
 * The codec is percent-encoding over a **lower-case-only** alphabet — every byte outside
 * `a`–`z`, `0`–`9`, `.`, `_`, `-` becomes `%` plus two lower-case hex digits — which answers four
 * hazards at once: path traversal (`/`, `\`, `..` are all escaped), Windows-illegal characters,
 * Windows reserved device names (`con.json` is unopenable, so `con` encodes to `%63on`), and
 * case-insensitive file systems (APFS and NTFS would otherwise merge `Slot1` and `slot1`).
 *
 * ## Why this file duplicates the codec instead of importing it
 *
 * `encodeStorageFileName` / `decodeStorageFileName` are `@internal` in `@ignifx/core` and are not
 * re-exported from its barrel, and the main process must not import `@ignifx/core` at all: core's
 * barrel reaches `src/lite/**`, which pulls Babylon Lite — a renderer-side, WebGPU-shaped
 * dependency — into a Node process that has no GPU and no business loading it. The duplication is
 * deliberate, it is called out here so a future change to either copy is obviously a change to
 * both, and `test/storage-fs.test.ts` pins the two against the same vectors core's own suite uses.
 */

/** The bytes kept verbatim. Everything else is percent-encoded. Mirrors core's `SAFE_ALPHABET`. */
const SAFE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789._-";

/** Lower-case hexadecimal digits, so an encoded name never contains an upper-case character. */
const HEX_DIGITS = "0123456789abcdef";

/** How many hex digits one percent escape carries. */
const ESCAPE_LENGTH = 2;

/** The radix percent escapes are written in. */
const HEX_RADIX = 16;

/** The high nibble shift. */
const NIBBLE_BITS = 4;

/** The low nibble mask. */
const NIBBLE_MASK = 0xf;

/** The Windows device names a file may not be called, with or without an extension. */
const RESERVED_DEVICE_NAMES: readonly string[] = Object.freeze([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/**
 * Percent-escapes one byte.
 *
 * @param byte - The byte to escape.
 * @returns The three-character escape, `"%2f"` for `0x2f`.
 */
function escapeByte(byte: number): string {
  const high = HEX_DIGITS[(byte >> NIBBLE_BITS) & NIBBLE_MASK] ?? "0";
  const low = HEX_DIGITS[byte & NIBBLE_MASK] ?? "0";
  return `%${high}${low}`;
}

/**
 * Escapes the first character of an already-encoded name, without changing what it decodes to.
 *
 * @param encoded - The encoded name; its first character is a safe ASCII character.
 * @returns The name with its first character written as a percent escape.
 */
function escapeFirstCharacter(encoded: string): string {
  return `${escapeByte(encoded.codePointAt(0) ?? 0)}${encoded.slice(1)}`;
}

/**
 * Escapes the last character of an already-encoded name, without changing what it decodes to.
 *
 * @param encoded - The encoded name; its last character is a safe ASCII character.
 * @returns The name with its last character written as a percent escape.
 */
function escapeLastCharacter(encoded: string): string {
  const last = encoded.length - 1;
  return `${encoded.slice(0, last)}${escapeByte(encoded.codePointAt(last) ?? 0)}`;
}

/**
 * Turns a storage key or namespace segment into a file name legal on every supported file system
 * and unique per key on case-insensitive ones.
 *
 * @remarks
 * Byte-for-byte identical to `@ignifx/core`'s `encodeStorageFileName`; see the module comment for
 * why the codec is duplicated rather than imported.
 *
 * @param key - Any key that passed the `Storage` facade's validation.
 * @returns The encoded base name, without the `.json` or `.bin` extension.
 *
 * @example
 * ```ts
 * encodeStorageFileName("saves/Slot 1"); // "saves%2f%53lot%201"
 * encodeStorageFileName("..");           // "%2e%2e"
 * encodeStorageFileName("con");          // "%63on"
 * ```
 *
 * @public
 */
export function encodeStorageFileName(key: string): string {
  const bytes = new TextEncoder().encode(key);
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    const character = String.fromCodePoint(byte);
    encoded += SAFE_ALPHABET.includes(character) ? character : escapeByte(byte);
  }
  if (encoded.startsWith(".")) {
    encoded = escapeFirstCharacter(encoded);
  }
  if (encoded.endsWith(".")) {
    encoded = escapeLastCharacter(encoded);
  }
  const stem = encoded.split(".")[0] ?? "";
  return RESERVED_DEVICE_NAMES.includes(stem) ? escapeFirstCharacter(encoded) : encoded;
}

/**
 * Reverses {@link encodeStorageFileName}.
 *
 * @param encoded - A base name read back from a directory listing.
 * @returns The original key, or `null` when the name is not something the encoder produced — a
 * stray file, a half-written temporary, or a truncated escape. Callers skip those rather than fail
 * a listing (`StorageBackend` contract, rule 6).
 *
 * @example
 * ```ts
 * decodeStorageFileName("saves%2fslot%201"); // "saves/slot 1"
 * decodeStorageFileName("%zz");              // null
 * ```
 *
 * @public
 */
export function decodeStorageFileName(encoded: string): string | null {
  const bytes: number[] = [];
  let index = 0;
  while (index < encoded.length) {
    const character = encoded[index] ?? "";
    if (character === "%") {
      const digits = encoded.slice(index + 1, index + 1 + ESCAPE_LENGTH);
      if (digits.length !== ESCAPE_LENGTH) {
        return null;
      }
      if (!HEX_DIGITS.includes(digits[0] ?? "") || !HEX_DIGITS.includes(digits[1] ?? "")) {
        return null;
      }
      bytes.push(Number.parseInt(digits, HEX_RADIX));
      index += 1 + ESCAPE_LENGTH;
      continue;
    }
    if (!SAFE_ALPHABET.includes(character)) {
      return null;
    }
    bytes.push(character.codePointAt(0) ?? 0);
    index += 1;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/**
 * Maps a namespace path onto the directory its files live in.
 *
 * @remarks
 * One directory level per namespace segment, each encoded the same way a key is, which is what
 * keeps `"saves"` and `"saves/coop"` two separate scopes rather than a prefix relationship
 * (`StorageBackend` contract, rule 3).
 *
 * @param root - The `userData` directory.
 * @param namespace - The `/`-joined namespace path.
 * @returns The directory path, `/`-joined.
 *
 * @example
 * ```ts
 * storageDirectoryFor("/Users/me/Library/Application Support/Game", "saves/coop");
 * // ".../Game/saves/coop"
 * ```
 *
 * @public
 */
export function storageDirectoryFor(root: string, namespace: string): string {
  const segments = namespace.split("/");
  let path = root;
  for (let index = 0; index < segments.length; index += 1) {
    path += `/${encodeStorageFileName(segments[index] ?? "")}`;
  }
  return path;
}
