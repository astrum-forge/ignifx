import { describe, expect, it } from "vitest";
import { ENVIRONMENT_FILE_FORMAT } from "../../src/render/environment-asset.js";
import { MATERIAL_FILE_FORMAT } from "../../src/render/material-asset.js";
import {
  describeEnvironmentFileFormat,
  describeMaterialFileFormat,
  describeSchemas,
} from "../../src/render/schemas.js";
import { SCENE_FILE_FORMAT } from "../../src/serialization/scene-file.js";

/**
 * `describeSchemas()`, the record `pnpm docs:schemas` reads out of the built entry point
 * (`scripts/README.md`, "Schema discovery convention").
 *
 * The harness rejects a key that is not a namespaced `<package>/<Name>` type id and groups entries
 * onto a page by their `format`, so the three file formats are keyed like components and declare
 * their own `format` — asserted here because the harness's own validation runs at build time and a
 * mistake would otherwise surface as a silently missing documentation page.
 */

describe("describeSchemas", () => {
  it("is a function, not a module-scope object", () => {
    expect(typeof describeSchemas).toBe("function");
    expect(describeSchemas()).not.toBe(describeSchemas());
  });

  it("describes every component the core extension registers", () => {
    const schemas = describeSchemas();
    expect(Object.keys(schemas).toSorted()).toEqual([
      "ignifx/Camera",
      "ignifx/Environment",
      "ignifx/Light",
      "ignifx/MeshRenderer",
      "ignifx/Model",
      "ignifx/PostProcessStack",
      "ignifx/environment-file",
      "ignifx/material-file",
      "ignifx/scene-file",
    ]);
  });

  it("namespaces every key, which is what the harness requires", () => {
    for (const key of Object.keys(describeSchemas())) {
      expect(key).toContain("/");
    }
  });

  it("carries a kind and a default for every field", () => {
    const schemas = describeSchemas();
    for (const [typeId, description] of Object.entries(schemas)) {
      expect({ typeId, hasFields: Object.keys(description.fields).length > 0 }).toEqual({ typeId, hasFields: true });
      for (const [name, field] of Object.entries(description.fields)) {
        expect({ typeId, name, kind: typeof field.kind }).toEqual({ typeId, name, kind: "string" });
        expect({ typeId, name, hasDefault: Object.hasOwn(field, "default") }).toEqual({
          typeId,
          name,
          hasDefault: true,
        });
      }
    }
  });

  it("groups the components onto the components page and the files onto their own", () => {
    const schemas = describeSchemas();
    expect(schemas["ignifx/Camera"]?.format).toBe("components");
    expect(schemas["ignifx/scene-file"]?.format).toBe(SCENE_FILE_FORMAT);
    expect(schemas["ignifx/material-file"]?.format).toBe(MATERIAL_FILE_FORMAT);
    expect(schemas["ignifx/environment-file"]?.format).toBe(ENVIRONMENT_FILE_FORMAT);
  });

  it("encodes the component defaults as the JSON a scene file would carry", () => {
    const camera = describeSchemas()["ignifx/Camera"];
    expect(camera?.fields["fov"]?.default).toBe(60);
    expect(camera?.fields["viewport"]?.default).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(camera?.fields["clearColor"]?.default).toBeNull();
    expect(camera?.fields["fov"]?.description).toContain("field of view");
  });

  it("describes the two file formats this package owns", () => {
    const material = describeMaterialFileFormat();
    expect(material.fields["format"]?.default).toBe(MATERIAL_FILE_FORMAT);
    expect(material.fields["formatVersion"]?.default).toBe(1);
    expect(material.fields["baseColorTexture"]?.kind).toBe("asset");

    const environment = describeEnvironmentFileFormat();
    expect(environment.fields["format"]?.default).toBe(ENVIRONMENT_FILE_FORMAT);
    expect(environment.fields["skyboxSize"]?.default).toBe(20);
  });
});
