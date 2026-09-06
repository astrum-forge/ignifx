import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CliError,
  copyTemplate,
  DEFAULT_DEPENDENCY_RANGE,
  DEFAULT_IGNORED_ENTRIES,
  DEFAULT_TEMPLATE_RENAMES,
  VERSION,
} from "../src/index.js";

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
  await writeFileAt(
    join(templateDir, "_package.json"),
    `${JSON.stringify(
      {
        name: "game",
        dependencies: { "@ignifx/core": "workspace:*", "@ignifx/2d": "workspace:^", left: "^1.2.3" },
        devDependencies: { "@ignifx/vite-plugin": "workspace:~", pinned: "workspace:1.4.0" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFileAt(join(templateDir, "_gitignore"), "dist\n");
  await writeFileAt(join(templateDir, "index.html"), "<!doctype html>\n");
  await writeFileAt(join(templateDir, "src", "main.ts"), "export const start = 1;\n");
  await writeFileAt(join(templateDir, "src", "scenes", "main.scene.json"), "{}\n");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("copyTemplate", () => {
  it("names the copied project after the target directory", async () => {
    const target = join(workspace, "My Game!");
    await copyTemplate({ templateDir, targetDir: target });
    const written: unknown = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect((written as { name: string }).name).toBe("my-game");
  });

  it("uses an explicit projectName, and keeps the template's name when it is null", async () => {
    await copyTemplate({ templateDir, targetDir, projectName: "starship" });
    const named: unknown = JSON.parse(await readFile(join(targetDir, "package.json"), "utf8"));
    expect((named as { name: string }).name).toBe("starship");

    const kept = join(workspace, "kept");
    await copyTemplate({ templateDir, targetDir: kept, projectName: null });
    const original: unknown = JSON.parse(await readFile(join(templateDir, "_package.json"), "utf8"));
    const copied: unknown = JSON.parse(await readFile(join(kept, "package.json"), "utf8"));
    expect((copied as { name: string }).name).toBe((original as { name: string }).name);
  });

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

  it("rewrites every workspace: specifier in the copied package.json", async () => {
    expect(DEFAULT_DEPENDENCY_RANGE).toBe(`^${VERSION}`);

    await copyTemplate({ templateDir, targetDir });

    const manifest: unknown = JSON.parse(await readFile(join(targetDir, "package.json"), "utf8"));
    expect(manifest).toMatchObject({
      dependencies: {
        // `workspace:*` and `workspace:^` both mean "the range this release publishes".
        "@ignifx/core": DEFAULT_DEPENDENCY_RANGE,
        "@ignifx/2d": DEFAULT_DEPENDENCY_RANGE,
        // Anything that was not a workspace specifier is untouched.
        left: "^1.2.3",
      },
      devDependencies: {
        "@ignifx/vite-plugin": `~${VERSION}`,
        // `workspace:<range>` keeps the range, which is what pnpm's own publish does.
        pinned: "1.4.0",
      },
    });
  });

  it("honours an explicit dependency range", async () => {
    await copyTemplate({ templateDir, targetDir, dependencyRange: "^1.2.0" });

    const manifest: unknown = JSON.parse(await readFile(join(targetDir, "package.json"), "utf8"));
    expect(manifest).toMatchObject({ dependencies: { "@ignifx/core": "^1.2.0" } });
  });

  it("copies package.json byte for byte when the rewrite is switched off", async () => {
    const before = await readFile(join(templateDir, "_package.json"), "utf8");

    // Byte for byte needs both rewrites off: the range and the project name.
    await copyTemplate({ templateDir, targetDir, dependencyRange: null, projectName: null });

    await expect(readFile(join(targetDir, "package.json"), "utf8")).resolves.toBe(before);
  });

  it("copies an unparseable package.json verbatim rather than failing the scaffold", async () => {
    await writeFileAt(join(templateDir, "_package.json"), "{ not json");

    await copyTemplate({ templateDir, targetDir });

    await expect(readFile(join(targetDir, "package.json"), "utf8")).resolves.toBe("{ not json");
  });

  it("leaves a package.json with no workspace specifier untouched", async () => {
    await writeFileAt(join(templateDir, "_package.json"), '{"name":"game","dependencies":{"left":"^1.0.0"}}');

    await copyTemplate({ templateDir, targetDir, projectName: null });

    await expect(readFile(join(targetDir, "package.json"), "utf8")).resolves.toBe(
      '{"name":"game","dependencies":{"left":"^1.0.0"}}',
    );
  });
});

/**
 * Adds a desktop variant to a fixture template.
 *
 * @param directory - The template being extended.
 */
async function addDesktopVariant(directory: string): Promise<void> {
  await mkdir(join(directory, "desktop"), { recursive: true });
  await writeFile(join(directory, "desktop", "main.ts"), "export const main = 1;\n", "utf8");
  await writeFile(join(directory, "desktop", "preload.ts"), "export const preload = 1;\n", "utf8");
  await writeFile(join(directory, "electron.vite.config.ts"), "export default {};\n", "utf8");
  await writeFile(join(directory, "electron-builder.yml"), "appId: com.example.game\n", "utf8");
  await writeFile(
    join(directory, "_package.json"),
    `${JSON.stringify(
      {
        name: "game",
        scripts: {
          dev: "vite",
          build: "vite build",
          "dev:desktop": "electron-vite dev",
          "dist:desktop": "electron-builder --dir",
        },
        dependencies: { "@ignifx/core": "workspace:*" },
        devDependencies: {
          "@ignifx/electron": "workspace:*",
          "@ignifx/vite-plugin": "workspace:*",
          electron: "catalog:",
          "electron-builder": "catalog:",
          "electron-vite": "catalog:",
          vite: "catalog:",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("the desktop variant", () => {
  it("is left out by default, files and all", async () => {
    await addDesktopVariant(templateDir);
    const target = join(workspace, "browser-game");

    const result = await copyTemplate({ templateDir, targetDir: target });

    expect(result.files).not.toContain("desktop/main.ts");
    expect(result.files).not.toContain("desktop/preload.ts");
    expect(result.files).not.toContain("electron.vite.config.ts");
    expect(result.files).not.toContain("electron-builder.yml");
    expect(result.files).toContain("src/main.ts");
  });

  it("is copied whole with desktop: true", async () => {
    await addDesktopVariant(templateDir);
    const target = join(workspace, "desktop-game");

    const result = await copyTemplate({ templateDir, targetDir: target, desktop: true });

    expect(result.files).toContain("desktop/main.ts");
    expect(result.files).toContain("desktop/preload.ts");
    expect(result.files).toContain("electron.vite.config.ts");
    expect(result.files).toContain("electron-builder.yml");
  });

  it("strips the desktop scripts and dependencies from a browser-only scaffold", async () => {
    await addDesktopVariant(templateDir);
    const target = join(workspace, "browser-game");

    await copyTemplate({ templateDir, targetDir: target });
    const manifest: unknown = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    const document = manifest as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(Object.keys(document.scripts)).toEqual(["dev", "build"]);
    // A browser game must not download an Electron binary it never runs — but it keeps
    // `@ignifx/electron`, because `src/main.ts` registers the (inert) `electron()` extension in
    // both builds.
    expect(Object.keys(document.devDependencies)).toEqual(["@ignifx/electron", "@ignifx/vite-plugin", "vite"]);
  });

  it("keeps them with desktop: true, workspace ranges rewritten as usual", async () => {
    await addDesktopVariant(templateDir);
    const target = join(workspace, "desktop-game");

    await copyTemplate({ templateDir, targetDir: target, desktop: true, dependencyRange: "^9.9.9" });
    const document = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(document.scripts["dev:desktop"]).toBe("electron-vite dev");
    expect(document.scripts["dist:desktop"]).toBe("electron-builder --dir");
    expect(document.devDependencies["@ignifx/electron"]).toBe("^9.9.9");
    expect(document.devDependencies["electron"]).toBe("catalog:");
  });

  it("still applies the _gitignore rename in both modes", async () => {
    await addDesktopVariant(templateDir);
    await writeFile(join(templateDir, "_gitignore"), "dist\nnode_modules\n", "utf8");

    const browser = await copyTemplate({ templateDir, targetDir: join(workspace, "a") });
    const desktop = await copyTemplate({ templateDir, targetDir: join(workspace, "b"), desktop: true });

    expect(browser.files).toContain(".gitignore");
    expect(browser.files).not.toContain("_gitignore");
    expect(desktop.files).toContain(".gitignore");
    expect(desktop.files).not.toContain("_gitignore");
  });
});
