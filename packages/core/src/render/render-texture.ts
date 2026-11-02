import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type { RenderCapture } from "./renderer.js";
import type { LiteCamera } from "../lite/camera.js";
import type { LiteRenderTexture } from "../lite/gpu/render-texture.js";

/**
 * The largest side of a render texture, in pixels.
 *
 * @public
 */
export const RENDER_TEXTURE_MAX_SIZE = 4096;

/**
 * An offscreen colour target a camera renders into (`docs/architecture/07-rendering.md` §2.11).
 *
 * @remarks
 * Create one with `app.renderer.createRenderTexture(width, height)`. Fill it once with
 * `app.renderer.renderToTexture(camera, texture)`, or every frame by setting a camera's
 * `renderTarget`. It holds a GPU pass of the render scene and its target from the first render
 * on; `dispose()` frees both, and `app.dispose()` disposes every texture still open.
 *
 * @example
 * ```ts
 * const texture = app.renderer.createRenderTexture(256, 256);
 * await app.renderer.renderToTexture(minimapCamera, texture);
 * const pixels = await texture.readPixels();
 * texture.dispose();
 * ```
 *
 * @beta
 */
export interface RenderTexture {
  /** The width, in pixels. */
  readonly width: number;
  /** The height, in pixels. */
  readonly height: number;
  /** Whether `dispose()` has run. */
  readonly isDisposed: boolean;
  /**
   * Reads the texture as the last rendered frame left it.
   *
   * @returns Tightly packed RGBA8, top row first. All zeros before anything was rendered into it.
   * @throws IgnifxError with code `IGX-0729` on a headless app or while no render loop runs, and
   * `IGX-0731` once the texture is disposed.
   */
  readPixels(): Promise<RenderCapture>;
  /** Frees the texture's GPU pass and target. Idempotent; a camera rendering into it stops. */
  dispose(): void;
}

/**
 * What a render texture needs from the renderer that made it.
 *
 * @internal
 */
export interface RenderTextureOwner {
  /**
   * Creates the texture's GPU pass, or throws why it cannot.
   *
   * @param width - The width.
   * @param height - The height.
   * @param member - The API member asking, for the error.
   * @returns The pass.
   */
  createPass(width: number, height: number, member: string): Promise<LiteRenderTexture>;
  /**
   * Forgets a disposed texture.
   *
   * @param texture - The texture.
   */
  release(texture: RenderTextureImpl): void;
}

/** A pending one-frame render. */
interface RenderRequest {
  /** The camera to render through. */
  readonly camera: LiteCamera;
  /** Settles the request once its frame has been submitted. */
  readonly resolve: () => void;
}

/**
 * Checks a render texture's size.
 *
 * @param width - The requested width.
 * @param height - The requested height.
 * @throws IgnifxError with code `IGX-0730` for a side that is not a whole number from 1 to
 * {@link RENDER_TEXTURE_MAX_SIZE}.
 *
 * @internal
 */
export function assertRenderTextureSize(width: number, height: number): void {
  const isSide = (side: number): boolean => Number.isSafeInteger(side) && side >= 1 && side <= RENDER_TEXTURE_MAX_SIZE;
  if (!isSide(width) || !isSide(height)) {
    throw new IgnifxError(
      CoreErrorCode.invalidRenderTextureSize,
      `A render texture of ${String(width)}x${String(height)}: each side must be a whole number from 1 to ${String(RENDER_TEXTURE_MAX_SIZE)}.`,
      { context: { member: "app.renderer.createRenderTexture()", width, height, max: RENDER_TEXTURE_MAX_SIZE } },
    );
  }
}

/**
 * The renderer's render texture: the per-frame camera choice and the one-frame requests.
 *
 * @internal
 */
export class RenderTextureImpl implements RenderTexture {
  readonly width: number;

  readonly height: number;

  readonly #owner: RenderTextureOwner;

  #pass: LiteRenderTexture | null = null;

  #creating: Promise<LiteRenderTexture> | null = null;

  /** The camera whose `renderTarget` this is, as the current frame's sync found it. */
  #frameCamera: LiteCamera | null = null;

  readonly #requests: RenderRequest[] = [];

  #isDisposed = false;

  /**
   * Creates the texture; its GPU pass is created on first use.
   *
   * @param owner - The renderer.
   * @param width - The checked width.
   * @param height - The checked height.
   */
  constructor(owner: RenderTextureOwner, width: number, height: number) {
    this.#owner = owner;
    this.width = width;
    this.height = height;
  }

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /**
   * Resolves the texture's GPU pass, creating it once.
   *
   * @param member - The API member asking, for the error.
   * @returns The pass.
   */
  async pass(member: string): Promise<LiteRenderTexture> {
    this.assertUsable(member);
    this.#creating ??= this.#owner.createPass(this.width, this.height, member).then(
      (pass) => {
        if (this.#isDisposed) {
          pass.dispose();
        } else {
          this.#pass = pass;
        }
        return pass;
      },
      (error: unknown) => {
        this.#creating = null;
        throw error;
      },
    );
    const pass = await this.#creating;
    this.assertUsable(member);
    return pass;
  }

  /**
   * Queues a render through a camera on the next frame.
   *
   * @param camera - The Lite camera.
   * @returns A promise that settles once that frame has been submitted.
   */
  request(camera: LiteCamera): Promise<void> {
    return new Promise((resolve) => {
      this.#requests.push({ camera, resolve });
    });
  }

  /**
   * Notes the camera that renders into this texture every frame. The render sync system calls it
   * for every enabled camera whose `renderTarget` this is, before {@link RenderTextureImpl.flush}.
   *
   * @param camera - The Lite camera.
   */
  setFrameCamera(camera: LiteCamera): void {
    this.#frameCamera = camera;
    if (this.#pass === null && this.#creating === null) {
      // The first frame only starts the pass; a failure leaves it for the next frame to retry.
      this.pass("Camera.renderTarget").catch(() => null);
    }
  }

  /**
   * Points the pass at this frame's camera: the oldest request's, else the `renderTarget` one's,
   * else none. Requests for that camera settle once the frame is submitted.
   */
  flush(): void {
    const pass = this.#pass;
    const requested = this.#requests[0]?.camera ?? null;
    const camera = requested ?? this.#frameCamera;
    this.#frameCamera = null;
    if (pass === null) {
      return;
    }
    pass.setCamera(camera);
    if (requested === null) {
      return;
    }
    const served: RenderRequest[] = [];
    for (let index = this.#requests.length - 1; index >= 0; index -= 1) {
      const pending = this.#requests[index];
      if (pending !== undefined && pending.camera === requested) {
        served.push(pending);
        this.#requests.splice(index, 1);
      }
    }
    // The frame graph executes after this frame callback and submits in the same task; a microtask
    // runs once it has.
    queueMicrotask(() => {
      for (const pending of served) {
        pending.resolve();
      }
    });
  }

  async readPixels(): Promise<RenderCapture> {
    const pass = await this.pass("RenderTexture.readPixels()");
    const data = await pass.read();
    return { width: this.width, height: this.height, data };
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#pass?.dispose();
    this.#pass = null;
    this.#owner.release(this);
    // Nothing will render them now; settling beats leaving the caller waiting forever.
    for (const pending of this.#requests.splice(0)) {
      pending.resolve();
    }
  }

  /**
   * Refuses a disposed texture.
   *
   * @param member - The API member asking.
   * @throws IgnifxError with code `IGX-0731` once disposed.
   */
  assertUsable(member: string): void {
    if (this.#isDisposed) {
      throw renderTextureUnusableError(member);
    }
  }
}

/**
 * The error for a disposed or foreign render texture.
 *
 * @param member - The API member asking.
 * @returns The error.
 *
 * @internal
 */
export function renderTextureUnusableError(member: string): IgnifxError {
  return new IgnifxError(
    CoreErrorCode.renderTextureUnusable,
    `${member}: the render texture is disposed or belongs to another app.`,
    {
      context: { member },
      hint: "Create a render texture with this app's app.renderer.createRenderTexture() and keep it until you dispose it.",
    },
  );
}
