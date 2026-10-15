// A copy of `packages/editor-protocol/src/version.ts` from `astrum-forge/ignifx-editor` (protocol 0.2).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * The protocol's own version, separate from the editor's and the engine's package versions.
 */

/**
 * A protocol version. `major` changes when a message changes incompatibly; `minor` when messages
 * or fields are added in a way an older peer can ignore. Before 1.0 the minor plays the role of the
 * major (ADR-E008), so every 0.x minor is its own incompatible line.
 *
 * @public
 */
export interface ProtocolVersion {
  /** Incremented for incompatible changes. Peers must agree on it. */
  readonly major: number;
  /** Incremented for additions. From 1.0 peers may differ in it; before 1.0 they must agree on it too. */
  readonly minor: number;
}

/**
 * The protocol version this package describes. The editor sends it in `hello` and the host in
 * `ready`.
 *
 * @public
 */
export const PROTOCOL_VERSION: ProtocolVersion = { major: 0, minor: 2 };

/**
 * Tells whether two peers can talk.
 *
 * @remarks
 * The rule is ADR-E008's: the protocol follows SemVer, and until 1.0 its minor plays the role of the
 * major, as the engine's minors do. So from 1.0 two peers are compatible when their majors are
 * equal and the minors are free to differ; before 1.0 the major and the minor must both be equal.
 * The check is symmetric. Which versions the editor accepts beyond it (ADR-E008 has the editor
 * support the current protocol line and the previous one) is the editor's decision, not this
 * function's.
 *
 * @example
 * ```ts
 * protocolVersionIsCompatible({ major: 0, minor: 2 }, { major: 0, minor: 1 }); // false
 * protocolVersionIsCompatible({ major: 1, minor: 0 }, { major: 1, minor: 4 }); // true
 * ```
 *
 * @param a - One peer's protocol version.
 * @param b - The other peer's protocol version.
 * @returns `true` when the versions are on the same compatible line.
 *
 * @public
 */
export function protocolVersionIsCompatible(a: ProtocolVersion, b: ProtocolVersion): boolean {
  if (a.major !== b.major) {
    return false;
  }
  return a.major !== 0 || a.minor === b.minor;
}
