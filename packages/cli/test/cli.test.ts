import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CliError,
  CliErrorCode,
  DEFAULT_TEMPLATE,
  parseArgs,
  resolveTemplateDir,
  runCreate,
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
    await expect(readFile(join(targetDir, "package.json"), "utf8")).resolves.toBe('{ "name": "game" }\n');
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
