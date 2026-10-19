#!/usr/bin/env node
/**
 * `pnpm vendor:decoders` — refreshes `packages/core/decoders/`, the decoders Babylon Lite loads at
 * run time, so a game serves them from its own origin instead of `cdn.babylonjs.com`.
 *
 * Lite 1.34 injects the KTX2 decoder (`babylon.ktx2Decoder.js`), which then fetches its Basis and
 * UASTC transcoders and a Zstandard decoder, and the meshopt decoder (`meshopt_decoder.js`), from
 * the Babylon CDN unless told otherwise (`lib/texture/ktx2-loader.js`,
 * `lib/loader-gltf/meshopt-decode.js`). A packaged game's `script-src 'self'` blocks the CDN. The
 * files therefore ship inside `@ignifx/core`, which lists them in `ignifx.assets.public`, and
 * `@ignifx/vite-plugin` copies them into the build like any extension's public files.
 *
 * They are committed rather than installed because the npm packages that carry them would make
 * every game install the whole of Babylon.js: `babylonjs-ktx2decoder` depends on `babylonjs`
 * (113 MB) and `@babylonjs/ktx2decoder` declares `@babylonjs/core` (72 MB) as a required peer.
 * This script is the only way the files change: it downloads the pinned tarballs with `npm pack`,
 * copies the files out (dropping a script's trailing `sourceMappingURL` comment, since the maps are
 * not vendored), and rewrites `vendored.json` with their SHA-256 digests, which
 * `scripts/test/vendored.test.ts` checks and `pnpm licenses:notices` reads. It needs the network,
 * so it is not part of `pnpm check`.
 *
 * Options:
 * - `--root <dir>` — write into a tree other than the repository.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArguments } from "./lib/args.ts";
import { writeGeneratedFile } from "./lib/fs-tree.ts";
import { log, logError } from "./lib/log.ts";
import { sha256Of, VENDORED_MANIFEST } from "./lib/vendored.ts";
import { isRecord, repositoryRoot } from "./lib/workspace.ts";
import type { VendoredComponent, VendoredManifest } from "./lib/vendored.ts";

/** Where the files go, from the repository root. */
const TARGET = "packages/core/decoders";

/** One upstream package and the files taken from it. */
interface Source {
  /** The npm name. */
  readonly name: string;
  /** The exact version. Keep the two Babylon packages on one version. */
  readonly version: string;
  /** The upstream repository. */
  readonly repository: string;
  /** The copyright line for the notices file. */
  readonly copyright: string;
  /** The licence file inside the package. */
  readonly licenseFrom: string;
  /** The `NOTICE` file inside the package, or `null`. */
  readonly noticeFrom: string | null;
  /** `[served name, path inside the package]` pairs. */
  readonly files: readonly (readonly [string, string])[];
}

/**
 * The pinned sources. 9.30.0 is the decoder Lite 1.34.0 was verified against (editor spike S0.6
 * §4.4 loaded ETC1S and UASTC files through `cdn.babylonjs.com/v9.30.0/`).
 */
const SOURCES: readonly Source[] = [
  {
    // The UMD build that defines the `KTX2DECODER` global Lite's loader reads; self-contained (it
    // never touches its `babylonjs` dependency at run time).
    name: "babylonjs-ktx2decoder",
    version: "9.30.0",
    repository: "https://github.com/BabylonJS/Babylon.js",
    copyright: "Copyright 2024 The Babylon.js team",
    licenseFrom: "license.md",
    noticeFrom: null,
    files: [["babylon.ktx2Decoder.js", "babylon.ktx2Decoder.js"]],
  },
  {
    // The transcoders the decoder fetches. The same files `cdn.babylonjs.com/ktx2Transcoders/1/`
    // serves; the package copies them from Babylon's own server tree.
    name: "@babylonjs/ktx2decoder",
    version: "9.30.0",
    repository: "https://github.com/BabylonJS/Babylon.js",
    copyright: "Copyright 2024 The Babylon.js team",
    licenseFrom: "wasm/license.md",
    noticeFrom: "NOTICE.md",
    files: [
      ["msc_basis_transcoder.js", "wasm/msc_basis_transcoder.js"],
      ["msc_basis_transcoder.wasm", "wasm/msc_basis_transcoder.wasm"],
      ["uastc_astc.wasm", "wasm/uastc_astc.wasm"],
      ["uastc_bc7.wasm", "wasm/uastc_bc7.wasm"],
      ["uastc_r8_unorm.wasm", "wasm/uastc_r8_unorm.wasm"],
      ["uastc_rg8_unorm.wasm", "wasm/uastc_rg8_unorm.wasm"],
      ["uastc_rgba8_srgb_v2.wasm", "wasm/uastc_rgba8_srgb_v2.wasm"],
      ["uastc_rgba8_unorm_v2.wasm", "wasm/uastc_rgba8_unorm_v2.wasm"],
      ["zstddec.wasm", "wasm/zstddec.wasm"],
    ],
  },
  {
    // The classic-script build: it declares the `MeshoptDecoder` global Lite's loader reads.
    name: "meshoptimizer",
    version: "1.3.0",
    repository: "https://github.com/zeux/meshoptimizer",
    copyright: "Copyright (c) 2016-2026 Arseny Kapoulkine",
    licenseFrom: "LICENSE.md",
    noticeFrom: null,
    files: [["meshopt_decoder.js", "meshopt_decoder.cjs"]],
  },
];

/**
 * A file-system-safe stem for a package name: `@babylonjs/ktx2decoder` → `babylonjs-ktx2decoder`.
 * The two Babylon packages would collide, so a scope keeps a marker.
 *
 * @param name - The npm name.
 * @returns The stem.
 */
function stemOf(name: string): string {
  return name.startsWith("@") ? `scoped-${name.slice(1).replace("/", "-")}` : name;
}

/**
 * Downloads and unpacks one tarball.
 *
 * @param source - The package to fetch.
 * @param workDirectory - A scratch directory.
 * @returns The unpacked `package/` directory and the tarball's integrity.
 */
function unpack(source: Source, workDirectory: string): { readonly directory: string; readonly integrity: string } {
  const destination = path.join(workDirectory, stemOf(source.name));
  mkdirSync(destination, { recursive: true });
  const output = execFileSync(
    "npm",
    ["pack", `${source.name}@${source.version}`, "--json", "--pack-destination", destination],
    { encoding: "utf8" },
  );
  const parsed: unknown = JSON.parse(output);
  const record: unknown = Array.isArray(parsed) ? parsed[0] : null;
  if (!isRecord(record) || typeof record["filename"] !== "string" || typeof record["integrity"] !== "string") {
    throw new Error(`npm pack ${source.name}@${source.version} printed no filename and integrity`);
  }
  execFileSync("tar", ["-xzf", path.join(destination, record["filename"]), "-C", destination]);
  return { directory: path.join(destination, "package"), integrity: record["integrity"] };
}

/**
 * Reads the `license` field of an unpacked package.
 *
 * @param directory - The unpacked `package/` directory.
 * @returns The SPDX expression.
 */
function licenseOf(directory: string): string {
  const manifest: unknown = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  if (!isRecord(manifest) || typeof manifest["license"] !== "string") {
    throw new Error(`${directory}/package.json has no license field`);
  }
  return manifest["license"];
}

/**
 * Removes a trailing `//# sourceMappingURL=` line. The maps are not vendored, so the comment would
 * only make a dev server and the browser's developer tools ask for a file that is not there.
 *
 * @param file - The absolute path of a copied script.
 */
function dropSourceMapComment(file: string): void {
  const text = readFileSync(file, "utf8");
  const stripped = text.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/u, "\n");
  if (stripped !== text) {
    writeFileSync(file, stripped, "utf8");
  }
}

/**
 * Copies one package's files and describes them.
 *
 * @param source - The package.
 * @param workDirectory - A scratch directory.
 * @param target - The absolute vendored directory.
 * @returns The component record.
 */
function vendor(source: Source, workDirectory: string, target: string): VendoredComponent {
  const { directory, integrity } = unpack(source, workDirectory);
  const stem = stemOf(source.name);
  const licenseFile = `${stem}.LICENSE.md`;
  copyFileSync(path.join(directory, source.licenseFrom), path.join(target, licenseFile));
  let noticeFile: string | null = null;
  if (source.noticeFrom !== null) {
    noticeFile = `${stem}.NOTICE.md`;
    copyFileSync(path.join(directory, source.noticeFrom), path.join(target, noticeFile));
  }
  const files = source.files.map(([file, from]) => {
    copyFileSync(path.join(directory, from), path.join(target, file));
    if (file.endsWith(".js")) {
      dropSourceMapComment(path.join(target, file));
    }
    return { file, from, sha256: sha256Of(readFileSync(path.join(target, file))) };
  });
  return {
    name: source.name,
    version: source.version,
    integrity,
    license: licenseOf(directory),
    repository: source.repository,
    copyright: source.copyright,
    licenseFile,
    noticeFile,
    files,
  };
}

/**
 * Runs the refresh.
 *
 * @returns The process exit code.
 */
function main(): number {
  const parsed = parseArguments(process.argv.slice(2), ["root"]);
  const root = path.resolve(parsed.options.get("root") ?? repositoryRoot(import.meta.url));
  const target = path.join(root, TARGET);
  const workDirectory = mkdtempSync(path.join(tmpdir(), "ignifx-decoders-"));
  try {
    mkdirSync(target, { recursive: true });
    const manifest: VendoredManifest = {
      components: SOURCES.map((source) => vendor(source, workDirectory, target)),
    };
    writeGeneratedFile(path.join(target, VENDORED_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    const count = manifest.components.reduce((total, component) => total + component.files.length, 0);
    log(`vendor:decoders — ${String(count)} files from ${String(SOURCES.length)} packages into ${TARGET}`);
    return 0;
  } catch (error) {
    logError(`vendor:decoders — ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

process.exitCode = main();
