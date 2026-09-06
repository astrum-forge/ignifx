/**
 * The key-to-file-name codec the file backends share (`docs/architecture/14-platform-electron.md`
 * §2 and §5). It is pure string work with no file-system imports, so it is unit-testable in Node
 * and reusable by `@ignifx/electron`'s bridge backend.
 *
 * Four hazards shape it, and the encoding answers all four at once:
 *
 * 1. **Path traversal.** `..`, `/`, and `\` in a key must never escape the namespace directory.
 * 2. **Windows-illegal characters.** `< > : " | ? *` are rejected outright by NTFS, as is a name
 *    that ends in a dot or a space.
 * 3. **Reserved device names.** `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9` cannot be
 *    file names on Windows *even with an extension*, so `con.json` is unopenable.
 * 4. **Case-insensitive file systems.** macOS's default APFS volume and every NTFS volume treat
 *    `Slot1` and `slot1` as one file, which would silently merge two different keys.
 *
 * The encoding is percent-encoding with a **lower-case-only** safe alphabet: every byte outside
 * `a`–`z`, `0`–`9`, `.`, `_`, `-` becomes `%` plus two lower-case hex digits. Because upper-case
 * letters are escaped and the hex digits are lower case, every encoded name is entirely lower case,
 * which makes hazard 4 impossible. Hazards 1 and 2 fall out for free — `/`, `\`, `:` and the rest
 * are outside the alphabet. Hazard 3, and a leading or trailing dot, are handled by escaping one
 * character that was already safe, which decoding does not notice.
 */

/** The bytes kept verbatim. Everything else is percent-encoded. */
const SAFE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789._-";

/**
 * The Windows device names a file may not be called, with or without an extension. Lower case,
 * because the encoder has already lower-cased everything by the time this list is consulted.
 */
// oxlint-disable-next-line unicorn/prefer-set-has -- a module-scope Set is an import-time allocation (CONSTITUTION.md 3.5).
const RESERVED_DEVICE_NAMES: readonly string[] = [
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
];

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

/**
 * Percent-escapes one byte.
 *
 * @param byte - The byte to escape.
 * @returns The three-character escape, `"%2f"` for `0x2f`.
 */
function escapeByte(byte: number): string {
  return `%${HEX_DIGITS.charAt((byte >> NIBBLE_BITS) & NIBBLE_MASK)}${HEX_DIGITS.charAt(byte & NIBBLE_MASK)}`;
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
 * Turns a storage key into a file name that is legal on every supported file system and unique per
 * key on case-insensitive ones.
 *
 * @param key - Any key that passed `assertStorageKey`.
 * @returns The encoded base name, without the `.json` or `.bin` extension the backend appends.
 *
 * @example
 * ```ts
 * encodeStorageFileName("saves/Slot 1"); // "saves%2f%53lot%201" — lower case, no separator
 * encodeStorageFileName(".."); // "%2e%2e" — cannot navigate
 * encodeStorageFileName("con"); // "%63on" — not the Windows console device
 * ```
 *
 * @internal
 */
export function encodeStorageFileName(key: string): string {
  let encoded = "";
  for (const byte of new TextEncoder().encode(key)) {
    const character = String.fromCodePoint(byte);
    encoded += SAFE_ALPHABET.includes(character) ? character : escapeByte(byte);
  }
  if (encoded.startsWith(".")) {
    encoded = escapeFirstCharacter(encoded);
  }
  if (encoded.endsWith(".")) {
    encoded = escapeLastCharacter(encoded);
  }
  const dot = encoded.indexOf(".");
  const stem = dot === -1 ? encoded : encoded.slice(0, dot);
  return RESERVED_DEVICE_NAMES.includes(stem) ? escapeFirstCharacter(encoded) : encoded;
}

/**
 * Reverses {@link encodeStorageFileName}.
 *
 * @param encoded - A base name read back from a directory listing.
 * @returns The original key, or `null` when the name is not something the encoder produced — a
 * stray file in the namespace directory, a half-written temporary, or a truncated escape. Callers
 * skip those rather than fail a listing (`./backend.ts`, rule 6).
 *
 * @example
 * ```ts
 * decodeStorageFileName("saves%2fslot%201"); // "saves/slot 1"
 * decodeStorageFileName("readme"); // "readme"
 * decodeStorageFileName("%zz"); // null
 * ```
 *
 * @internal
 */
export function decodeStorageFileName(encoded: string): string | null {
  const bytes: number[] = [];
  let index = 0;
  while (index < encoded.length) {
    const character = encoded.charAt(index);
    if (character === "%") {
      const digits = encoded.slice(index + 1, index + 1 + ESCAPE_LENGTH);
      if (digits.length !== ESCAPE_LENGTH) {
        return null;
      }
      if (!HEX_DIGITS.includes(digits.charAt(0)) || !HEX_DIGITS.includes(digits.charAt(1))) {
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
