import { describeRegisteredSchemas, describeSchemas } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { createThirdPersonApp } from "./third-person-app.js";
import type { App } from "@ignifx/core";

/**
 * Engine ask E19: the schemas an external inspector is generated from, described over the
 * `3d-third-person` app the way the ignifx editor's scene view builds it, name the package that
 * registered each component and whether an entity may hold more than one.
 */

const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.dispose();
  }
});

describe("3d-third-person: registered schema descriptions", () => {
  it("names the registering package of engine, extension, and project components", async () => {
    const { app } = await createThirdPersonApp();
    apps.push(app);
    const described = describeRegisteredSchemas(app.world.registry, describeSchemas());

    expect(described["ignifx/Camera"]).toMatchObject({
      title: "Camera",
      package: "@ignifx/core",
      allowMultiple: false,
    });
    expect(described["ignifx/MeshRenderer"]).toMatchObject({ package: "@ignifx/core", allowMultiple: true });
    expect(described["ignifx/ThirdPersonController"]?.package).toBe("@ignifx/3d");
    expect(described["ignifx/Rigidbody"]?.package).toBe("@ignifx/physics");
    expect(described["ignifx/AudioSource"]?.package).toBe("@ignifx/audio");
    // The project's scripts are registered by the game, so their package is the type id's namespace.
    expect(described["third-person/Beacon"]).toMatchObject({ package: "third-person", allowMultiple: true });

    for (const [typeId, description] of Object.entries(described)) {
      expect(typeof description.package, typeId).toBe("string");
      expect(typeof description.allowMultiple, typeId).toBe("boolean");
    }
  });

  it("names the types reference fields accept, in engine and project schemas", async () => {
    const { app } = await createThirdPersonApp();
    apps.push(app);
    const described = describeRegisteredSchemas(app.world.registry);

    expect(described["third-person/Beacon"]?.fields["column"]).toEqual({
      kind: "componentRef",
      default: null,
      componentType: "ignifx/MeshRenderer",
    });
    const meshRenderer = described["ignifx/MeshRenderer"]?.fields;
    expect(meshRenderer?.["mesh"]).toMatchObject({ kind: "asset", assetType: "mesh" });
    expect(meshRenderer?.["materials"]?.item).toEqual({ kind: "asset", default: null, assetType: "material" });
  });
});
