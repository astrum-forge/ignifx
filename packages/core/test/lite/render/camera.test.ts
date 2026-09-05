import { describe, expect, it } from "vitest";
import {
  cameraAspectRatio,
  createCameraUnderNode,
  readProjectionMatrix,
  readViewMatrix,
  readViewProjectionMatrix,
  resetCameraViewport,
  resolveViewportPixels,
  screenToRay,
  setCameraClipPlanes,
  setCameraOrthographic,
  setCameraOrthographicSize,
  setCameraParent,
  setCameraPerspective,
  setCameraViewport,
  setSceneCamera,
  worldToScreen,
} from "../../../src/lite/camera.js";
import { createNode } from "../../../src/lite/node.js";
import { createPickRay } from "../../../src/lite/picking.js";
import { createHeadlessScene, disposeSceneOnly } from "../../../src/lite/scene.js";
import { Mat4 } from "../../../src/math/mat4.js";
import { degToRad } from "../../../src/math/math-utils.js";

/**
 * Spike S2.1, headless half: a `FreeCamera` parented under an entity node follows that node exactly,
 * the orthographic toggle behaves, and `resolveCameraViewport` really does flip y. The pixel proof
 * that the rendered image moves with the node is in `camera.browser.test.ts`.
 */

/** A quaternion for a rotation of `degrees` about the world Y axis. */
function yawQuaternion(degrees: number): { x: number; y: number; z: number; w: number } {
  const half = degToRad(degrees) / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

describe("S2.1 · a camera parented under an entity node", () => {
  it("has the identity view matrix when its parent sits at the origin", () => {
    const camera = createCameraUnderNode(createNode("entity"));
    const view = new Float32Array(16);
    readViewMatrix(camera, view);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let i = 0; i < 16; i++) {
      expect(view[i]).toBeCloseTo(identity[i] ?? 0, 6);
    }
  });

  it("follows its parent's translation, inverted", () => {
    const node = createNode("entity");
    const camera = createCameraUnderNode(node);
    const view = new Float32Array(16);

    node.position.set(3, -4, 5);
    readViewMatrix(camera, view);

    expect(view[12]).toBeCloseTo(-3, 5);
    expect(view[13]).toBeCloseTo(4, 5);
    expect(view[14]).toBeCloseTo(-5, 5);
  });

  it("follows its parent's rotation, transposed", () => {
    const node = createNode("entity");
    const camera = createCameraUnderNode(node);
    const yaw = yawQuaternion(90);
    node.rotationQuaternion.set(yaw.x, yaw.y, yaw.z, yaw.w);

    const view = new Float32Array(16);
    readViewMatrix(camera, view);

    // A 90-degree yaw turns the camera's local +Z into world +X, so the view matrix — the inverse —
    // maps world +X back onto view +Z.
    expect(view[0]).toBeCloseTo(0, 5);
    expect(view[2]).toBeCloseTo(1, 5);
    expect(view[8]).toBeCloseTo(-1, 5);
    expect(view[10]).toBeCloseTo(0, 5);
  });

  it("stops following once it is detached", () => {
    const node = createNode("entity");
    const camera = createCameraUnderNode(node);
    node.position.set(0, 0, 7);

    setCameraParent(camera, null);
    const view = new Float32Array(16);
    readViewMatrix(camera, view);

    expect(view[14]).toBeCloseTo(0, 5);
  });
});

describe("camera projection", () => {
  it("takes the field of view in degrees and stores it in radians", () => {
    const camera = createCameraUnderNode(null);
    setCameraPerspective(camera, 60);
    expect(camera.fov).toBeCloseTo(Math.PI / 3, 10);
  });

  it("produces the same perspective matrix as the math module", () => {
    const camera = createCameraUnderNode(null);
    setCameraPerspective(camera, 60);
    setCameraClipPlanes(camera, 0.1, 1000);

    const actual = new Float32Array(16);
    readProjectionMatrix(camera, 16 / 9, actual);
    const expected = Mat4.perspectiveLH(60, 16 / 9, 0.1, 1000);

    for (let i = 0; i < 16; i++) {
      expect(actual[i]).toBeCloseTo(expected.elements[i] ?? 0, 5);
    }
  });

  it("derives orthographic clip planes from the half-height and the aspect ratio", () => {
    const camera = createCameraUnderNode(null);
    setCameraClipPlanes(camera, 0.1, 100);
    const bounds = setCameraOrthographic(camera, 5);

    expect(bounds.halfHeight).toBe(5);
    expect(bounds.left).toBeNull();
    expect(bounds.right).toBeNull();
    expect(bounds.bottom).toBeNull();
    expect(bounds.top).toBeNull();

    const actual = new Float32Array(16);
    readProjectionMatrix(camera, 2, actual);
    const expected = Mat4.orthoOffCenterLHToRef(-10, 10, -5, 5, 0.1, 100, new Mat4());
    for (let i = 0; i < 16; i++) {
      expect(actual[i]).toBeCloseTo(expected.elements[i] ?? 0, 5);
    }
  });

  it("keeps the same bounds object when the orthographic size changes", () => {
    const camera = createCameraUnderNode(null);
    const bounds = setCameraOrthographic(camera, 5);
    expect(setCameraOrthographic(camera, 2)).toBe(bounds);

    setCameraOrthographicSize(bounds, 8);
    expect(camera.ortho?.halfHeight).toBe(8);
  });

  it("returns to a perspective projection", () => {
    const camera = createCameraUnderNode(null);
    setCameraOrthographic(camera, 5);
    setCameraPerspective(camera, 45);

    expect(camera.ortho).toBeNull();
    const actual = new Float32Array(16);
    readProjectionMatrix(camera, 1, actual);
    const expected = Mat4.perspectiveLH(45, 1, camera.nearPlane, camera.farPlane);
    expect(actual[5]).toBeCloseTo(expected.elements[5] ?? 0, 5);
  });

  it("combines view and projection in that order", () => {
    const node = createNode("entity");
    const camera = createCameraUnderNode(node);
    setCameraPerspective(camera, 60);
    node.position.set(1, 2, 3);

    const view = new Mat4();
    const projection = new Mat4();
    const combined = new Float32Array(16);
    readViewMatrix(camera, view.elements);
    readProjectionMatrix(camera, 1.5, projection.elements);
    readViewProjectionMatrix(camera, 1.5, combined);

    const expected = Mat4.multiply(projection.elements, view.elements);
    for (let i = 0; i < 16; i++) {
      expect(combined[i]).toBeCloseTo(expected.elements[i] ?? 0, 4);
    }
  });
});

describe("camera viewport mapping", () => {
  it("measures normalized y from the bottom and pixel y from the top", () => {
    const camera = createCameraUnderNode(null);

    // The TOP half of the image is the normalized band whose bottom edge is at 0.5.
    setCameraViewport(camera, 0, 0.5, 1, 0.5);
    expect(resolveViewportPixels(camera, 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 50 });

    // The BOTTOM half starts at normalized y 0 and lands at pixel y 50.
    setCameraViewport(camera, 0, 0, 1, 0.5);
    expect(resolveViewportPixels(camera, 200, 100)).toEqual({ x: 0, y: 50, width: 200, height: 50 });
  });

  it("reuses the viewport object rather than allocating one per change", () => {
    const camera = createCameraUnderNode(null);
    setCameraViewport(camera, 0, 0, 0.5, 1);
    const first = camera.viewport;
    setCameraViewport(camera, 0.5, 0, 0.5, 1);
    expect(camera.viewport).toBe(first);
    expect(first?.x).toBe(0.5);
  });

  it("resets to the full target", () => {
    const camera = createCameraUnderNode(null);
    setCameraViewport(camera, 0.25, 0.25, 0.5, 0.5);
    resetCameraViewport(camera);
    expect(resolveViewportPixels(camera, 64, 32)).toEqual({ x: 0, y: 0, width: 64, height: 32 });
  });

  it("clamps a viewport that runs off the target", () => {
    const camera = createCameraUnderNode(null);
    setCameraViewport(camera, 0.75, 0.75, 1, 1);
    expect(resolveViewportPixels(camera, 100, 100)).toEqual({ x: 75, y: 0, width: 25, height: 25 });
  });

  it("treats a null camera as the whole target", () => {
    expect(resolveViewportPixels(null, 8, 4)).toEqual({ x: 0, y: 0, width: 8, height: 4 });
    expect(cameraAspectRatio(null, 8, 4)).toBe(2);
  });

  it("scales the aspect ratio by the viewport's own proportions", () => {
    const camera = createCameraUnderNode(null);
    setCameraViewport(camera, 0, 0, 0.5, 1);
    expect(cameraAspectRatio(camera, 200, 100)).toBe(1);
  });
});

describe("screen and world conversions", () => {
  it("builds a forward ray through the centre pixel", () => {
    const camera = createCameraUnderNode(null);
    setCameraPerspective(camera, 60);
    setCameraClipPlanes(camera, 0.1, 100);

    const ray = createPickRay();
    expect(screenToRay(camera, 50, 50, 100, 100, ray)).toBe(ray);
    expect(ray.direction[0]).toBeCloseTo(0, 4);
    expect(ray.direction[1]).toBeCloseTo(0, 4);
    expect(ray.direction[2]).toBeCloseTo(1, 4);
    expect(ray.origin[2]).toBeCloseTo(0.1, 3);
  });

  it("aims right and up for a pixel above and right of centre", () => {
    const camera = createCameraUnderNode(null);
    setCameraPerspective(camera, 60);
    const ray = createPickRay();
    screenToRay(camera, 90, 10, 100, 100, ray);

    expect(ray.direction[0]).toBeGreaterThan(0);
    expect(ray.direction[1]).toBeGreaterThan(0);
  });

  it("refuses to build a ray for an empty viewport", () => {
    const camera = createCameraUnderNode(null);
    expect(screenToRay(camera, 0, 0, 0, 10, createPickRay())).toBeNull();
    expect(screenToRay(camera, 0, 0, 10, 0, createPickRay())).toBeNull();
  });

  it("refuses to build a ray through a singular projection", () => {
    // Equal clip planes make the perspective matrix's depth range zero, so it cannot be inverted.
    const camera = createCameraUnderNode(null);
    setCameraPerspective(camera, 60);
    setCameraClipPlanes(camera, 1, 1);
    expect(screenToRay(camera, 5, 5, 10, 10, createPickRay())).toBeNull();
  });

  it("reports a point on the camera plane as not visible", () => {
    const camera = createCameraUnderNode(null);
    setCameraPerspective(camera, 60);
    const out = { x: 1, y: 1, z: 1 };
    expect(worldToScreen(camera, { x: 0, y: 0, z: 0 }, 100, 100, out)).toBe(false);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("projects a point in front of the camera back onto the pixel it came from", () => {
    const camera = createCameraUnderNode(null);
    setCameraPerspective(camera, 60);
    setCameraClipPlanes(camera, 0.1, 100);

    const ray = createPickRay();
    screenToRay(camera, 30, 70, 100, 100, ray);
    const distance = 12;
    const point = {
      x: ray.origin[0] + ray.direction[0] * distance,
      y: ray.origin[1] + ray.direction[1] * distance,
      z: ray.origin[2] + ray.direction[2] * distance,
    };

    const out = { x: 0, y: 0, z: 0 };
    expect(worldToScreen(camera, point, 100, 100, out)).toBe(true);
    expect(out.x).toBeCloseTo(30, 2);
    expect(out.y).toBeCloseTo(70, 2);
  });

  it("reports a point behind the camera as not visible", () => {
    const camera = createCameraUnderNode(null);
    setCameraPerspective(camera, 60);
    const out = { x: 0, y: 0, z: 0 };
    expect(worldToScreen(camera, { x: 0, y: 0, z: -5 }, 100, 100, out)).toBe(false);
  });
});

describe("the scene's active camera", () => {
  it("is set and cleared through the adapter", () => {
    const { scene } = createHeadlessScene();
    const camera = createCameraUnderNode(null);
    try {
      setSceneCamera(scene, camera);
      expect(scene.camera).toBe(camera);
      setSceneCamera(scene, null);
      expect(scene.camera).toBeNull();
    } finally {
      disposeSceneOnly(scene);
    }
  });
});
