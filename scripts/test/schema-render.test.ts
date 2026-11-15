import { describe, expect, it } from "vitest";
import { renderFormatPage, renderSchemaBundle } from "../lib/schema-render.ts";
import { normalizeRegistry } from "../lib/schema-source.ts";

/** A registry entry shaped like core's `describeSchemas()["ignifx/MeshRenderer"]`, trimmed. */
const REGISTRY = {
  "test/Renderer": {
    title: "Renderer",
    format: "components",
    fields: {
      mesh: { kind: "asset", default: null, assetType: "mesh" },
      lightmap: {
        kind: "optional",
        default: null,
        description: "A baked lightmap.",
        inner: {
          kind: "record",
          default: { asset: null, level: 1 },
          fields: {
            asset: { kind: "asset", default: null, description: "The lightmap.", assetType: "lightmap" },
            level: { kind: "f32", default: 1, min: 0 },
          },
        },
      },
      tags: { kind: "array", default: [], item: { kind: "record", default: {}, fields: { name: { kind: "str" } } } },
    },
  },
};

describe("docs:schemas rendering of nested fields", () => {
  it("lists a nested record's sub-fields on the page and in the bundle", () => {
    const errors: string[] = [];
    const schemas = normalizeRegistry("test", REGISTRY, errors);
    expect(errors).toEqual([]);
    const page = renderFormatPage("components", schemas);
    expect(page).toContain("| `mesh` | `asset (mesh)` | `null` |");
    expect(page).toContain("| `lightmap.asset` | `asset (lightmap)` | `null` | The lightmap. |");
    expect(page).toContain("| `lightmap.level` | `f32` | `1` |");
    expect(page).toContain("| `tags[].name` | `str` | — |");
    const bundle = JSON.parse(renderSchemaBundle("0.0.0", schemas)) as {
      schemas: Record<string, { fields: Record<string, { inner?: { fields?: Record<string, unknown> } }> }>;
    };
    expect(bundle.schemas["test/Renderer"]?.fields["lightmap"]?.inner?.fields?.["asset"]).toEqual({
      kind: "asset",
      default: "null",
      description: "The lightmap.",
      assetType: "lightmap",
    });
  });
});
