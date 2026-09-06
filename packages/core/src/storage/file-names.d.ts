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
export declare function encodeStorageFileName(key: string): string;
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
export declare function decodeStorageFileName(encoded: string): string | null;
