import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CliError,
  CliErrorCode,
  DEFAULT_DEPENDENCY_RANGE,
  DEFAULT_TEMPLATE,
  parseArgs,
  resolveTemplateDir,
  resolveTemplatesRoot,
  runCreate,
  TEMPLATE_ROOT_CANDIDATES,
  USAGE,
  type CreateIo,
} from "../src/index.js";

let workspace = "";
let templatesRoot = "";

/**
 * Collects the lines a command writes so assertions can read them back.
 */
function recordingIo(root: string): CreateIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => {
      out.push(line);
    },
    stderr: (line: string) => {
      err.push(line);
    },
    templatesRoot: root,
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "ignifx-cli-"));
  templatesRoot = join(workspace, "templates");
  await mkdir(join(templatesRoot, DEFAULT_TEMPLATE, "src"), { recursive: true });
  await writeFile(join(templatesRoot, DEFAULT_TEMPLATE, "_package.json"), '{ "name": "game" }\n', "utf8");
  await writeFile(join(templatesRoot, DEFAULT_TEMPLATE, "src", "main.ts"), "export const start = 1;\n", "utf8");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("defaults the template to 2d-topdown and overwrite to false", () => {
    expect(parseArgs(["my-game"])).toEqual({ targetDir: "my-game", template: "2d-topdown", overwrite: false });
    expect(DEFAULT_TEMPLATE).toBe("2d-topdown");
  });

  it("reads --template and --overwrite", () => {
    expect(parseArgs(["my-game", "--template", "3d-first-person", "--overwrite"])).toEqual({
      targetDir: "my-game",
      template: "3d-first-person",
      overwrite: true,
    });
  });

  it("accepts the target directory after the options", () => {
    expect(parseArgs(["--template", "2d-sidescroller", "my-game"]).targetDir).toBe("my-game");
  });

  it("reports --desktop as unavailable until Phase 9", () => {
    expect(() => parseArgs(["my-game", "--desktop"])).toThrow(CliError);
    try {
      parseArgs(["my-game", "--desktop"]);
      expect.unreachable("parseArgs should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe(CliErrorCode.invalidArguments);
      expect((error as CliError).message).toMatch(/Phase 9/u);
    }
  });

  it("reports a missing target directory with the usage line", () => {
    try {
      parseArgs([]);
      expect.unreachable("parseArgs should have thrown");
    } catch (error) {
      expect((error as CliError).code).toBe("IGX-1403");
      expect((error as CliError).message).toContain(USAGE);
    }
  });

  it("reports an unknown option as IGX-1403 and keeps the cause", () => {
    try {
      parseArgs(["my-game", "--nope"]);
      expect.unreachable("parseArgs should have thrown");
    } catch (error) {
      expect((error as CliError).code).toBe("IGX-1403");
      expect((error as CliError).message).toContain(USAGE);
      expect((error as CliError).cause).toBeInstanceOf(Error);
    }
  });

  it("reports a --template without a value", () => {
    expect(() => parseArgs(["my-game", "--template"])).toThrow(CliError);
  });

  it("refuses more than one target directory", () => {
    try {
      parseArgs(["one", "two"]);
      expect.unreachable("parseArgs should have thrown");
    } catch (error) {
      expect((error as CliError).code).toBe("IGX-1403");
      expect((error as CliError).message).toMatch(/but got 2/u);
    }
  });

  it("refuses an empty target directory", () => {
    expect(() => parseArgs([""])).toThrow(CliError);
  });
});

describe("resolveTemplateDir", () => {
  it("maps a template name to a directory under the templates root", async () => {
    await expect(resolveTemplateDir(DEFAULT_TEMPLATE, templatesRoot)).resolves.toBe(
      join(templatesRoot, DEFAULT_TEMPLATE),
    );
  });

  it("reports an unknown template as IGX-1402", async () => {
    await expect(resolveTemplateDir("nope", templatesRoot)).rejects.toMatchObject({ code: "IGX-1402" });
  });

  it("reports a template name that is a file as IGX-1402", async () => {
    await writeFile(join(templatesRoot, "readme.md"), "not a template\n", "utf8");

    await expect(resolveTemplateDir("readme.md", templatesRoot)).rejects.toMatchObject({ code: "IGX-1402" });
  });

  it.each(["", ".", "..", "../elsewhere", "nested/name", "nested\\name"])(
    "refuses the template name %j before touching the file system",
    async (name) => {
      await expect(resolveTemplateDir(name, templatesRoot)).rejects.toMatchObject({ code: "IGX-1402" });
    },
  );
});

describe("runCreate", () => {
  it("scaffolds a project and reports what it did through the injected io", async () => {
    const io = recordingIo(templatesRoot);
    const targetDir = join(workspace, "my-game");

    const result = await runCreate([targetDir], io);

    expect(result.files).toEqual(["package.json", "src/main.ts"]);
    // The project is named after its directory, so the scaffold rewrites the template's `name`.
    await expect(readFile(join(targetDir, "package.json"), "utf8")).resolves.toBe('{\n  "name": "my-game"\n}\n');
    expect(io.out).toHaveLength(3);
    expect(io.out[0]).toContain("2d-topdown");
    expect(io.out[1]).toBe("Wrote 2 files.");
    expect(io.err).toEqual([]);
  });

  it("passes --overwrite through to the copy", async () => {
    const io = recordingIo(templatesRoot);
    const targetDir = join(workspace, "my-game");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "stale.txt"), "old\n", "utf8");

    await expect(runCreate([targetDir], io)).rejects.toMatchObject({ code: "IGX-1401" });
    await expect(runCreate([targetDir, "--overwrite"], io)).resolves.toMatchObject({
      files: ["package.json", "src/main.ts"],
    });
  });

  it("fails with IGX-1402 before creating anything when the template is unknown", async () => {
    const io = recordingIo(templatesRoot);
    const targetDir = join(workspace, "my-game");

    await expect(runCreate([targetDir, "--template", "nope"], io)).rejects.toMatchObject({ code: "IGX-1402" });
    expect(io.out).toEqual([]);
  });

  it("propagates an argument error without touching the file system", async () => {
    const io = recordingIo(templatesRoot);

    await expect(runCreate([], io)).rejects.toMatchObject({ code: "IGX-1403" });
  });
});

describe("CliError", () => {
  it("carries a stable code and keeps the cause", () => {
    const cause = new Error("underlying");
    const error = new CliError(CliErrorCode.targetNotEmpty, "not empty", { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CliError");
    expect(error.code).toBe("IGX-1401");
    expect(error.cause).toBe(cause);
  });

  it("exposes every code in the 14xx platform range", () => {
    expect(Object.values(CliErrorCode)).toEqual(["IGX-1401", "IGX-1402", "IGX-1403"]);
  });
});

describe("resolveTemplatesRoot", () => {
  it("names the published layout first and the checkout second", () => {
    expect(TEMPLATE_ROOT_CANDIDATES).toEqual(["../templates", "../../../templates"]);
  });

  it("prefers <package>/templates, the layout a published tarball has", async () => {
    const binDirectory = join(workspace, "dist");
    await mkdir(binDirectory, { recursive: true });
    await mkdir(join(workspace, "templates"), { recursive: true });

    await expect(resolveTemplatesRoot(binDirectory)).resolves.toBe(join(workspace, "templates"));
  });

  it("falls back to the repository's templates directory in a checkout", async () => {
    // The checkout shape: <repo>/packages/cli/dist/bin.js beside <repo>/templates.
    const binDirectory = join(workspace, "packages", "cli", "dist");
    await mkdir(binDirectory, { recursive: true });
    const repoTemplates = join(workspace, "templates");
    await mkdir(repoTemplates, { recursive: true });

    await expect(resolveTemplatesRoot(binDirectory)).resolves.toBe(repoTemplates);
  });

  it("answers with the published location when neither exists, so the error names it", async () => {
    const binDirectory = join(workspace, "nowhere", "dist");
    await mkdir(binDirectory, { recursive: true });

    await expect(resolveTemplatesRoot(binDirectory)).resolves.toBe(join(workspace, "nowhere", "templates"));
  });

  it("ignores a candidate that exists but is a file", async () => {
    const island = join(workspace, "island");
    const binDirectory = join(island, "dist");
    await mkdir(binDirectory, { recursive: true });
    await writeFile(join(island, "templates"), "not a directory", "utf8");

    // `../templates` is a file, so the walk moves on; `../../../templates` does not exist either,
    // and the answer falls back to the first candidate so the error names the published location.
    await expect(resolveTemplatesRoot(binDirectory)).resolves.toBe(resolve(island, "templates"));
  });
});

// The real thing: the repository's own `templates/2d-topdown`, copied the way `create-ignifx`
// copies it. Nothing is installed — a scratch project would try to fetch unpublished `@ignifx/*`
// packages — so what is asserted is the shape of the tree and of the generated manifest.
describe("scaffolding the 2d-topdown template", () => {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

  it("copies the whole template, applies the rename convention, and pins the @ignifx scope", async () => {
    const io = recordingIo(join(repoRoot, "templates"));
    const target = join(workspace, "my-game");

    const result = await runCreate([target, "--template", "2d-topdown"], io);

    // The convention: `_gitignore` arrives as `.gitignore`, and nothing keeps the underscore.
    expect(result.files).toContain(".gitignore");
    expect(result.files.some((file) => file.startsWith("_"))).toBe(false);
    // The parts a game needs: an entry point, the plugin config, the project settings, the assets
    // the loaders read, and the unhashed sheet images.
    expect(result.files).toEqual(
      expect.arrayContaining([
        ".gitignore",
        "ATTRIBUTION.md",
        "README.md",
        "assets/level.tilemap.json",
        "assets/tiles.atlas.json",
        "ignifx.config.ts",
        "index.html",
        "package.json",
        "public/tiles.png",
        "src/main.ts",
        "tsconfig.json",
        "vite.config.ts",
      ]),
    );
    // Build output never reaches a generated project.
    expect(result.files.some((file) => file.startsWith("dist/") || file.includes("node_modules"))).toBe(false);

    const manifest: unknown = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    const dependencies = (manifest as { readonly dependencies: Readonly<Record<string, string>> }).dependencies;
    for (const name of Object.keys(dependencies)) {
      expect(name.startsWith("@ignifx/")).toBe(true);
      expect(dependencies[name]).toBe(DEFAULT_DEPENDENCY_RANGE);
    }
    expect(JSON.stringify(manifest)).not.toContain("workspace:");

    // The template's tsconfig has to stand on its own: there is no parent config to extend.
    const tsconfig = await readFile(join(target, "tsconfig.json"), "utf8");
    expect(tsconfig).not.toContain("extends");
  });

  it("scaffolds the side-scroller too", async () => {
    const io = recordingIo(join(repoRoot, "templates"));
    const target = join(workspace, "runner");

    const result = await runCreate([target, "--template", "2d-sidescroller"], io);

    expect(result.files).toEqual(expect.arrayContaining(["public/parallax.png", "assets/coin.spriteanim.json"]));
    const manifest = await readFile(join(target, "package.json"), "utf8");
    expect(manifest).not.toContain("workspace:");
  });
});
