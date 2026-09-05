import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";

/**
 * Where {@link generateUlid} gets its randomness. Injecting it is what lets a test replay a scene
 * with the same uids every run (`CONSTITUTION.md` §2.1) without ignifx depending on a random
 * library (coding standards §13).
 *
 * @public
 */
export interface RandomSource {
  /**
   * Fills every byte of the buffer with new random values.
   *
   * @remarks
   * Named `fillBytes` rather than `fill` so that call sites are not mistaken for `Array.prototype.fill`
   * by the linter's reference-value rule.
   *
   * @param bytes - The buffer to overwrite in place. The buffer is a plain `ArrayBuffer` view;
   * `crypto.getRandomValues` refuses shared memory, so the type says so.
   */
  fillBytes(bytes: Uint8Array<ArrayBuffer>): void;
}

/**
 * Creates the production random source, backed by Web Crypto.
 *
 * @returns A source that fills buffers with `crypto.getRandomValues`.
 * @throws IgnifxError with code `IGX-1401` when the host exposes no Web Crypto implementation.
 *
 * @example
 * ```ts
 * const nextUid = createUlidFactory({ random: createCryptoRandom() });
 * ```
 *
 * @public
 */
export function createCryptoRandom(): RandomSource {
  // The DOM lib declares `globalThis.crypto` as always present. Node before 19 and locked-down
  // embedders do not have it, so the assertion models the absence the types deny (standards §5.2).
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (webCrypto === undefined || typeof webCrypto.getRandomValues !== "function") {
    throw new IgnifxError(CoreErrorCode.cryptoUnavailable, "This host does not expose Web Crypto.", {
      hint: "Pass a RandomSource explicitly, or use createSeededRandom() in environments without crypto.",
    });
  }
  return {
    fillBytes(bytes: Uint8Array<ArrayBuffer>): void {
      webCrypto.getRandomValues(bytes);
    },
  };
}

/** The `splitmix32` multiplier used to expand a single 32-bit seed into the four state words. */
const SEED_MULTIPLIER = 0x6d2b79f5;

/**
 * Creates a deterministic random source: the same seed always produces the same byte stream.
 *
 * @remarks
 * The generator is Marsaglia's four-word `xorshift128`, seeded through a `splitmix32`-style
 * scrambler so that neighbouring seeds do not produce correlated streams. It is for tests, replays,
 * and procedural generation — never for anything security-sensitive.
 *
 * @param seed - Any integer; only the low 32 bits are used.
 * @returns A source that fills buffers deterministically.
 *
 * @example
 * ```ts
 * const nextUid = createUlidFactory({ random: createSeededRandom(1), now: () => 0 });
 * nextUid() === createUlidFactory({ random: createSeededRandom(1), now: () => 0 })(); // true
 * ```
 *
 * @public
 */
export function createSeededRandom(seed: number): RandomSource {
  let scrambler = Math.trunc(seed) >>> 0;
  /**
   * Produces the next scrambled 32-bit word used to initialise the generator state.
   *
   * @returns An unsigned 32-bit integer.
   */
  const nextSeedWord = (): number => {
    scrambler = (scrambler + SEED_MULTIPLIER) >>> 0;
    let word = scrambler;
    word = Math.imul(word ^ (word >>> 15), word | 1) >>> 0;
    word = (word ^ (word + Math.imul(word ^ (word >>> 7), word | 61))) >>> 0;
    return (word ^ (word >>> 14)) >>> 0;
  };

  // An all-zero state is a fixed point of xorshift, so the low bit of the first word is forced on:
  // one guaranteed set bit costs nothing and removes the failure mode without a runtime check.
  let stateA = nextSeedWord() | 1;
  let stateB = nextSeedWord();
  let stateC = nextSeedWord();
  let stateD = nextSeedWord();

  /**
   * Advances the generator.
   *
   * @returns The next unsigned 32-bit word.
   */
  const nextWord = (): number => {
    const t = stateD ^ (stateD << 11);
    stateD = stateC;
    stateC = stateB;
    stateB = stateA;
    stateA = (stateA ^ (stateA >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return stateA;
  };

  return {
    fillBytes(bytes: Uint8Array<ArrayBuffer>): void {
      let word = 0;
      for (let index = 0; index < bytes.length; index += 1) {
        if (index % 4 === 0) {
          word = nextWord();
        }
        bytes[index] = (word >>> ((index % 4) * 8)) & 0xff;
      }
    },
  };
}
