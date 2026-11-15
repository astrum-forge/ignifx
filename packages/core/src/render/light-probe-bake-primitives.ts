import { assertNever } from "../errors/ignifx-error.js";
import type { MeshPrimitiveDefinition } from "./mesh-asset.js";

/**
 * The CPU triangles of the engine's mesh primitives, for the light-probe bake
 * (`docs/architecture/07-rendering.md` §2.15).
 *
 * Lite builds a primitive's arrays inside its factory and keeps them on the GPU side, and a headless
 * app builds none at all, so the bake rebuilds the shape here from the same options and the same
 * defaults Babylon Lite 1.34.0 applies (`lib/mesh/create-{box,sphere,plane,ground,cylinder,capsule,torus}.js`):
 * the same size, centre and orientation. Curved shapes are tessellated more coarsely than Lite draws
 * them (at most {@link MAX_BAKE_SEGMENTS} segments), which a one-bounce diffuse bake cannot tell apart
 * and which keeps the brute-force trace cheap.
 */

/** Positions (three floats per vertex) and triangle indices, in the primitive's local space. */
export interface BakeTriangles {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/** The most segments around (or rings along) a curved primitive the bake builds. */
export const MAX_BAKE_SEGMENTS = 16;

/**
 * Builds the triangles of a primitive as Lite would size and place it.
 *
 * @param definition - The primitive and its options, as `MeshAsset`'s factories and `.mesh.json` take them.
 * @returns Its local-space triangles.
 *
 * @internal
 */
export function primitiveTriangles(definition: MeshPrimitiveDefinition): BakeTriangles {
  switch (definition.primitive) {
    case "box": {
      const size = definition.options.size ?? 1;
      return boxTriangles(
        definition.options.width ?? size,
        definition.options.height ?? size,
        definition.options.depth ?? size,
      );
    }
    case "sphere": {
      const radius = (definition.options.diameter ?? 1) / 2;
      const rings = clampSegments(Math.max(3, definition.options.segments ?? 32));
      const profile: [number, number][] = [];
      for (let ring = 0; ring <= rings; ring += 1) {
        const angle = Math.PI * (1 - ring / rings);
        profile.push([Math.sin(angle) * radius, Math.cos(angle) * radius]);
      }
      return revolve(profile, rings * 2);
    }
    case "plane": {
      const size = definition.options.size ?? 1;
      const hw = (definition.options.width ?? size) / 2;
      const hh = (definition.options.height ?? size) / 2;
      return quad([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0]);
    }
    case "ground": {
      // Flat whatever its subdivisions: two triangles cover it.
      const hw = (definition.options.width ?? 1) / 2;
      const hd = (definition.options.height ?? 1) / 2;
      return quad([-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd]);
    }
    case "cylinder": {
      const options = definition.options;
      const height = options.height ?? 2;
      const top = (options.diameterTop ?? options.diameter ?? 1) / 2;
      const bottom = (options.diameterBottom ?? options.diameter ?? 1) / 2;
      const profile: [number, number][] = [
        [0, -height / 2],
        [bottom, -height / 2],
        [top, height / 2],
        [0, height / 2],
      ];
      return revolve(profile, clampSegments(Math.max(3, options.tessellation ?? 24)));
    }
    case "capsule": {
      const options = definition.options;
      // Lite reads these with `||`, so a 0 takes the default as well.
      const height = Math.max(options.height || 1, 0);
      const radius = Math.max(options.radius || 0.25, 0);
      const half = Math.max(height / 2 - radius, 0);
      const arc = MAX_BAKE_SEGMENTS / 2;
      const profile: [number, number][] = [];
      for (let step = 0; step <= arc; step += 1) {
        const angle = (Math.PI / 2) * (step / arc);
        profile.push([Math.sin(angle) * radius, -half - Math.cos(angle) * radius]);
      }
      for (let step = 0; step <= arc; step += 1) {
        const angle = (Math.PI / 2) * (step / arc);
        profile.push([Math.cos(angle) * radius, half + Math.sin(angle) * radius]);
      }
      return revolve(profile, clampSegments(Math.max(3, options.tessellation || 16)));
    }
    case "torus": {
      const options = definition.options;
      return torusTriangles(
        (options.diameter ?? 1) / 2,
        (options.thickness ?? 0.5) / 2,
        clampSegments(Math.max(3, options.tessellation ?? 16)),
      );
    }
    default:
      return assertNever(definition, "mesh primitive");
  }
}

/**
 * Caps a segment count at {@link MAX_BAKE_SEGMENTS}.
 *
 * @param segments - What the options asked for.
 * @returns A whole count from 3 to the cap.
 */
function clampSegments(segments: number): number {
  return Math.min(MAX_BAKE_SEGMENTS, Math.max(3, Math.floor(segments)));
}

/**
 * An axis-aligned box centred on the origin.
 *
 * @param width - Its size along X.
 * @param height - Its size along Y.
 * @param depth - Its size along Z.
 * @returns Twelve triangles.
 */
function boxTriangles(width: number, height: number, depth: number): BakeTriangles {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const positions = Float32Array.from([
    -x,
    -y,
    -z,
    x,
    -y,
    -z,
    x,
    y,
    -z,
    -x,
    y,
    -z,
    -x,
    -y,
    z,
    x,
    -y,
    z,
    x,
    y,
    z,
    -x,
    y,
    z,
  ]);
  const indices = Uint32Array.from([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
  ]);
  return { positions, indices };
}

/**
 * Two triangles over four corners given in order around the quad.
 *
 * @param corners - Twelve floats.
 * @returns The quad.
 */
function quad(corners: readonly number[]): BakeTriangles {
  return { positions: Float32Array.from(corners), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
}

/**
 * Revolves a `(radius, y)` profile around the Y axis.
 *
 * @param profile - The profile, bottom to top.
 * @param slices - Segments around the axis.
 * @returns The surface; a zero radius makes degenerate triangles, which the trace skips.
 */
function revolve(profile: readonly (readonly [number, number])[], slices: number): BakeTriangles {
  const positions: number[] = [];
  for (const [radius, y] of profile) {
    for (let slice = 0; slice <= slices; slice += 1) {
      const angle = (2 * Math.PI * slice) / slices;
      positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }
  }
  return { positions: Float32Array.from(positions), indices: gridIndices(profile.length - 1, slices) };
}

/**
 * A torus in the XZ plane.
 *
 * @param ring - The distance from the centre to the tube's centre.
 * @param tube - The tube's radius.
 * @param segments - Segments around the ring and around the tube.
 * @returns The surface.
 */
function torusTriangles(ring: number, tube: number, segments: number): BakeTriangles {
  const positions: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const outer = (2 * Math.PI * i) / segments;
    for (let j = 0; j <= segments; j += 1) {
      const inner = (2 * Math.PI * j) / segments;
      const distance = ring + Math.cos(inner) * tube;
      positions.push(Math.cos(outer) * distance, Math.sin(inner) * tube, -Math.sin(outer) * distance);
    }
  }
  return { positions: Float32Array.from(positions), indices: gridIndices(segments, segments) };
}

/**
 * The triangles of a `(rows + 1) × (columns + 1)` vertex grid.
 *
 * @param rows - Quads along the first axis.
 * @param columns - Quads along the second.
 * @returns Six indices per quad.
 */
function gridIndices(rows: number, columns: number): Uint32Array {
  const indices: number[] = [];
  const stride = columns + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * stride + column;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return Uint32Array.from(indices);
}
