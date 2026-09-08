// The sample-model pipeline: download a glTF, compress it, and write it into
// `website/examples/assets/models/` small enough to commit. Run it from the website package:
//
//   pnpm --filter @ignifx/website exec node examples/_tools/compress-model.ts \
//     --url https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Corset/glTF-Binary/Corset.glb \
//     --out assets/models/corset.glb --textures 1024 --linear-textures 512 --quality 84
//
// …and, for a model that arrives with a million triangles and meshopt compression:
//
//   pnpm --filter @ignifx/website exec node examples/_tools/compress-model.ts \
//     --in brand/source/spaceship.glb --out assets/models/ignifx-ship.glb \
//     --simplify 0.05 --simplify-error 0.002 --textures 1024 --linear-textures 1024 --quality 84
//
// `assets/README.md` records the exact invocation used for every committed file, and
// `assets/ATTRIBUTION.md` records the digest this script prints. Nothing here runs at build time:
// the compressed binary is committed, so a site build never depends on a third party being up
// (`website/plan/04-examples-platform.md` §5.1 rule 4).
//
// ## meshopt and quantisation are read, never written
//
// A source model may well arrive meshopt-compressed and quantised — the owner's ship does — so the
// reader registers `MeshoptDecoder` as the `meshopt.decoder` dependency and decodes at **build
// time**. What it will not do is *emit* either one. Babylon Lite 1.27.0's glTF loader does declare
// `EXT_meshopt_compression`, but its decoder is normally fetched from a CDN and `CONSTITUTION.md`
// §9.1 forbids a third-party request at runtime; `KHR_mesh_quantization` changes the accessor
// component types under the loader's feet and nothing in this repository exercises it. So every
// output is `dequantize()`d, both extensions are dropped, and the file is a plain GLB.
//
// ## What is deliberately *not* used
//
// No Draco and no WebP textures: Lite's loader declares `KHR_texture_basisu`,
// `KHR_texture_transform`, `EXT_meshopt_compression` and the `KHR_materials_*` set, and declares
// neither `KHR_draco_mesh_compression` nor `EXT_texture_webp` (checked against
// `packages/core/node_modules/@babylonjs/lite/index.d.ts`). Simplified geometry and resized,
// re-encoded PNG and JPEG textures are what carries the size here, and they are what every WebGPU
// browser decodes natively.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, dequantize, prune, resample, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import type { Document, Transform } from "@gltf-transform/core";

/** The `website/examples` directory, one level above this file. */
const EXAMPLES_ROOT = resolve(import.meta.dirname, "..");

/** How many bytes one committed asset may occupy (`04-examples-platform.md` §5.1 rule 4). */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** The colour-texture edge length used when `--textures` is not given. */
const DEFAULT_TEXTURE_SIZE = 1024;

/**
 * The edge length used for the linear maps when `--linear-textures` is not given.
 *
 * @remarks
 * Half the colour size, because the linear maps stay lossless PNG and a noisy normal map is the
 * one image PNG cannot compress: the Corset's 1024px normal map is 1448 KiB on its own, more than
 * the whole rest of the file. At 512px the same map is under 400 KiB, and the difference is not
 * visible on an object that fills half of a 1280x720 frame.
 */
const DEFAULT_LINEAR_TEXTURE_SIZE = 512;

/** The JPEG quality used when `--quality` is not given. */
const DEFAULT_JPEG_QUALITY = 84;

/**
 * The simplification error budget used when `--simplify-error` is not given, as a fraction of the
 * mesh's radius. `simplify()`'s own default is 0.0001, which stops long before a heavy model has
 * lost enough triangles to commit; 0.002 is two millimetres on a metre-long hull.
 */
const DEFAULT_SIMPLIFY_ERROR = 0.002;

/**
 * How long a download is given, in milliseconds. A sample model is tens of megabytes and the
 * pipeline should fail rather than hang when the network is not there.
 */
const DOWNLOAD_TIMEOUT_MS = 300_000;

/** What the command line asked for. */
interface Options {
  /** Where the source glTF comes from: an `https:` URL, or a path on disk. */
  readonly source: string;
  /** Where the compressed `.glb` is written, relative to `website/examples`. */
  readonly out: string;
  /** The maximum edge length of the base-colour and emissive textures, in pixels. */
  readonly textureSize: number;
  /** The maximum edge length of the normal and packed occlusion/roughness maps, in pixels. */
  readonly linearTextureSize: number;
  /** The JPEG quality applied to the colour slots, 1 to 100. */
  readonly quality: number;
  /** The fraction of vertices `simplify()` aims to keep, or `1` to skip simplification. */
  readonly simplifyRatio: number;
  /** The error `simplify()` may not exceed, as a fraction of the mesh's radius. */
  readonly simplifyError: number;
}

/**
 * Reads one `--name value` pair out of the argument list.
 *
 * @param argv - The arguments, without the executable and the script.
 * @param name - The flag name, without the leading dashes.
 * @returns The value, or `null` when the flag is absent.
 */
function flag(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) {
    return null;
  }
  return argv[index + 1] ?? null;
}

/**
 * Parses the command line.
 *
 * @param argv - The arguments, without the executable and the script.
 * @returns The options.
 * @throws An `Error` when `--url`/`--in` or `--out` is missing, or a number is not a number.
 */
function parseOptions(argv: readonly string[]): Options {
  const source = flag(argv, "url") ?? flag(argv, "in");
  const out = flag(argv, "out");
  if (source === null || out === null) {
    throw new Error(
      "usage: compress-model.ts --url <https url> | --in <path> --out <path under website/examples> " +
        "[--textures 1024] [--linear-textures 512] [--quality 84] [--simplify 1] [--simplify-error 0.002]",
    );
  }
  const textureSize = Number(flag(argv, "textures") ?? DEFAULT_TEXTURE_SIZE);
  const linearTextureSize = Number(flag(argv, "linear-textures") ?? DEFAULT_LINEAR_TEXTURE_SIZE);
  const quality = Number(flag(argv, "quality") ?? DEFAULT_JPEG_QUALITY);
  for (const [name, size] of [
    ["--textures", textureSize],
    ["--linear-textures", linearTextureSize],
  ] as const) {
    if (!Number.isInteger(size) || size < 16) {
      throw new Error(`${name} must be a whole number of pixels of 16 or more; got ${String(size)}.`);
    }
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error(`--quality must be a whole number between 1 and 100; got ${String(quality)}.`);
  }
  const simplifyRatio = Number(flag(argv, "simplify") ?? 1);
  const simplifyError = Number(flag(argv, "simplify-error") ?? DEFAULT_SIMPLIFY_ERROR);
  if (!(simplifyRatio > 0) || simplifyRatio > 1) {
    throw new Error(`--simplify must be a ratio in (0, 1]; got ${String(simplifyRatio)}.`);
  }
  if (!(simplifyError >= 0) || simplifyError > 1) {
    throw new Error(`--simplify-error must be a fraction in [0, 1]; got ${String(simplifyError)}.`);
  }
  return { source, out, textureSize, linearTextureSize, quality, simplifyRatio, simplifyError };
}

/**
 * Fetches the source glTF.
 *
 * @param source - An `https:` URL, or a path on disk.
 * @returns The file's bytes.
 * @throws An `Error` when the download fails or times out.
 */
async function readSource(source: string): Promise<Uint8Array> {
  if (!source.startsWith("http:") && !source.startsWith("https:")) {
    return new Uint8Array(await readFile(resolve(process.cwd(), source)));
  }
  const response = await fetch(source, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${source} answered ${String(response.status)} ${response.statusText}.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The axis-aligned bounds of every position accessor in a document, in the file's own units. */
interface Bounds {
  /** The smallest corner. */
  readonly min: readonly [number, number, number];
  /** The largest corner. */
  readonly max: readonly [number, number, number];
}

/**
 * Measures a document's geometry, so an example can scale a centimetre-sized sample to a
 * game-sized entity with a constant that has a provenance.
 *
 * @remarks
 * Node transforms are ignored: every model this pipeline has processed carries one identity node,
 * and reporting the raw accessor extent keeps the number checkable against the glTF itself.
 *
 * @param document - The parsed document.
 * @returns The bounds, or `null` when the document has no positions.
 */
function measure(document: Document): Bounds | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION");
      if (positions === null) {
        continue;
      }
      found = true;
      const low = positions.getMin([0, 0, 0]);
      const high = positions.getMax([0, 0, 0]);
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis] ?? Infinity, low[axis] ?? 0);
        max[axis] = Math.max(max[axis] ?? -Infinity, high[axis] ?? 0);
      }
    }
  }
  return found ? { min, max } : null;
}

/**
 * Whether every material in the document is fully opaque, which is what makes JPEG safe for the
 * colour slots: JPEG has no alpha channel, so a masked or blended material would lose its cut-out.
 *
 * @param document - The parsed document.
 * @returns `true` when no material declares `MASK` or `BLEND`.
 */
function isFullyOpaque(document: Document): boolean {
  for (const material of document.getRoot().listMaterials()) {
    if (material.getAlphaMode() !== "OPAQUE") {
      return false;
    }
  }
  return true;
}

/** A mesh's size, for the before-and-after line. */
interface MeshCounts {
  /** How many triangles every primitive holds between them. */
  readonly triangles: number;
  /** How many vertices every primitive holds between them. */
  readonly vertices: number;
}

/**
 * Counts a document's geometry.
 *
 * @remarks
 * Indices are counted where a primitive has them and positions where it does not, which is what
 * makes the number comparable before and after `weld()` — welding replaces a de-indexed primitive
 * with an indexed one and would otherwise look like it had tripled the triangle count.
 *
 * @param document - The parsed document.
 * @returns The triangle and vertex totals.
 */
function count(document: Document): MeshCounts {
  let triangles = 0;
  let vertices = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION");
      const indices = primitive.getIndices();
      vertices += positions?.getCount() ?? 0;
      triangles += Math.floor((indices?.getCount() ?? positions?.getCount() ?? 0) / 3);
    }
  }
  return { triangles, vertices };
}

/**
 * Sums the byte length of every embedded image.
 *
 * @param document - The parsed document.
 * @returns The total, in bytes.
 */
function textureBytes(document: Document): number {
  let total = 0;
  for (const texture of document.getRoot().listTextures()) {
    total += texture.getImage()?.byteLength ?? 0;
  }
  return total;
}

const options = parseOptions(process.argv.slice(2));
// `MeshoptDecoder` is what lets a meshopt-compressed input be read at all; registering it here and
// nowhere in the engine is the whole point — see the header.
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const sourceBytes = await readSource(options.source);
const document = await io.readBinary(sourceBytes);

const bounds = measure(document);
const opaque = isFullyOpaque(document);
const before = count(document);
const sourceExtensions = document
  .getRoot()
  .listExtensionsUsed()
  .map((extension) => extension.extensionName)
  .toSorted();

/**
 * The simplification pass, or a no-op when `--simplify` was not given.
 *
 * @remarks
 * `weld()` runs before it either way, because `simplify()` needs an indexed, welded mesh to have
 * anything to collapse — a de-indexed primitive has no shared vertices at all.
 *
 * @returns The transform to run.
 */
function simplification(): Transform {
  if (options.simplifyRatio >= 1) {
    return (): void => {
      // Nothing to do: `--simplify` was not given, so the geometry is kept as it arrived.
    };
  }
  return simplify({
    simplifier: MeshoptSimplifier,
    ratio: options.simplifyRatio,
    error: options.simplifyError,
  });
}

await MeshoptSimplifier.ready;
await document.transform(
  // Two files, one buffer view, one image: a sample model often carries the same texture twice.
  dedup(),
  // Drops anything nothing references — cameras, unused materials, empty nodes.
  prune(),
  // Joins vertices that share a position and every attribute, which is what makes the index buffer
  // worth having. `toleranceNormal: 0` keeps hard edges hard.
  weld(),
  // Resamples animation tracks onto the fewest keyframes that reproduce them. A static model has
  // none; it costs nothing and it is what makes this pipeline reusable for the animated samples.
  resample(),
  // Collapses edges until the vertex count reaches `--simplify`, or until the error would exceed
  // `--simplify-error` — whichever comes first, which is why the printed ratio is the one to read
  // rather than the one asked for.
  simplification(),
  // Every accessor back to float32, so the output needs no `KHR_mesh_quantization`. It costs bytes
  // and buys the one thing that matters here: a file this repository has actually loaded.
  dequantize(),
  // The normal and the packed occlusion/roughness/metalness maps stay lossless: JPEG's chroma
  // subsampling shows up as blotches in a normal map's blue channel and as banding in roughness.
  textureCompress({
    encoder: sharp,
    targetFormat: "png",
    resize: [options.linearTextureSize, options.linearTextureSize],
    slots: /^(normalTexture|metallicRoughnessTexture|occlusionTexture)$/u,
  }),
  // The colour slots carry almost all of the bytes and almost none of the precision, so they go to
  // JPEG — but only when nothing in the file needs an alpha channel.
  textureCompress({
    encoder: sharp,
    targetFormat: opaque ? "jpeg" : "png",
    resize: [options.textureSize, options.textureSize],
    quality: options.quality,
    slots: /^(baseColorTexture|emissiveTexture)$/u,
  }),
);

// Both extensions are read and neither is written; dropping them after `dequantize()` is what makes
// the output a plain GLB rather than one that merely happens not to need them.
for (const extension of document.getRoot().listExtensionsUsed()) {
  if (extension.extensionName === "EXT_meshopt_compression" || extension.extensionName === "KHR_mesh_quantization") {
    extension.dispose();
  }
}

const after = count(document);
const outPath = resolve(EXAMPLES_ROOT, options.out);
await mkdir(dirname(outPath), { recursive: true });
const compressed = await io.writeBinary(document);
await writeFile(outPath, compressed);

const digest = createHash("sha256").update(compressed).digest("hex");
const lines = [
  basename(outPath),
  `  source        ${options.source}`,
  `  before        ${String(sourceBytes.byteLength)} bytes`,
  `  after         ${String(compressed.byteLength)} bytes ` +
    `(${(compressed.byteLength / sourceBytes.byteLength).toFixed(3)}x)`,
  `  triangles     ${String(before.triangles)} -> ${String(after.triangles)} ` +
    `(${((after.triangles / Math.max(1, before.triangles)) * 100).toFixed(1)}%)`,
  `  vertices      ${String(before.vertices)} -> ${String(after.vertices)}`,
  `  extensions    in [${sourceExtensions.join(", ") || "none"}] ` +
    `out [${
      document
        .getRoot()
        .listExtensionsUsed()
        .map((e) => e.extensionName)
        .toSorted()
        .join(", ") || "none"
    }]`,
  `  textures      ${String(document.getRoot().listTextures().length)} images, ` +
    `${String(textureBytes(document))} bytes; ` +
    `colour ${String(options.textureSize)}px ${opaque ? "jpeg" : "png"} q${String(options.quality)}, ` +
    `linear ${String(options.linearTextureSize)}px png`,
  `  sha256        ${digest}`,
];
if (bounds !== null) {
  const size = [0, 1, 2].map((axis) => (bounds.max[axis] ?? 0) - (bounds.min[axis] ?? 0));
  lines.push(
    `  bounds        min [${bounds.min.map((v) => v.toFixed(6)).join(", ")}] ` +
      `max [${bounds.max.map((v) => v.toFixed(6)).join(", ")}]`,
    `  size          ${size.map((v) => v.toFixed(6)).join(" x ")} (glTF units)`,
  );
}
process.stdout.write(`${lines.join("\n")}\n`);

if (compressed.byteLength > MAX_FILE_BYTES) {
  process.stdout.write(
    `${basename(outPath)} is ${String(compressed.byteLength)} bytes, over the ` +
      `${String(MAX_FILE_BYTES)}-byte cap. Lower --textures or --quality.\n`,
  );
  process.exitCode = 1;
}
