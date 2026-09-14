import type { EmitterRandom } from "./pcg3d.js";
import type { ParticleShape } from "../definition/types.js";

// The emitter shapes (`docs/plan/2026-09-terrain-particles-shaders.md` §4.2), in the emitter's
// local space with `+Y` as the directional axis. Each draws its random numbers in a fixed order, so
// two systems with one seed spawn identical particles.

/** Degrees to radians. */
const DEG_TO_RAD = Math.PI / 180;

/** Two pi. */
const TAU = Math.PI * 2;

/** The smallest length a direction is normalized from. */
const EPSILON = 1e-8;

/**
 * Precomputed data a `"mesh"` shape samples from: the cumulative area of its triangles.
 *
 * @beta
 */
export class MeshShapeTable {
  /** Cumulative areas, one per triangle, ending at the total. */
  readonly cumulative: Float32Array;

  /** The triangle soup, nine floats per triangle. */
  readonly vertices: Float32Array;

  /**
   * Builds the table.
   *
   * @param vertices - Nine floats per triangle.
   */
  constructor(vertices: Float32Array) {
    this.vertices = vertices;
    const count = Math.floor(vertices.length / 9);
    this.cumulative = new Float32Array(count);
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      const base = index * 9;
      const ax = vertices[base] ?? 0;
      const ay = vertices[base + 1] ?? 0;
      const az = vertices[base + 2] ?? 0;
      const ux = (vertices[base + 3] ?? 0) - ax;
      const uy = (vertices[base + 4] ?? 0) - ay;
      const uz = (vertices[base + 5] ?? 0) - az;
      const vx = (vertices[base + 6] ?? 0) - ax;
      const vy = (vertices[base + 7] ?? 0) - ay;
      const vz = (vertices[base + 8] ?? 0) - az;
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      total += 0.5 * Math.hypot(cx, cy, cz);
      this.cumulative[index] = total;
    }
  }

  /**
   * The total surface area.
   *
   * @returns The area.
   */
  get area(): number {
    return this.cumulative[this.cumulative.length - 1] ?? 0;
  }
}

/**
 * Samples a start position and direction from a shape.
 *
 * @param shape - The shape module.
 * @param rng - The emitter's random stream.
 * @param mesh - The triangle table, for a `"mesh"` shape; ignored otherwise.
 * @param position - Receives the local position.
 * @param direction - Receives the unit direction.
 *
 * @beta
 */
export function sampleShape(
  shape: ParticleShape,
  rng: EmitterRandom,
  mesh: MeshShapeTable | null,
  position: Float32Array,
  direction: Float32Array,
): void {
  switch (shape.kind) {
    case "point":
      position[0] = 0;
      position[1] = 0;
      position[2] = 0;
      direction[0] = 0;
      direction[1] = 1;
      direction[2] = 0;
      break;
    case "sphere":
      sampleSphere(shape, rng, false, position, direction);
      break;
    case "hemisphere":
      sampleSphere(shape, rng, true, position, direction);
      break;
    case "cone":
      sampleCone(shape, rng, position, direction);
      break;
    case "box":
      sampleBox(shape, rng, position, direction);
      break;
    case "circle":
      sampleCircle(shape, rng, position, direction);
      break;
    case "edge":
      position[0] = (rng.next() - 0.5) * shape.length;
      position[1] = 0;
      position[2] = 0;
      direction[0] = 0;
      direction[1] = 1;
      direction[2] = 0;
      break;
    case "mesh":
      sampleMesh(mesh, rng, position, direction);
      break;
  }
  finishDirection(shape, rng, position, direction);
}

/**
 * Applies `randomDirection` and `spherizeDirection`, then normalizes.
 *
 * @param shape - The shape module.
 * @param rng - The random stream.
 * @param position - The sampled position.
 * @param direction - The direction to adjust in place.
 */
function finishDirection(
  shape: ParticleShape,
  rng: EmitterRandom,
  position: Float32Array,
  direction: Float32Array,
): void {
  const random = shape.randomDirection;
  if (random > 0) {
    const z = 1 - 2 * rng.next();
    const theta = TAU * rng.next();
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const rx = r * Math.cos(theta);
    const ry = r * Math.sin(theta);
    direction[0] = (direction[0] ?? 0) * (1 - random) + rx * random;
    direction[1] = (direction[1] ?? 0) * (1 - random) + ry * random;
    direction[2] = (direction[2] ?? 0) * (1 - random) + z * random;
  }
  const spherize = shape.spherizeDirection;
  if (spherize > 0) {
    const px = position[0] ?? 0;
    const py = position[1] ?? 0;
    const pz = position[2] ?? 0;
    const length = Math.hypot(px, py, pz);
    if (length > EPSILON) {
      direction[0] = (direction[0] ?? 0) * (1 - spherize) + (px / length) * spherize;
      direction[1] = (direction[1] ?? 0) * (1 - spherize) + (py / length) * spherize;
      direction[2] = (direction[2] ?? 0) * (1 - spherize) + (pz / length) * spherize;
    }
  }
  normalize(direction);
}

/**
 * Normalizes a direction in place, falling back to `+Y` for a zero vector.
 *
 * @param direction - The vector.
 */
function normalize(direction: Float32Array): void {
  const x = direction[0] ?? 0;
  const y = direction[1] ?? 0;
  const z = direction[2] ?? 0;
  const length = Math.hypot(x, y, z);
  if (length <= EPSILON) {
    direction[0] = 0;
    direction[1] = 1;
    direction[2] = 0;
    return;
  }
  direction[0] = x / length;
  direction[1] = y / length;
  direction[2] = z / length;
}

/**
 * Samples a sphere or hemisphere: a direction inside the arc, then a radius by thickness.
 *
 * @param shape - The shape.
 * @param rng - The random stream.
 * @param upperHalf - Whether to mirror into `y >= 0`.
 * @param position - Receives the position.
 * @param direction - Receives the radial direction.
 */
function sampleSphere(
  shape: ParticleShape,
  rng: EmitterRandom,
  upperHalf: boolean,
  position: Float32Array,
  direction: Float32Array,
): void {
  const z = 1 - 2 * rng.next();
  const theta = shape.arc * DEG_TO_RAD * rng.next();
  const ring = Math.sqrt(Math.max(0, 1 - z * z));
  let dx = ring * Math.cos(theta);
  let dy = z;
  const dz = ring * Math.sin(theta);
  if (upperHalf && dy < 0) {
    dy = -dy;
  }
  const radius = shape.radius * radialFraction(shape, rng, 3);
  direction[0] = dx;
  direction[1] = dy;
  direction[2] = dz;
  dx *= radius;
  dy *= radius;
  position[0] = dx;
  position[1] = dy;
  position[2] = dz * radius;
}

/**
 * How far out a volume sample sits, in `[1 - thickness, 1]`, distributed uniformly by volume or area.
 *
 * @param shape - The shape, for `thickness` and `emitFrom`.
 * @param rng - The random stream.
 * @param dimensions - `3` for a ball, `2` for a disc.
 * @returns The fraction of the radius.
 */
function radialFraction(shape: ParticleShape, rng: EmitterRandom, dimensions: number): number {
  if (shape.emitFrom === "shell" || shape.thickness <= 0) {
    return 1;
  }
  const inner = 1 - shape.thickness;
  const unit = rng.next();
  const innerPow = inner ** dimensions;
  return (innerPow + (1 - innerPow) * unit) ** (1 / dimensions);
}

/**
 * Samples a cone: a point on the base disc and a direction tilted by the half-angle at the rim.
 *
 * @param shape - The shape.
 * @param rng - The random stream.
 * @param position - Receives the position.
 * @param direction - Receives the direction.
 */
function sampleCone(shape: ParticleShape, rng: EmitterRandom, position: Float32Array, direction: Float32Array): void {
  const theta = shape.arc * DEG_TO_RAD * rng.next();
  const fraction = radialFraction(shape, rng, 2);
  const rho = shape.radius * fraction;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const angle = shape.angle * DEG_TO_RAD;
  const tilt = Math.sin(angle) * fraction;
  direction[0] = tilt * cosTheta;
  direction[1] = Math.cos(angle);
  direction[2] = tilt * sinTheta;
  normalize(direction);
  const height = shape.emitFrom === "volume" ? shape.length * rng.next() : 0;
  position[0] = rho * cosTheta + direction[0] * height;
  position[1] = direction[1] * height;
  position[2] = rho * sinTheta + direction[2] * height;
}

/**
 * Samples a box: anywhere inside, or on one of its six faces.
 *
 * @param shape - The shape.
 * @param rng - The random stream.
 * @param position - Receives the position.
 * @param direction - Receives `+Y`.
 */
function sampleBox(shape: ParticleShape, rng: EmitterRandom, position: Float32Array, direction: Float32Array): void {
  const x = rng.next() - 0.5;
  const y = rng.next() - 0.5;
  const z = rng.next() - 0.5;
  position[0] = x * shape.size.x;
  position[1] = y * shape.size.y;
  position[2] = z * shape.size.z;
  if (shape.emitFrom === "shell") {
    const face = Math.min(5, Math.floor(rng.next() * 6));
    const sign = face % 2 === 0 ? -0.5 : 0.5;
    if (face < 2) {
      position[0] = sign * shape.size.x;
    } else if (face < 4) {
      position[1] = sign * shape.size.y;
    } else {
      position[2] = sign * shape.size.z;
    }
  }
  direction[0] = 0;
  direction[1] = 1;
  direction[2] = 0;
}

/**
 * Samples a circle in the XZ plane, emitting outward.
 *
 * @param shape - The shape.
 * @param rng - The random stream.
 * @param position - Receives the position.
 * @param direction - Receives the radial direction.
 */
function sampleCircle(shape: ParticleShape, rng: EmitterRandom, position: Float32Array, direction: Float32Array): void {
  const theta = shape.arc * DEG_TO_RAD * rng.next();
  const fraction = radialFraction(shape, rng, 2);
  const dx = Math.cos(theta);
  const dz = Math.sin(theta);
  direction[0] = dx;
  direction[1] = 0;
  direction[2] = dz;
  position[0] = dx * shape.radius * fraction;
  position[1] = 0;
  position[2] = dz * shape.radius * fraction;
}

/**
 * Samples a triangle soup by area, emitting along the face normal.
 *
 * @param mesh - The triangle table.
 * @param rng - The random stream.
 * @param position - Receives the position.
 * @param direction - Receives the face normal.
 */
function sampleMesh(
  mesh: MeshShapeTable | null,
  rng: EmitterRandom,
  position: Float32Array,
  direction: Float32Array,
): void {
  if (mesh === null || mesh.cumulative.length === 0 || mesh.area <= 0) {
    position[0] = 0;
    position[1] = 0;
    position[2] = 0;
    direction[0] = 0;
    direction[1] = 1;
    direction[2] = 0;
    return;
  }
  const target = rng.next() * mesh.area;
  const cumulative = mesh.cumulative;
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((cumulative[mid] ?? 0) < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const base = low * 9;
  const vertices = mesh.vertices;
  const ax = vertices[base] ?? 0;
  const ay = vertices[base + 1] ?? 0;
  const az = vertices[base + 2] ?? 0;
  const bx = vertices[base + 3] ?? 0;
  const by = vertices[base + 4] ?? 0;
  const bz = vertices[base + 5] ?? 0;
  const cx = vertices[base + 6] ?? 0;
  const cy = vertices[base + 7] ?? 0;
  const cz = vertices[base + 8] ?? 0;
  const r1 = Math.sqrt(rng.next());
  const r2 = rng.next();
  const wa = 1 - r1;
  const wb = r1 * (1 - r2);
  const wc = r1 * r2;
  position[0] = ax * wa + bx * wb + cx * wc;
  position[1] = ay * wa + by * wb + cy * wc;
  position[2] = az * wa + bz * wb + cz * wc;
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  direction[0] = uy * vz - uz * vy;
  direction[1] = uz * vx - ux * vz;
  direction[2] = ux * vy - uy * vx;
  normalize(direction);
}
