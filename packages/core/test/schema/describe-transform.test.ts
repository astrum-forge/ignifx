import { afterEach, describe, expect, it } from "vitest";
import {
  createApp,
  createManualClock,
  createMemorySink,
  describeSchemas,
  serializeScene,
  Transform,
  transformSchema,
} from "../../src/index.js";
import { describeRegisteredSchemas } from "../../src/schema/describe-registry.js";
import { toJsonSchema } from "../../src/schema/describe.js";
import { SCENE_FILE_FORMAT } from "../../src/serialization/scene-file.js";
import type { App } from "../../src/index.js";

/**
 * Engine ask E4: the entity transform is described as a schema, so an inspector and its ops can
 * treat it like every component, while the scene file keeps storing it as each entity's
 * `transform` block.
 */

/** The transform's field descriptions, as `describeSchemas()` publishes them. */
const TRANSFORM_FIELDS = {
  position: {
    kind: "vec3",
    default: [0, 0, 0],
    description: "Local position relative to the parent, in metres.",
    step: 0.01,
  },
  rotation: {
    kind: "quat",
    default: [0, 0, 0, 1],
    description:
      "Local rotation relative to the parent: a unit quaternion [x, y, z, w], shown as intrinsic XYZ Euler angles in degrees.",
    step: 0.5,
  },
  scale: { kind: "vec3", default: [1, 1, 1], description: "Local scale relative to the parent.", step: 0.01 },
};

describe("transformSchema", () => {
  it("returns a new schema on every call", () => {
    expect(transformSchema()).not.toBe(transformSchema());
    expect(Object.keys(transformSchema())).toEqual(["position", "rotation", "scale"]);
  });

  it("is not declared on the Transform class, whose position and rotation are world-space", () => {
    expect(Object.hasOwn(Transform, "schema")).toBe(false);
  });

  it("writes the JSON Schema of a scene file's transform block", () => {
    expect(toJsonSchema(transformSchema())).toEqual({
      type: "object",
      properties: {
        position: {
          type: "array",
          items: { type: "number" },
          minItems: 3,
          maxItems: 3,
          "x-ignifx-step": 0.01,
          description: "Local position relative to the parent, in metres.",
          default: [0, 0, 0],
        },
        rotation: {
          type: "array",
          items: { type: "number" },
          minItems: 4,
          maxItems: 4,
          "x-ignifx-step": 0.5,
          description: TRANSFORM_FIELDS.rotation.description,
          default: [0, 0, 0, 1],
        },
        scale: {
          type: "array",
          items: { type: "number" },
          minItems: 3,
          maxItems: 3,
          "x-ignifx-step": 0.01,
          description: "Local scale relative to the parent.",
          default: [1, 1, 1],
        },
      },
      additionalProperties: false,
    });
  });
});

describe("describeSchemas: ignifx/Transform", () => {
  it("describes the transform as a built-in component of @ignifx/core", () => {
    expect(describeSchemas()["ignifx/Transform"]).toEqual({
      title: "Transform",
      format: "components",
      description:
        "The entity's local position, rotation, and scale; every entity has exactly one, stored as its transform block.",
      fields: TRANSFORM_FIELDS,
      allowMultiple: false,
      package: "@ignifx/core",
      builtIn: true,
    });
  });

  it("marks no other entry built-in", () => {
    const builtIn = Object.entries(describeSchemas())
      .filter(([, description]) => description.builtIn !== undefined)
      .map(([typeId]) => typeId);
    expect(builtIn).toEqual(["ignifx/Transform"]);
  });
});

describe("describeRegisteredSchemas: ignifx/Transform", () => {
  let app: App | null = null;

  afterEach(() => {
    app?.dispose();
    app = null;
  });

  /**
   * Starts a headless app.
   *
   * @returns The app.
   */
  async function headless(): Promise<App> {
    app = await createApp({ headless: true, clock: createManualClock(), logSink: createMemorySink() });
    return app;
  }

  it("describes the registered Transform with its schema and marks it built-in", async () => {
    const { registry } = (await headless()).world;
    expect(describeRegisteredSchemas(registry, describeSchemas())["ignifx/Transform"]).toEqual(
      describeSchemas()["ignifx/Transform"],
    );
    // Without the curated record the fields, allowMultiple, package and builtIn still come through.
    expect(describeRegisteredSchemas(registry)["ignifx/Transform"]).toEqual({
      title: "Transform",
      format: "components",
      fields: TRANSFORM_FIELDS,
      allowMultiple: false,
      package: "@ignifx/core",
      builtIn: true,
    });
  });

  it("leaves every other registered component unmarked", async () => {
    const described = describeRegisteredSchemas((await headless()).world.registry, describeSchemas());
    for (const [typeId, description] of Object.entries(described)) {
      expect({ typeId, builtIn: description.builtIn }).toEqual({
        typeId,
        builtIn: typeId === "ignifx/Transform" ? true : undefined,
      });
    }
  });

  it("matches the transform block a scene file stores, which stays out of components", async () => {
    const world = (await headless()).world;
    const entity = world.createEntity("Box");
    entity.transform.localPosition.set(1, 2, 3);
    const file = serializeScene(world.activeScene);
    expect(file.format).toBe(SCENE_FILE_FORMAT);
    const record = file.entities.find((candidate) => candidate.name === "Box");
    expect(Object.keys(record?.transform ?? {})).toEqual(Object.keys(transformSchema()));
    expect(record?.transform.position).toEqual([1, 2, 3]);
    expect(record?.components?.some((component) => component.type === "ignifx/Transform") ?? false).toBe(false);
  });
});
