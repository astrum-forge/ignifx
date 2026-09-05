import type { Plugin } from "vite";

/** The subset of Rollup's `EmittedAsset` the plugin uses; `rolldown` is not a direct dependency. */
export interface EmittedAssetLike {
  readonly type: "asset";
  readonly fileName?: string;
  readonly name?: string;
  readonly originalFileName?: string;
  readonly source: string | Uint8Array;
}

/** A middleware as Vite's connect app sees it. */
export type MiddlewareHandler = (request: { url?: string }, response: FakeResponse, next: () => void) => void;

/** One file the plugin asked the bundler to write. */
export interface EmittedFile {
  readonly fileName: string;
  readonly source: string | Uint8Array;
  readonly originalFileName: string | undefined;
}

/** A stand-in for Rollup's `PluginContext`, recording what the plugin emits, warns, and errors. */
export class FakePluginContext {
  readonly emitted: EmittedFile[] = [];
  readonly warnings: string[] = [];

  emitFile(file: EmittedAssetLike): string {
    this.emitted.push({
      fileName: file.fileName ?? file.name ?? "",
      source: file.source,
      originalFileName: file.originalFileName,
    });
    return `ref-${String(this.emitted.length)}`;
  }

  warn(message: unknown): void {
    this.warnings.push(typeof message === "string" ? message : JSON.stringify(message));
  }

  error(message: unknown): never {
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
}

/** One message sent over the dev server's HMR socket. */
export type SentPayload = Record<string, unknown>;

/** A stand-in for the pieces of `ViteDevServer` the plugin touches. */
export class FakeDevServer {
  readonly sent: SentPayload[] = [];
  readonly logs: { level: string; message: string }[] = [];
  readonly middlewares: MiddlewareHandler[] = [];
  readonly watched: string[] = [];
  readonly invalidated: string[] = [];
  readonly #listeners = new Map<string, ((file: string) => void)[]>();

  readonly config = {
    root: "",
    base: "/",
    logger: {
      info: (message: string): void => {
        this.logs.push({ level: "info", message });
      },
      warn: (message: string): void => {
        this.logs.push({ level: "warn", message });
      },
      error: (message: string): void => {
        this.logs.push({ level: "error", message });
      },
    },
  };

  readonly watcher = {
    add: (path: string): void => {
      this.watched.push(path);
    },
    on: (event: string, listener: (file: string) => void): void => {
      const existing = this.#listeners.get(event) ?? [];
      existing.push(listener);
      this.#listeners.set(event, existing);
    },
  };

  readonly ws = {
    send: (payload: SentPayload): void => {
      this.sent.push(payload);
    },
  };

  readonly moduleGraph = {
    getModuleById: (id: string): { id: string } | undefined => ({ id }),
    invalidateModule: (module: { id: string }): void => {
      this.invalidated.push(module.id);
    },
  };

  constructor(root: string) {
    this.config.root = root;
  }

  /** Registers a middleware the way Vite's connect app does. */
  use(handler: MiddlewareHandler): void {
    this.middlewares.push(handler);
  }

  /** Fires every listener registered for a watcher event. */
  emit(event: "add" | "change" | "unlink", file: string): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      listener(file);
    }
  }

  /** Runs the registered middlewares against one request, returning the response. */
  request(url: string): FakeResponse {
    const response = new FakeResponse();
    let index = 0;
    const next = (): void => {
      const handler = this.middlewares[index];
      index += 1;
      if (handler !== undefined) {
        handler({ url }, response, next);
      }
    };
    next();
    return response;
  }
}

/** A stand-in for `http.ServerResponse` that records what a middleware wrote. */
export class FakeResponse {
  readonly headers: Record<string, string> = {};
  body: string | null = null;
  piped = false;

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  end(body?: string): void {
    this.body = body ?? "";
  }

  // `createReadStream(...).pipe(response)` needs these; the test only asserts that it happened.
  on(): this {
    return this;
  }

  once(): this {
    return this;
  }

  emit(): boolean {
    return true;
  }

  write(chunk: string | Uint8Array): boolean {
    this.piped = true;
    this.body = (this.body ?? "") + (typeof chunk === "string" ? chunk : `<${String(chunk.byteLength)} bytes>`);
    return true;
  }
}

/** The plugin's hooks, typed loosely enough to be called directly from a test. */
export interface PluginHarness {
  config(
    userConfig: { root?: string },
    env: { command: "build" | "serve"; mode: string },
  ): Promise<{ define?: Record<string, string> } | undefined>;
  configResolved(config: { root: string; base: string; command: "build" | "serve" }): void;
  buildStart(this: FakePluginContext): Promise<void>;
  resolveId(id: string): string | null;
  load(this: FakePluginContext, id: string): Promise<string | null>;
  generateBundle(this: FakePluginContext): Promise<void>;
  configureServer(server: unknown): Promise<void>;
}

/**
 * Views a plugin as its hooks, so a test can drive them without a Vite server.
 *
 * @param plugin - The plugin under test.
 * @returns The same object, typed for direct calls.
 */
export function harness(plugin: Plugin): PluginHarness {
  return plugin as unknown as PluginHarness;
}

/**
 * Wires a fake dev server so the plugin's `configureServer` can install middleware on it.
 *
 * @param server - The fake server.
 * @returns The object to pass to `configureServer`.
 */
export function asViteServer(server: FakeDevServer): unknown {
  return {
    config: server.config,
    watcher: server.watcher,
    ws: server.ws,
    moduleGraph: server.moduleGraph,
    middlewares: {
      use: (handler: MiddlewareHandler): void => {
        server.use(handler);
      },
    },
  };
}
