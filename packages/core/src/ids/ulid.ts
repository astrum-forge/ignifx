import { createCryptoRandom, type RandomSource } from "./random-source.js";

/**
 * ULID generation (`docs/architecture/02-scene-graph.md` §10, `00-overview.md` §5): a 26-character,
 * lexicographically sortable, Crockford base32 identifier built from a 48-bit millisecond timestamp
 * and 80 bits of randomness. Entities and components carry one as their `uid`, and scene files use
 * it as the reference key.
 */

/** Crockford's base32 alphabet: no `I`, `L`, `O`, or `U`, so ids cannot be misread. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** How many characters a ULID has. */
const ULID_LENGTH = 26;

/** How many of those characters encode the timestamp. */
const TIME_LENGTH = 10;

/** How many bytes of randomness a ULID carries (80 bits). */
const RANDOM_BYTES = 10;

/** How many characters one 40-bit half of the randomness encodes to. */
const HALF_LENGTH = 8;

/** The base of the encoding. */
const BASE = 32;

/** The largest timestamp a 48-bit ULID can express: 10889-08-02T05:31:50.655Z. */
const MAX_TIME_MS = 281_474_976_710_655;

/** A byte mask, used by the monotonic carry. */
const BYTE_MAX = 0xff;

/**
 * Encodes an unsigned integer as a fixed number of Crockford base32 characters, most significant
 * first.
 *
 * @param value - The value to encode; must be below `32 ** length`.
 * @param length - How many characters to produce.
 * @returns The encoded characters.
 */
function encode(value: number, length: number): string {
  let remaining = value;
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out = CROCKFORD.charAt(remaining % BASE) + out;
    remaining = Math.floor(remaining / BASE);
  }
  return out;
}

/**
 * Reads five bytes as one 40-bit big-endian integer. A `DataView` rather than indexing, because it
 * returns a plain `number` under `noUncheckedIndexedAccess`, and multiplication rather than shifting,
 * because JavaScript's bitwise operators truncate to 32 bits.
 *
 * @param view - A view over the randomness buffer.
 * @param offset - The index of the most significant byte.
 * @returns The 40-bit value.
 */
function readHalf(view: DataView, offset: number): number {
  return view.getUint32(offset) * 256 + view.getUint8(offset + 4);
}

/**
 * Formats a timestamp and a randomness buffer as a ULID.
 *
 * @param timeMs - The timestamp in milliseconds, already clamped to 48 bits.
 * @param view - A view over exactly {@link RANDOM_BYTES} bytes of randomness.
 * @returns The 26-character identifier.
 */
function formatUlid(timeMs: number, view: DataView): string {
  return encode(timeMs, TIME_LENGTH) + encode(readHalf(view, 0), HALF_LENGTH) + encode(readHalf(view, 5), HALF_LENGTH);
}

/**
 * Adds one to the 80-bit randomness, big-endian, which is how the ULID specification keeps ids
 * generated in the same millisecond strictly increasing.
 *
 * @param view - A view over the randomness buffer, modified in place.
 * @returns `false` when every byte overflowed, meaning the caller must draw fresh randomness.
 */
function incrementRandom(view: DataView): boolean {
  for (let index = RANDOM_BYTES - 1; index >= 0; index -= 1) {
    const next = (view.getUint8(index) + 1) & BYTE_MAX;
    view.setUint8(index, next);
    if (next !== 0) {
      return true;
    }
  }
  return false;
}

/**
 * Clamps a clock reading into the 48 bits a ULID timestamp has.
 *
 * @param timeMs - The raw clock reading.
 * @returns A whole number between 0 and {@link MAX_TIME_MS}.
 */
function clampTime(timeMs: number): number {
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    return 0;
  }
  return Math.min(Math.floor(timeMs), MAX_TIME_MS);
}

/**
 * Options for {@link createUlidFactory}.
 *
 * @public
 */
export interface UlidFactoryOptions {
  /** Where randomness comes from. Defaults to {@link createCryptoRandom}. */
  readonly random?: RandomSource;
  /** The clock, in milliseconds since the Unix epoch. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Creates the monotonic ULID generator an app owns.
 *
 * @remarks
 * The returned function holds the monotonic state — the last timestamp and its randomness — so that
 * ids created inside one millisecond still sort in creation order, exactly like the ULID
 * specification's monotonic mode. The state lives in the closure, never at module scope, so two apps
 * in one process generate independently (`CONSTITUTION.md` §3.5, §3.6). A clock that jumps backwards
 * is pinned to the last timestamp, so ids never go backwards either.
 *
 * @param options - The random source and the clock.
 * @returns A function producing the next ULID.
 *
 * @example
 * ```ts
 * const nextUid = createUlidFactory();
 * const a = nextUid();
 * const b = nextUid();
 * a < b; // true, even inside one millisecond
 * ```
 *
 * @public
 */
export function createUlidFactory(options?: UlidFactoryOptions): () => string {
  const random = options?.random ?? createCryptoRandom();
  const now = options?.now ?? Date.now;
  const bytes = new Uint8Array(RANDOM_BYTES);
  const view = new DataView(bytes.buffer);
  let lastTimeMs = -1;

  return function nextUlid(): string {
    const timeMs = Math.max(clampTime(now()), lastTimeMs);
    if (timeMs === lastTimeMs) {
      if (!incrementRandom(view)) {
        // Unreachable in practice: it takes 2^80 ids inside one millisecond to exhaust the space.
        random.fillBytes(bytes);
      }
    } else {
      lastTimeMs = timeMs;
      random.fillBytes(bytes);
    }
    return formatUlid(timeMs, view);
  };
}

/**
 * Generates one ULID with fresh randomness.
 *
 * @remarks
 * This is the stateless form: every call draws 80 new random bits, so two ids created in the same
 * millisecond are unordered relative to each other. Monotonic ordering needs state, and state at
 * module scope is forbidden (`CONSTITUTION.md` §3.5, §3.6) — use {@link createUlidFactory} when
 * ordering inside a millisecond matters, which is what an app does for entity uids.
 *
 * @param random - Where the 80 random bits come from. Defaults to {@link createCryptoRandom}.
 * @param now - The clock, in milliseconds since the Unix epoch. Defaults to `Date.now`.
 * @returns A 26-character ULID.
 *
 * @example
 * ```ts
 * const uid = generateUlid();
 * isUlid(uid); // true
 * ```
 *
 * @public
 */
export function generateUlid(random?: RandomSource, now?: () => number): string {
  const source = random ?? createCryptoRandom();
  const bytes = new Uint8Array(RANDOM_BYTES);
  source.fillBytes(bytes);
  return formatUlid(clampTime(now === undefined ? Date.now() : now()), new DataView(bytes.buffer));
}

/**
 * Reports whether a string is a canonical ULID: 26 uppercase Crockford base32 characters whose
 * first character is `7` or lower, because a 48-bit timestamp cannot set the top two bits.
 *
 * @param value - The candidate identifier.
 * @returns `true` when the string is a well-formed ULID.
 *
 * @example
 * ```ts
 * isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV"); // true
 * isUlid("01arz3ndektsv4rrffq69g5fav"); // false — ULIDs are canonically uppercase
 * ```
 *
 * @public
 */
export function isUlid(value: string): boolean {
  if (value.length !== ULID_LENGTH) {
    return false;
  }
  for (let index = 0; index < ULID_LENGTH; index += 1) {
    if (!CROCKFORD.includes(value.charAt(index))) {
      return false;
    }
  }
  // 26 characters carry 130 bits but a ULID is 128, so the leading character encodes at most 7.
  return CROCKFORD.indexOf(value.charAt(0)) < 8;
}

/**
 * The largest timestamp a ULID can encode, in milliseconds since the Unix epoch. Readings beyond it
 * are clamped rather than producing a malformed identifier.
 *
 * @public
 */
export const MAX_ULID_TIME_MS: number = MAX_TIME_MS;
