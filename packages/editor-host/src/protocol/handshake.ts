// A copy of `packages/editor-protocol/src/handshake.ts` from `astrum-forge/ignifx-editor` (protocol 0.3).
// Below this comment it is byte-identical to that file, but for the link rule in `./index.ts`.
/**
 * The handshake the editor runs with each host it embeds: the scene view (`@ignifx/editor-host`)
 * and the play view (`virtual:ignifx/editor`). Plan §3.3.
 *
 * The editor sends `hello`; the host answers with its `ready` result, or with an
 * `RpcErrorCode.incompatibleProtocol` error when `protocolVersionIsCompatible` refuses the
 * pair. Either side may send `ping` at any time after that. The editor posts a fresh port for every
 * load of a view (`connect.ts`), so the handshake runs again after every reload.
 */
import { isRecord } from "./rpc.js";
import type { RpcRequest, RpcSuccessResponse } from "./rpc.js";
import type { ProtocolVersion } from "./version.js";

/**
 * The method names of the handshake.
 *
 * @remarks
 * `as const` object plus derived union rather than an `enum` (engine coding standards §5.2, §5.3).
 *
 * @public
 */
export const HandshakeMethod = {
  /** Editor → host: the first message on a new channel. */
  hello: "hello",
  /** Either direction: a liveness check, answered with `"pong"`. */
  ping: "ping",
} as const;

/**
 * The union of the names in `HandshakeMethod`.
 *
 * @public
 */
export type HandshakeMethod = (typeof HandshakeMethod)[keyof typeof HandshakeMethod];

/**
 * Which kind of view a host runs.
 *
 * @public
 */
export const HostKind = {
  /** The scene view: an edit-mode app that applies document ops and draws gizmos. */
  scene: "scene",
  /** The play view: the project's own page, running the game. */
  play: "play",
} as const;

/**
 * The union of the kinds in `HostKind`.
 *
 * @public
 */
export type HostKind = (typeof HostKind)[keyof typeof HostKind];

/**
 * The optional features a host lists in its `ready` result.
 *
 * @remarks
 * The play controls send `["heartbeat", "playControls"]`. The scene host sends `"heartbeat"` and
 * whichever of `"gizmos"`, `"screenshot"`, `"viewMode2d"` and `"pick2d"` it supports; every
 * `SceneMethod` not tied to one of them is required of a 0.3 scene host.
 *
 * @public
 */
export const HostCapability = {
  /** The host sends `heartbeat` notifications after `ready` (see `HostNotification`). */
  heartbeat: "heartbeat",
  /** The host answers the methods in `PlayMethod`. */
  playControls: "playControls",
  /**
   * The scene host draws gizmos on the primary selection, answers `setGizmo`, and sends
   * `transformDragging` and `transformDragged`.
   */
  gizmos: "gizmos",
  /** The scene host answers `screenshot`. */
  screenshot: "screenshot",
  /** The scene host accepts `setViewMode` with `"2d"`: a 2D editor camera and planar gizmos. */
  viewMode2d: "viewMode2d",
  /**
   * The scene host picks sprites in 2D view mode (`app.twoD.pickAt` from `@ignifx/2d`); without it,
   * `pick` and view clicks in 2D mode resolve through the 3D picker only.
   */
  pick2d: "pick2d",
  /**
   * The host relays the app's reports: `log` lines with the first `Error` each carries, a
   * `hostError` with `AppErrorData` (entity, component, phase, stack) for every `app.onError`
   * report, and `hotReloaded` with each error's stack. The scene view sends them as scene
   * notifications, the play view as play notifications. Additive in 0.3.
   */
  logRelay: "logRelay",
  /**
   * After a script's hot reload changes a field's default, the scene host gives the field its new
   * default wherever the document leaves it out: on each document component whose record omits the
   * field, and on the members of each prefab instance (rebuilt from the prefab, with the instance's
   * overrides). A value the document sets is kept. An editor need not reopen the scene for changed
   * defaults. Additive in 0.3.
   */
  hotReloadDefaults: "hotReloadDefaults",
} as const;

/**
 * The union of the names in `HostCapability`.
 *
 * @public
 */
export type HostCapability = (typeof HostCapability)[keyof typeof HostCapability];

/**
 * What the editor says about itself in `hello`.
 *
 * @public
 */
export interface HelloParams {
  /** The editor's own version, for example `"0.1.0"`. */
  readonly editorVersion: string;
  /** The protocol version the editor speaks. */
  readonly protocol: ProtocolVersion;
}

/**
 * Editor → host: the first request on a new channel.
 *
 * @public
 */
export interface HelloRequest extends RpcRequest<typeof HandshakeMethod.hello, HelloParams> {
  /** What the editor says about itself. */
  readonly params: HelloParams;
}

/**
 * What a host says about itself in answer to `hello`.
 *
 * @public
 */
export interface ReadyResult {
  /** The version of `@ignifx/core` the project runs, for example `"0.9.0"`. */
  readonly engineVersion: string;
  /** The protocol version the host speaks. */
  readonly protocol: ProtocolVersion;
  /**
   * Optional features the host supports, named by `HostCapability`. Names are added as the
   * protocol grows; a peer ignores names it does not know.
   */
  readonly capabilities: readonly string[];
  /** Which view the host runs. */
  readonly hostKind: HostKind;
}

/**
 * Host → editor: the successful answer to {@link HelloRequest}.
 *
 * @public
 */
export type ReadyResponse = RpcSuccessResponse<ReadyResult>;

/**
 * Either direction: a liveness check. It takes no parameters.
 *
 * @public
 */
export type PingRequest = RpcRequest<typeof HandshakeMethod.ping, never>;

/**
 * The answer to {@link PingRequest}.
 *
 * @public
 */
export type PongResponse = RpcSuccessResponse<"pong">;

/**
 * The `data` of the `RpcErrorCode.incompatibleProtocol` error a host answers `hello` with when
 * the protocol versions differ.
 *
 * @public
 */
export interface IncompatibleProtocolData {
  /** The protocol version the host speaks. */
  readonly host: ProtocolVersion;
  /** The version of `@ignifx/core` the project runs. */
  readonly engineVersion: string;
}

/**
 * Tells whether a value is a protocol version: two non-negative integers.
 *
 * @param value - The value to test.
 * @returns True for `{ major, minor }` with non-negative safe integers.
 *
 * @public
 */
export function isProtocolVersion(value: unknown): value is ProtocolVersion {
  if (!isRecord(value)) {
    return false;
  }
  const { major, minor } = value;
  return (
    typeof major === "number" &&
    typeof minor === "number" &&
    Number.isSafeInteger(major) &&
    Number.isSafeInteger(minor) &&
    major >= 0 &&
    minor >= 0
  );
}

/**
 * Checks the `result` of a `hello` answer.
 *
 * @param value - The received `result`.
 * @returns True when it has a string `engineVersion`, a protocol version, an array of capability
 * strings, and a known `hostKind`.
 *
 * @public
 */
export function isReadyResult(value: unknown): value is ReadyResult {
  if (!isRecord(value)) {
    return false;
  }
  const { capabilities, hostKind } = value;
  return (
    typeof value["engineVersion"] === "string" &&
    isProtocolVersion(value["protocol"]) &&
    Array.isArray(capabilities) &&
    capabilities.every((name: unknown) => typeof name === "string") &&
    Object.values(HostKind).some((kind) => kind === hostKind)
  );
}

/**
 * Checks the `data` of an `incompatibleProtocol` answer to `hello`.
 *
 * @param value - The received `error.data`.
 * @returns True when it names the host's protocol version and the engine version.
 *
 * @public
 */
export function isIncompatibleProtocolData(value: unknown): value is IncompatibleProtocolData {
  return isRecord(value) && isProtocolVersion(value["host"]) && typeof value["engineVersion"] === "string";
}
