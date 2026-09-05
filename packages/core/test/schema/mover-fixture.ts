import {
  array,
  asset,
  bool,
  color,
  componentRef,
  entityRef,
  enumOf,
  f32,
  i32,
  record,
  str,
  vec3,
} from "../../src/schema/field-kinds.js";
import type { ReferenceDecoder, ReferenceEncoder } from "../../src/schema/encode.js";
import type { FieldDefinition } from "../../src/schema/types.js";

/** Stand-in for the kernel's `Entity`, which does not exist until the kernel agent lands it. */
export class FakeEntity {
  readonly uid: string;

  constructor(uid: string) {
    this.uid = uid;
  }
}

/** Stand-in for a component class a `componentRef` field can point at. */
export class Camera {
  readonly uid: string;
  fov = 60;

  constructor(uid: string) {
    this.uid = uid;
  }
}

/** Stand-in for an asset class an `asset` field can point at. */
export class AudioClip {
  static assetType = "audio";
  duration = 0;
}

/** The exact schema from `docs/architecture/03-scripting-and-components.md` §3. */
export const moverSchema = {
  speed: f32(5, { min: 0, max: 50, tooltip: "Units per second" }),
  jumpHeight: f32(2),
  loops: i32(1),
  active: bool(true),
  label: str(""),
  offset: vec3({ x: 0, y: 1, z: 0 }),
  tint: color("#ffffff"),
  mode: enumOf(["walk", "run"] as const, "walk"),
  target: entityRef<FakeEntity>(),
  follow: componentRef(Camera),
  clip: asset(AudioClip),
  waypoints: array(vec3()),
  stats: record({ hp: i32(10), armor: f32(0) }),
};

/** A stand-in for a loaded `AssetHandle`, structural on the two members the codec reads. */
export interface FakeAssetHandle {
  readonly address: string;
  readonly type: string;
  readonly state: "loaded";
}

/** Builds a stand-in handle the asset resolver answers with. */
export function fakeAssetHandle(address: string, type: string): FakeAssetHandle {
  return { address, type, state: "loaded" };
}

/** Builds fake reference resolvers over a fixed set of entities and components. */
export function fakeReferences(
  entities: readonly FakeEntity[],
  components: readonly Camera[],
): {
  encoder: ReferenceEncoder;
  decoder: ReferenceDecoder;
} {
  const entityByUid = new Map(entities.map((entity) => [entity.uid, entity]));
  const componentByUid = new Map(components.map((component) => [component.uid, component]));
  return {
    encoder: {
      entityUid: (value) => (value instanceof FakeEntity ? value.uid : null),
      componentUid: (value) => (value instanceof Camera ? value.uid : null),
    },
    decoder: {
      entity: (uid) => entityByUid.get(uid) ?? null,
      component: (uid) => componentByUid.get(uid) ?? null,
      asset: (address, type) => fakeAssetHandle(address, type ?? "unknown"),
    },
  };
}

/** A field definition with a kind no constructor produces, used to reach `assertNever` branches. */
export const forgedField = {
  kind: "bogus",
  spec: { kind: "bogus" },
  options: {},
  createDefault: () => null,
} as unknown as FieldDefinition<unknown>;
