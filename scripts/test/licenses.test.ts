import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  copyrightLineOf,
  indexLicenseOutput,
  isWorkspaceSpecifier,
  noticeEntryFor,
  NOTICES_TITLE,
  readWorkspaceManifest,
  renderNotices,
  repositoryUrlOf,
} from "../lib/licenses.ts";
import type { NoticeEntry } from "../lib/licenses.ts";

/**
 * The third-party notices generator (`CONSTITUTION.md` §11.2).
 *
 * The generator's two halves are tested separately, because only one of them can be: the rendering
 * is pure and is asserted against literals, while the collecting half is exercised against a
 * **fixture** node_modules tree written in `beforeAll` — a real install would make the assertions
 * depend on whatever version of Babylon Lite happens to be on disk.
 */

let root = "";

/**
 * Writes one file inside the fixture tree, creating its directories.
 *
 * @param relativePath - Path relative to the fixture root.
 * @param contents - File contents.
 */
function write(relativePath: string, contents: string): void {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "ignifx-licenses-fixture-"));
  write(
    "packages/left-pad/package.json",
    JSON.stringify({
      name: "left-pad",
      version: "1.3.0",
      license: "WTFPL",
      repository: { type: "git", url: "git+https://github.com/stevemao/left-pad.git" },
    }),
  );
  write("packages/left-pad/LICENSE", "The MIT License\n\nCopyright (c) 2018 azer\n\nPermission is hereby granted…\n");
  write(
    "packages/apache-thing/package.json",
    JSON.stringify({ name: "apache-thing", version: "2.0.0", license: "Apache-2.0", repository: "github:x/y" }),
  );
  // The Apache-2.0 boilerplate, whose definition of "Work" wraps onto a line that begins with the
  // word "copyright" and is not a notice.
  write(
    "packages/apache-thing/LICENSE",
    "Apache License\n\n      the Work, as indicated by a\n      copyright notice that is included in or attached to the work\n",
  );
  write("packages/apache-thing/NOTICE", "apache-thing bundles zlib.\n\nCopyright (c) 1995 Jean-loup Gailly.   \n\n\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("copyrightLineOf", () => {
  it("takes the first real notice and normalises it", () => {
    expect(copyrightLineOf("MIT\n\n  Copyright   (c)  2020   Someone\n")).toBe("Copyright (c) 2020 Someone");
    expect(copyrightLineOf("Copyright 2022 WebGPU Developers\n")).toBe("Copyright 2022 WebGPU Developers");
    expect(copyrightLineOf("Copyright © 2025 Isaac Mason\n")).toBe("Copyright © 2025 Isaac Mason");
    expect(copyrightLineOf("Copyright (c) 2010 Authors. All rights reserved.\n")).toBe("Copyright (c) 2010 Authors.");
  });

  it("does not mistake the Apache-2.0 boilerplate's prose for a notice", () => {
    // The bug this guards: `^copyright` alone matches the wrapped definition of "Work".
    expect(copyrightLineOf("      copyright notice that is included in or attached to the work\n")).toBeNull();
    expect(copyrightLineOf("Copyright [yyyy] [name of copyright owner]\n")).toBeNull();
  });

  it("reports nothing rather than guessing when a licence carries no notice", () => {
    expect(copyrightLineOf("Apache License\nVersion 2.0\n")).toBeNull();
    expect(copyrightLineOf("")).toBeNull();
  });
});

describe("repositoryUrlOf", () => {
  it("normalises every spelling npm allows onto an https URL", () => {
    expect(repositoryUrlOf({ url: "git+https://github.com/a/b.git" })).toBe("https://github.com/a/b");
    expect(repositoryUrlOf("github:a/b")).toBe("https://github.com/a/b");
    expect(repositoryUrlOf("a/b")).toBe("https://github.com/a/b");
    expect(repositoryUrlOf("git://github.com/a/b.git")).toBe("https://github.com/a/b");
    expect(repositoryUrlOf("git@github.com:a/b.git")).toBe("https://github.com/a/b");
    expect(repositoryUrlOf("https://gitlab.com/a/b")).toBe("https://gitlab.com/a/b");
  });

  it("returns null for anything it cannot turn into a URL", () => {
    expect(repositoryUrlOf(undefined)).toBeNull();
    expect(repositoryUrlOf("")).toBeNull();
    expect(repositoryUrlOf({})).toBeNull();
    expect(repositoryUrlOf("not a repository")).toBeNull();
  });
});

describe("readWorkspaceManifest", () => {
  it("keeps what a consumer installs and drops what only this repository installs", () => {
    const manifest = readWorkspaceManifest({
      name: "@ignifx/electron",
      dependencies: { "some-lib": "^1.0.0", "@ignifx/core": "workspace:*" },
      peerDependencies: { electron: "catalog:", "@ignifx/core": "workspace:*" },
      optionalDependencies: { "native-thing": "^2" },
      devDependencies: { vitest: "catalog:" },
    });

    expect(manifest.name).toBe("@ignifx/electron");
    expect(manifest.private).toBe(false);
    expect([...manifest.runtimeDependencies.keys()].toSorted()).toEqual(["electron", "native-thing", "some-lib"]);
  });

  it("reads the private flag, so a template is told apart from a published package", () => {
    expect(readWorkspaceManifest({ name: "t", private: true }).private).toBe(true);
    expect(isWorkspaceSpecifier("workspace:*")).toBe(true);
    expect(isWorkspaceSpecifier("^1.0.0")).toBe(false);
  });
});

describe("indexLicenseOutput", () => {
  it("flattens pnpm's licence-keyed output into one record per package", () => {
    const indexed = indexLicenseOutput({
      MIT: [{ name: "a", versions: ["1.0.0"], paths: ["/x/a"], license: "MIT" }],
      "Apache-2.0": [{ name: "b", versions: ["2.0.0"], paths: ["/x/b"], license: "Apache-2.0" }],
    });

    expect([...indexed.keys()].toSorted()).toEqual(["a", "b"]);
    expect(indexed.get("b")?.license).toBe("Apache-2.0");
    expect(indexed.get("a")?.paths).toEqual(["/x/a"]);
  });

  it("survives output that is not the shape it expects", () => {
    expect(indexLicenseOutput(null).size).toBe(0);
    expect(indexLicenseOutput("nonsense").size).toBe(0);
    expect(indexLicenseOutput({ MIT: "not an array" }).size).toBe(0);
    expect(indexLicenseOutput({ MIT: [null, { noName: true }] }).size).toBe(0);
  });
});

describe("noticeEntryFor", () => {
  it("reads the licence, the copyright, and the repository out of what is installed", () => {
    const entry = noticeEntryFor(
      "left-pad",
      { name: "left-pad", versions: ["1.3.0"], paths: [path.join(root, "packages", "left-pad")], license: "WTFPL" },
      ["@ignifx/core"],
    );

    expect(entry).toEqual({
      name: "left-pad",
      versions: ["1.3.0"],
      license: "WTFPL",
      copyright: "Copyright (c) 2018 azer",
      repository: "https://github.com/stevemao/left-pad",
      requiredBy: ["@ignifx/core"],
      notice: null,
    });
  });

  it("reproduces a NOTICE file, which Apache-2.0 §4(d) requires of a redistribution", () => {
    const entry = noticeEntryFor(
      "apache-thing",
      {
        name: "apache-thing",
        versions: ["2.0.0"],
        paths: [path.join(root, "packages", "apache-thing")],
        license: "Apache-2.0",
      },
      [],
    );

    // No copyright line: the Apache-2.0 text carries none of its own.
    expect(entry.copyright).toBeNull();
    // Trailing blank lines and trailing spaces are stripped, so the file is stable byte for byte.
    expect(entry.notice).toBe("apache-thing bundles zlib.\n\nCopyright (c) 1995 Jean-loup Gailly.");
  });

  it("says what it does not know rather than inventing it", () => {
    const entry = noticeEntryFor("gone", null, []);

    expect(entry).toEqual({
      name: "gone",
      versions: [],
      license: "UNKNOWN",
      copyright: null,
      repository: null,
      requiredBy: [],
      notice: null,
    });
  });
});

describe("renderNotices", () => {
  const entries: readonly NoticeEntry[] = [
    {
      name: "zeta",
      versions: ["2.0.0", "1.0.0"],
      license: "MIT",
      copyright: "Copyright (c) 2020 Zeta",
      repository: "https://github.com/z/zeta",
      requiredBy: ["@ignifx/core"],
      notice: null,
    },
    {
      name: "alpha",
      versions: ["0.1.0"],
      license: "Apache-2.0",
      copyright: null,
      repository: null,
      requiredBy: [],
      notice: "Alpha bundles beta.\nCopyright (c) 1999 Beta.",
    },
  ];

  it("opens with the title and the generated-file marker", () => {
    const rendered = renderNotices(entries);

    expect(rendered.startsWith(`${NOTICES_TITLE}\n`)).toBe(true);
    expect(rendered).toContain("<!-- Generated by `pnpm licenses:notices`. Do not edit by hand. -->");
    expect(rendered).toContain("2 packages.");
    expect(rendered.endsWith("\n")).toBe(true);
    expect(rendered.endsWith("\n\n")).toBe(false);
  });

  it("sorts the packages and the versions, so the file is a diffable artefact", () => {
    const rendered = renderNotices(entries);
    const headings = rendered.split("\n").filter((line) => line.startsWith("## "));

    expect(headings).toEqual(["## alpha", "## zeta"]);
    expect(rendered).toContain("- Version: 1.0.0, 2.0.0");
    // Byte-identical whatever order the collector produced.
    expect(renderNotices([...entries].toReversed())).toBe(rendered);
  });

  it("writes each field only when there is one", () => {
    const rendered = renderNotices(entries);

    expect(rendered).toContain("- License: MIT");
    expect(rendered).toContain("- Copyright (c) 2020 Zeta");
    expect(rendered).toContain("- Repository: <https://github.com/z/zeta>");
    expect(rendered).toContain("- Required by: @ignifx/core");
    // `alpha` has none of the three, and no empty bullet is emitted for them.
    const alpha = rendered.slice(rendered.indexOf("## alpha"), rendered.indexOf("## zeta"));
    expect(alpha).not.toContain("- Repository:");
    expect(alpha).not.toContain("- Required by:");
  });

  it("fences a NOTICE so nothing inside it can close the block early", () => {
    const rendered = renderNotices(entries);

    expect(rendered).toContain("```text\nAlpha bundles beta.\nCopyright (c) 1999 Beta.\n```");

    const backticked = renderNotices([{ ...entries[1]!, notice: "a ``` b" }]);
    expect(backticked).toContain("````text\na ``` b\n````");
  });

  it("says none rather than one when there is nothing to record", () => {
    expect(renderNotices([])).toContain("0 packages.");
    expect(renderNotices([entries[0]!])).toContain("1 package.");
  });
});
