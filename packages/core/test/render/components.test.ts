import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Environment } from "../../src/render/environment.js";
import { Light } from "../../src/render/light.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { Model } from "../../src/render/model.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { decodeProps, encodeProps } from "../../src/schema/encode.js";
import { createDefaults } from "../../src/schema/schema.js";
import { validateProps } from "../../src/schema/validate.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { ConcreteComponentType } from "../../src/component/component-type.js";
import type { ReferenceDecoder, ReferenceEncoder } from "../../src/schema/encode.js";

/**
 * Every render component's schema: its defaults, the values a fresh instance starts with, and the
 * round trip through `encodeProps`/`decodeProps` (`docs/architecture/07-rendering.md` §2,
 * `06-serialization-and-scene-format.md` §3).
 *
 * The pair of assertions that matters most is "a constructed instance equals
 * `createDefaults(Type.schema)`": these classes extend `Component` directly rather than
 * `Component.define(...)` — `isolatedDeclarations` forbids a call in an `extends` clause — so the
 * defaults reach an instance through the constructor rather than through the base class the schema
 * built. This is what catches a field declared in one place and not the other.
 */

/** The six components the core extension registers. */
const COMPONENTS: readonly ConcreteComponentType[] = [
  Camera,
  Light,
  MeshRenderer,
  Model,
  Environment,
  PostProcessStack,
];

/** Resolves nothing: every reference field of these components defaults to `null` or an empty list. */
const encoder: ReferenceEncoder = { entityUid: () => null, componentUid: () => null };

/** Resolves nothing, so a decoded reference is `null`. */
const decoder: ReferenceDecoder = { entity: () => null, component: () => null, asset: () => null };

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A headless app with the render layer registered.
 *
 * @returns The harness.
 */
async function app(): Promise<RenderHarness> {
  harness = await createRenderHarness();
  return harness;
}

describe("render component registration", () => {
  it("registers all six under their namespaced type ids", async () => {
    const h = await app();
    for (const type of COMPONENTS) {
      const typeId = type.typeId ?? "";
      expect(typeId.startsWith("ignifx/")).toBe(true);
      expect(h.world.registry.get(typeId)).toBe(type);
    }
  });

  it("allows several mesh renderers per entity and one of everything else", () => {
    expect(MeshRenderer.allowMultiple).toBe(true);
    expect(Camera.allowMultiple).toBe(false);
    expect(Light.allowMultiple).toBe(false);
    expect(Model.allowMultiple).toBe(false);
    expect(Environment.allowMultiple).toBe(false);
    expect(PostProcessStack.allowMultiple).toBe(false);
  });
});

describe("schema defaults", () => {
  it("starts every instance at exactly createDefaults(schema)", async () => {
    const h = await app();
    for (const type of COMPONENTS) {
      const entity = h.world.createEntity(type.typeId ?? "e");
      const component = entity.addComponent(type);
      const schema = type.schema ?? {};
      const expected = createDefaults(schema);
      for (const name of Object.keys(schema)) {
        const actual: unknown = Reflect.get(component, name);
        expect({ [name]: actual }).toEqual({ [name]: expected[name] });
      }
    }
  });

  it("documents the values 07-rendering.md §2.1 and §2.2 name", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera);
    expect(camera.projection).toBe("perspective");
    expect(camera.fov).toBe(60);
    expect(camera.orthographicSize).toBe(5);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(1000);
    expect(camera.viewport).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(camera.priority).toBe(0);
    expect(camera.clearColor).toBeNull();

    const light = h.world.createEntity("Sun").addComponent(Light);
    expect(light.type).toBe("directional");
    expect(light.intensity).toBe(1);
    expect(light.shadows.enabled).toBe(false);
    expect(light.shadows.technique).toBe("pcf");
    expect(light.shadows.mapSize).toBe(1024);
    expect(light.includeOnly).toEqual([]);

    const renderer = h.world.createEntity("Cube").addComponent(MeshRenderer);
    expect(renderer.mesh).toBeNull();
    expect(renderer.materials).toEqual([]);
    expect(renderer.castShadows).toBe(true);
    expect(renderer.receiveShadows).toBe(true);
    expect(renderer.renderOrder).toBe(0);
    expect(renderer.pickable).toBe(true);
  });

  it("gives each instance its own record and array objects", async () => {
    const h = await app();
    const first = h.world.createEntity("A").addComponent(Camera);
    const second = h.world.createEntity("B").addComponent(Camera);
    first.viewport.width = 0.5;
    expect(second.viewport.width).toBe(1);

    const one = h.world.createEntity("C").addComponent(Light);
    const two = h.world.createEntity("D").addComponent(Light);
    one.shadows.enabled = true;
    one.includeOnly.push(null);
    expect(two.shadows.enabled).toBe(false);
    expect(two.includeOnly).toEqual([]);
  });
});

describe("round trip through the schema codec", () => {
  it("re-encodes every component's defaults byte-identically", () => {
    for (const type of COMPONENTS) {
      const schema = type.schema ?? {};
      const encoded = encodeProps(schema, createDefaults(schema), encoder);
      const decoded = decodeProps(schema, encoded, decoder);
      expect(decoded.issues).toEqual([]);
      expect(encodeProps(schema, decoded.value, encoder)).toEqual(encoded);
    }
  });

  it("round-trips edited values", async () => {
    const h = await app();
    const camera = h.world.createEntity("Eye").addComponent(Camera, {
      projection: "orthographic",
      orthographicSize: 12,
      priority: 4,
      clearColor: { r: 1, g: 0, b: 0, a: 1 },
    });
    // `Camera.schema` is a `Schema`, not a literal type, so its `PartialFieldsOf` projection is an
    // index-signature record; a class instance has the same own properties but no index signature.
    // This is the collection `serialize.ts` performs for every component, spelled out once.
    const props: Record<string, unknown> = {};
    for (const name of Object.keys(Camera.schema)) {
      props[name] = Reflect.get(camera, name);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const encoded = encodeProps(Camera.schema, props as never, encoder);
    expect(encoded).toMatchObject({ projection: "orthographic", orthographicSize: 12, priority: 4 });
    const decoded = decodeProps(Camera.schema, encoded, decoder);
    expect(decoded.issues).toEqual([]);
    expect(decoded.value["clearColor"]).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("validates a fresh instance against its own schema", async () => {
    const h = await app();
    for (const type of COMPONENTS) {
      const component = h.world.createEntity("x").addComponent(type);
      const values: Record<string, unknown> = {};
      for (const name of Object.keys(type.schema ?? {})) {
        values[name] = Reflect.get(component, name);
      }
      expect(validateProps(type.schema ?? {}, values)).toEqual([]);
    }
  });
});
