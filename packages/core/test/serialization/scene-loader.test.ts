import { describe, expect, it } from "vitest";
import { CoreErrorCode } from "../../src/errors/error-codes.js";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { SCENE_ASSET_TYPE, SCENE_FILE_FORMAT } from "../../src/serialization/scene-file.js";
import { createSceneLoader } from "../../src/serialization/scene-loader.js";
import { buildFile, entityRecord, fakeHandle } from "./fixtures.js";
import type { AssetHandle, LoaderContext } from "../../src/assets/types.js";
import type { SceneFile } from "../../src/serialization/scene-file.js";

/** The `AssetLoader` half of `06-serialization-and-scene-format.md` §4, steps 1 and 2. */

/** What a fake loader context recorded. */
interface FakeContext {
  /** The context to hand the loader. */
  readonly ctx: LoaderContext;
  /** Every address the loader asked for, in order. */
  readonly requested: { readonly address: string; readonly type: string | undefined }[];
}

/** Builds a loader context over a fixed JSON body. */
function contextFor(body: unknown, address = "levels/a.scene.json"): FakeContext {
  const requested: { readonly address: string; readonly type: string | undefined }[] = [];
  const ctx = {
    address,
    url: address,
    fragment: null,
    type: SCENE_ASSET_TYPE,
    fetchJson: () => Promise.resolve(body),
    loadDependency: (ref: string, options?: { readonly type?: string }): Promise<AssetHandle> => {
      requested.push({ address: ref, type: options?.type });
      return Promise.resolve(fakeHandle(ref, null, options?.type ?? "json"));
    },
  } as unknown as LoaderContext;
  return { ctx, requested };
}

/** A file with one entity carrying assets in several places. */
function fileWithAssets(): SceneFile {
  return {
    ...buildFile({
      entities: [
        entityRecord({
          uid: "A",
          instance: {
            scene: { $asset: "prefabs/p.prefab.json" },
            overrides: [
              { path: "P/components/Q/props/tex", value: { $asset: "textures/override.png" } },
              { op: "remove", path: "P/components/R" },
            ],
          },
          components: [
            {
              uid: "C",
              type: "test/Everything",
              props: {
                clip: { $asset: "audio/step.wav", type: "audio" },
                list: [{ $asset: "textures/a.png" }, { nested: { $asset: "textures/b.png" } }],
                again: { $asset: "audio/step.wav" },
              },
            },
          ],
        }),
      ],
    }),
    settings: { environment: { $asset: "env/studio.env" } },
  };
}

describe("createSceneLoader", () => {
  it("registers for the scene type and both extensions", () => {
    const loader = createSceneLoader();
    expect(loader.type).toBe(SCENE_ASSET_TYPE);
    expect([...loader.extensions]).toEqual([".scene.json", ".prefab.json"]);
  });

  it("parses a file, hashes it, and resolves every $asset once, settings first", async () => {
    const { ctx, requested } = contextFor(fileWithAssets());
    const asset = await createSceneLoader().load(ctx);
    expect(asset.address).toBe("levels/a.scene.json");
    expect(asset.file.format).toBe(SCENE_FILE_FORMAT);
    expect(asset.hash).toMatch(/^sha256:/u);
    expect(requested.map((entry) => entry.address)).toEqual([
      "env/studio.env",
      "prefabs/p.prefab.json",
      "textures/override.png",
      "audio/step.wav",
      "textures/a.png",
      "textures/b.png",
    ]);
    expect(requested[1]?.type).toBe(SCENE_ASSET_TYPE);
    expect(requested[3]?.type).toBe("audio");
    expect(asset.dependencies).toHaveLength(6);
  });

  it("rejects a file that is not a scene", async () => {
    const { ctx } = contextFor({ format: "ignifx.material", formatVersion: 1 });
    await expect(createSceneLoader().load(ctx)).rejects.toThrow(/is not an ignifx scene file/u);
    try {
      await createSceneLoader().load(contextFor([]).ctx);
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.notASceneFile);
    }
  });

  it("rejects a format version this build cannot read", async () => {
    const { ctx } = contextFor({ format: SCENE_FILE_FORMAT, formatVersion: 2, name: "n", entities: [] });
    try {
      await createSceneLoader().load(ctx);
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.unsupportedFormatVersion);
    }
  });

  it("rejects a structurally invalid file with the issue list", async () => {
    const { ctx } = contextFor({ format: SCENE_FILE_FORMAT, formatVersion: 1, name: "n", entities: [{ uid: 1 }] });
    try {
      await createSceneLoader().load(ctx);
      expect.unreachable();
    } catch (error) {
      expect(isIgnifxError(error) && error.code).toBe(CoreErrorCode.sceneFileInvalid);
      expect(String(error)).toContain("entities/0/uid");
    }
  });

  it("ignores an empty address and non-object override values", async () => {
    const { ctx, requested } = contextFor({
      ...buildFile({
        entities: [
          entityRecord({
            uid: "A",
            instance: {
              scene: { $asset: "p.prefab.json" },
              overrides: [
                { path: "P/name", value: "x" },
                { op: "remove", path: "P/components/Q" },
              ],
            },
            components: [{ uid: "C", type: "test/Everything", props: { a: { $asset: "" }, b: [1, null, "x"] } }],
          }),
        ],
      }),
    });
    const asset = await createSceneLoader().load(ctx);
    expect(requested.map((entry) => entry.address)).toEqual(["p.prefab.json"]);
    expect(asset.dependencies).toHaveLength(1);
  });

  it("skips validation when it is switched off", async () => {
    const { ctx } = contextFor({
      format: SCENE_FILE_FORMAT,
      formatVersion: 1,
      name: "n",
      entities: [{ uid: "A", name: "A", parent: null, transform: { position: [0], rotation: [], scale: [] } }],
    });
    const asset = await createSceneLoader({ validate: false }).load(ctx);
    expect(asset.file.entities).toHaveLength(1);
  });
});
