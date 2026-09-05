import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError, copyTemplate, DEFAULT_IGNORED_ENTRIES, DEFAULT_TEMPLATE_RENAMES } from "../src/index.js";

let workspace = "";
let templateDir = "";
let targetDir = "";

/**
 * Writes a file and every directory above it.
 */
async function writeFileAt(path: string, contents: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "ignifx-cli-copy-"));
  templateDir = join(workspace, "template");
  targetDir = join(workspace, "target");
  await writeFileAt(join(templateDir, "_package.json"), '{ "name": "game" }\n');
  await writeFileAt(join(templateDir, "_gitignore"), "dist\n");
  await writeFileAt(join(templateDir, "index.html"), "<!doctype html>\n");
  await writeFileAt(join(templateDir, "src", "main.ts"), "export const start = 1;\n");
  await writeFileAt(join(templateDir, "src", "scenes", "main.scene.json"), "{}\n");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("copyTemplate", () => {
  it("copies the whole tree and reports sorted relative paths", async () => {
    const result = await copyTemplate({ templateDir, targetDir });

    expect(result.files).toEqual([
      ".gitignore",
      "index.html",
      "package.json",
      "src/main.ts",
      "src/scenes/main.scene.json",
    ]);
    await expect(readFile(join(targetDir, "src", "scenes", "main.scene.json"), "utf8")).resolves.toBe("{}\n");
    await expect(readFile(join(targetDir, "index.html"), "utf8")).resolves.toBe("<!doctype html>\n");
  });

  it("applies the default rename map that npm publishing requires", async () => {
    expect(DEFAULT_TEMPLATE_RENAMES).toEqual({ _gitignore: ".gitignore", "_package.json": "package.json" });

    await copyTemplate({ templateDir, targetDir });

    const entries = await readdir(targetDir);
    expect(entries).toContain(".gitignore");
    expect(entries).toContain("package.json");
    expect(entries).not.toContain("_gitignore");
    expect(entries).not.toContain("_package.json");
  });

  it("applies a caller-supplied rename map instead of the default", async () => {
    const result = await copyTemplate({ templateDir, targetDir, rename: { "index.html": "start.html" } });

    expect(result.files).toContain("start.html");
    // The default map is replaced, not merged, so the underscore names survive verbatim.
    expect(result.files).toContain("_gitignore");
  });

  it("does not rename entries whose names only exist on Object.prototype", async () => {
    await writeFileAt(join(templateDir, "toString"), "not a function\n");

    const result = await copyTemplate({ templateDir, targetDir });

    expect(result.files).toContain("toString");
  });

  it("skips the default ignore list at every depth", async () => {
    expect(DEFAULT_IGNORED_ENTRIES).toEqual(["node_modules", "dist", ".turbo"]);
    await writeFileAt(join(templateDir, "node_modules", "left-pad", "index.js"), "");
    await writeFileAt(join(templateDir, "dist", "bundle.js"), "");
    await writeFileAt(join(templateDir, "src", ".turbo", "log.txt"), "");

    const result = await copyTemplate({ templateDir, targetDir });

    expect(result.files.some((file) => file.includes("node_modules"))).toBe(false);
    expect(result.files.some((file) => file.includes("dist"))).toBe(false);
    expect(result.files.some((file) => file.includes(".turbo"))).toBe(false);
    await expect(readdir(targetDir)).resolves.not.toContain("node_modules");
  });

  it("honours a caller-supplied ignore list", async () => {
    const result = await copyTemplate({ templateDir, targetDir, ignore: ["src"] });

    expect(result.files).toEqual([".gitignore", "index.html", "package.json"]);
  });

  it("refuses a non-empty target directory", async () => {
    await writeFileAt(join(targetDir, "existing.txt"), "keep me\n");

    await expect(copyTemplate({ templateDir, targetDir })).rejects.toThrow(CliError);
    await expect(copyTemplate({ templateDir, targetDir })).rejects.toMatchObject({ code: "IGX-1401" });
    // Nothing was written next to the pre-existing file.
    await expect(readdir(targetDir)).resolves.toEqual(["existing.txt"]);
  });

  it("writes into a non-empty target directory when overwrite is requested", async () => {
    await writeFileAt(join(targetDir, "index.html"), "old\n");

    const result = await copyTemplate({ templateDir, targetDir, overwrite: true });

    expect(result.files).toContain("index.html");
    await expect(readFile(join(targetDir, "index.html"), "utf8")).resolves.toBe("<!doctype html>\n");
  });

  it("accepts an existing but empty target directory", async () => {
    await mkdir(targetDir, { recursive: true });

    const result = await copyTemplate({ templateDir, targetDir });

    expect(result.files.length).toBe(5);
  });

  it("reports a missing template directory as IGX-1402", async () => {
    await expect(copyTemplate({ templateDir: join(workspace, "absent"), targetDir })).rejects.toMatchObject({
      code: "IGX-1402",
    });
  });

  it("reports a template path that is a file as IGX-1402", async () => {
    await expect(copyTemplate({ templateDir: join(templateDir, "index.html"), targetDir })).rejects.toMatchObject({
      code: "IGX-1402",
    });
  });

  it("surfaces a file-system failure other than a missing target directory", async () => {
    // The target path is a file, so reading it as a directory fails with ENOTDIR rather than ENOENT.
    const target = join(templateDir, "index.html");

    await expect(copyTemplate({ templateDir, targetDir: target })).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("rejects with the signal's reason and writes nothing when already aborted", async () => {
    const reason = new Error("cancelled by the caller");
    const controller = new AbortController();
    controller.abort(reason);

    await expect(copyTemplate({ templateDir, targetDir, signal: controller.signal })).rejects.toBe(reason);
    await expect(readdir(targetDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runs to completion with a signal that is never aborted", async () => {
    const controller = new AbortController();

    const result = await copyTemplate({ templateDir, targetDir, signal: controller.signal });

    expect(result.files.length).toBe(5);
  });
});
