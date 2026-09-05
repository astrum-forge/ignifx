import { Component } from "../../src/component/component.js";
import {
  array,
  asset,
  bool,
  color,
  componentRef,
  curve,
  entityRef,
  enumOf,
  f32,
  i32,
  layerMask,
  map,
  optional,
  quat,
  record,
  str,
  u32,
  vec2,
  vec3,
  vec4,
} from "../../src/schema/field-kinds.js";
import { Script } from "../../src/script/script.js";
import { SCENE_FILE_FORMAT, SCENE_FORMAT_VERSION } from "../../src/serialization/scene-file.js";
import { Signal } from "../../src/signal/signal.js";
import { createTestWorld, sinkOf } from "../support/create-test-world.js";
import type { AssetHandle, AssetState } from "../../src/assets/types.js";
import type { Entity } from "../../src/entity/entity.js";
import type { SceneFile, SceneFileEntity } from "../../src/serialization/scene-file.js";
import type { TestWorld } from "../support/create-test-world.js";

/** Does nothing; the stub handle's `release` needs a function, not behaviour. */
function noop(): void {
  // A stub handle holds no resources.
}

/** Stand-in asset class an `asset()` field can point at. */
export class AudioClip {
  static assetType = "audio";
  /** How long the clip runs, in seconds. */
  duration = 0;
}

/** A small component used where a second type is needed. */
export class Tagger extends Component.define({ note: str("n") }) {
  static typeId = "test/Tagger";
}

/** A component that declares every schema kind, so the round trip covers the whole encoder. */
export class Everything extends Component.define({
  speed: f32(5),
  loops: i32(1),
  count: u32(2),
  toggled: bool(false),
  label: str(""),
  planar: vec2({ x: 0, y: 0 }),
  offset: vec3({ x: 0, y: 0, z: 0 }),
  wide: vec4({ x: 0, y: 0, z: 0, w: 0 }),
  spin: quat({ x: 0, y: 0, z: 0, w: 1 }),
  tint: color("#ffffff"),
  mode: enumOf(["walk", "run"] as const, "walk"),
  target: entityRef<Entity>(),
  follow: componentRef(Tagger),
  clip: asset(AudioClip),
  waypoints: array(vec3()),
  stats: record({ hp: i32(10), armor: f32(0) }),
  bag: map(f32()),
  maybe: optional(f32(3)),
  mask: layerMask(["Player"]),
  path: curve(),
  scratch: f32(0, { transient: true }),
}) {
  static typeId = "test/Everything";
}

/** A component whose class declares a non-default schema version. */
export class Versioned extends Component.define({ value: f32(1) }) {
  static typeId = "test/Versioned";
  static schemaVersion = 3;
}

/** A component with no `typeId`, which the serializer must refuse to write. */
export class Anonymous extends Component.define({ value: f32(0) }) {}

/** A script that records `awake` into the world's shared log, in the order it ran. */
export class AwakeRecorder extends Script.define({ note: str("") }) {
  static typeId = "test/AwakeRecorder";

  awake(): void {
    sinkOf(this.world).push(`awake:${this.entity.name}:${this.note}`);
  }
}

/** Builds a world with the component classes these tests use already registered. */
export function createSerializationWorld(layers?: readonly string[]): TestWorld {
  const harness = createTestWorld(layers === undefined ? undefined : { layers });
  harness.world.registry.registerAll([Everything, Tagger, Versioned, AwakeRecorder]);
  return harness;
}

/** A stub `AssetHandle` for tests that never run the asset service. */
export function fakeHandle<T>(address: string, value: T, type = "scene"): AssetHandle<T> {
  const signal = new Signal<T>();
  const state: AssetState = "loaded";
  const handle: AssetHandle<T> = {
    address,
    type,
    state,
    value,
    promise: Promise.resolve(value),
    progress: 1,
    error: null,
    refCount: 1,
    retain: () => handle,
    release: noop,
    onReplaced: signal,
    [Symbol.dispose]: noop,
  };
  return handle;
}

/** Options accepted by {@link buildFile}. */
export interface BuildFileOptions {
  /** The file's name. */
  readonly name?: string;
  /** The entities. */
  readonly entities: readonly SceneFileEntity[];
}

/** Assembles a scene file from entity records. */
export function buildFile(options: BuildFileOptions): SceneFile {
  return {
    format: SCENE_FILE_FORMAT,
    formatVersion: SCENE_FORMAT_VERSION,
    name: options.name ?? "scene",
    entities: options.entities,
  };
}

/** An entity record with the boilerplate filled in. */
export function entityRecord(record_: Partial<SceneFileEntity> & { readonly uid: string }): SceneFileEntity {
  return {
    name: record_.uid,
    parent: null,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ...record_,
  };
}
