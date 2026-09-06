import { describe, expect, it, vi } from "vitest";
import { DEVTOOLS_CLASS_NAMES } from "../src/dom/styles.js";
import { createOverlayHarness } from "./support/app.js";
import type { OverlayHarness } from "./support/app.js";
import type { FakeElement } from "./support/fake-dom.js";
import type { AssetManifest } from "@ignifx/core";

/**
 * The Assets panel, driven over a real manifest and a real asset service.
 *
 * The asset-delivery rule applies: the harness never calls `app.start()`, so a completed load
 * settles as soon as it finishes and `await handle.promise` is enough.
 */

/** A two-entry manifest whose bodies the harness's injected `fetch` answers. */
const MANIFEST: AssetManifest = {
  format: "ignifx.manifest",
  formatVersion: 1,
  root: "",
  entries: [
    { address: "data/config.json", url: "data/config.json", bytes: 2048 },
    { address: "data/unused.json", url: "data/unused.json" },
  ],
};

/**
 * Opens the overlay with only the Assets panel.
 *
 * @returns The harness and the panel container.
 */
async function openAssets(): Promise<{ h: OverlayHarness; panel: FakeElement }> {
  const h = await createOverlayHarness({
    settings: { panels: ["assets"] },
    manifest: MANIFEST,
    files: { "data/config.json": '{"a":1}', "data/unused.json": "{}" },
  });
  h.service.open();
  const root = h.dom.document.body.byClass(DEVTOOLS_CLASS_NAMES.root)[0];
  const panel = root?.byClass(DEVTOOLS_CLASS_NAMES.body)[0]?.children[0];
  if (panel === undefined) {
    throw new TypeError("The assets panel did not mount.");
  }
  return { h, panel };
}

/**
 * Reads the panel's visible rows.
 *
 * @param panel - The panel container.
 * @returns One `address | detail` string per visible row.
 */
function rows(panel: FakeElement): string[] {
  return panel
    .byClass(DEVTOOLS_CLASS_NAMES.row)
    .filter((row: FakeElement): boolean => row.style.getPropertyValue("display") !== "none")
    .map(
      (row: FakeElement): string =>
        `${row.byClass(DEVTOOLS_CLASS_NAMES.label)[0]?.textContent ?? ""} | ${
          row.byClass(DEVTOOLS_CLASS_NAMES.value)[0]?.textContent ?? ""
        }`,
    );
}

describe("the Assets panel", () => {
  it("shows only the manifest addresses that have a live handle, with state, refcount and size", async () => {
    const { h, panel } = await openAssets();
    const handle = h.app.assets.load("data/config.json");
    await handle.promise;
    h.step(1);

    expect(rows(panel)).toEqual(["data/config.json | loaded · 1 ref · 2.00 KiB"]);
    expect(panel.byClass(DEVTOOLS_CLASS_NAMES.label)[0]?.textContent).toContain("1 live of 2 in manifest");
    h.dispose();
  });

  it("shows a manifest entry with no recorded size as unmeasured", async () => {
    const { h, panel } = await openAssets();
    await h.app.assets.load("data/unused.json").promise;
    h.step(1);

    expect(rows(panel)[0]).toContain("| loaded · 1 ref · -");
    h.dispose();
  });

  it("hides a row again once its handle is released and collected", async () => {
    const { h, panel } = await openAssets();
    const handle = h.app.assets.load("data/config.json");
    await handle.promise;
    h.step(1);
    expect(rows(panel)).toHaveLength(1);

    handle.release();
    h.app.assets.gc();
    h.step(1);

    expect(rows(panel)).toHaveLength(0);
    h.dispose();
  });

  it("forces a reload through the asset service's own entry point", async () => {
    const { h, panel } = await openAssets();
    await h.app.assets.load("data/config.json").promise;
    h.step(1);
    const spy = vi.spyOn(h.app.assets as unknown as { reload: (address: string) => void }, "reload");

    const reload = panel
      .byClass(DEVTOOLS_CLASS_NAMES.button)
      .find((node: FakeElement): boolean => node.textContent === "reload");
    expect(reload?.disabled).toBe(false);
    reload?.dispatch("click");

    expect(spy).toHaveBeenCalledWith("data/config.json");
    h.dispose();
  });

  it("disables the button and reports IGX-1555 on a build with no reload entry point", async () => {
    const h = await createOverlayHarness({
      settings: { panels: ["assets"] },
      manifest: MANIFEST,
      files: { "data/config.json": "{}" },
    });
    const reported: string[] = [];
    h.app.onError.connect((entry) => {
      reported.push(String(entry.error));
    });
    // `reload` lives on the service's prototype; an own property of `undefined` shadows it, which
    // is what a build of `@ignifx/core` without the entry point looks like from outside.
    Reflect.defineProperty(h.app.assets, "reload", { value: undefined, configurable: true });
    h.service.open();
    const root = h.dom.document.body.byClass(DEVTOOLS_CLASS_NAMES.root)[0];
    const panel = root?.byClass(DEVTOOLS_CLASS_NAMES.body)[0]?.children[0];
    await h.app.assets.load("data/config.json").promise;
    h.step(1);

    const reload = panel
      ?.byClass(DEVTOOLS_CLASS_NAMES.button)
      .find((node: FakeElement): boolean => node.textContent === "reload");
    expect(reload?.disabled).toBe(true);
    reload?.dispatch("click");

    expect(reported.join(" ")).toContain("IGX-1555");
    h.dispose();
  });
});
