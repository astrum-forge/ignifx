import type { FetchLike } from "../../../src/assets/types.js";

/**
 * A `fetch` a test drives by hand (`docs/architecture/05-assets-and-loading.md` §8: the service
 * reaches the network through one injectable function). Nothing settles until the test says so, so
 * "the fake resolved but the frame has not run" is an observable state — which is exactly what the
 * `PreUpdate` delivery rule has to be tested against.
 */

/** How a fake response is built. */
export interface FakeResponseInit {
  /** The HTTP status. Defaults to `200`. */
  readonly status?: number;
  /** Response headers, for example `{ "content-length": "12" }`. */
  readonly headers?: Record<string, string>;
}

/** One request the service made and has not had answered yet. */
export class FakeRequest {
  /** The URL the service asked for. */
  readonly url: string;

  /** The signal the service passed, if any. */
  readonly signal: AbortSignal | null;

  /** `true` once the request has been answered, failed, or aborted. */
  isSettled = false;

  readonly #resolve: (response: Response) => void;

  readonly #reject: (reason: unknown) => void;

  constructor(
    url: string,
    signal: AbortSignal | null,
    resolve: (response: Response) => void,
    reject: (reason: unknown) => void,
  ) {
    this.url = url;
    this.signal = signal;
    this.#resolve = resolve;
    this.#reject = reject;
  }

  /** Answers with a body. */
  respond(body: BodyInit = "", init?: FakeResponseInit): void {
    if (this.isSettled) {
      return;
    }
    this.isSettled = true;
    this.#resolve(new Response(body, { status: init?.status ?? 200, headers: init?.headers ?? {} }));
  }

  /** Answers with a streamed body the test pushes chunks into. */
  respondStream(init?: FakeResponseInit): FakeStream {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (source): void => {
        controller = source;
      },
    });
    this.isSettled = true;
    this.#resolve(new Response(stream, { status: init?.status ?? 200, headers: init?.headers ?? {} }));
    return {
      push: (bytes: Uint8Array): void => {
        controller?.enqueue(bytes);
      },
      close: (): void => {
        controller?.close();
      },
    };
  }

  /** Fails the request the way a network error would. */
  fail(error: unknown = new Error("network down")): void {
    if (this.isSettled) {
      return;
    }
    this.isSettled = true;
    this.#reject(error);
  }
}

/** A streamed response body under a test's control. */
export interface FakeStream {
  /** Delivers one chunk. */
  push(bytes: Uint8Array): void;
  /** Ends the body. */
  close(): void;
}

/** The injectable `fetch` plus the requests it has recorded. */
export class FakeFetch {
  /** Every request in the order it was made, answered or not. */
  readonly requests: FakeRequest[] = [];

  /** The function handed to `createApp({ fetch })`. */
  readonly fetch: FetchLike;

  /** Bodies answered automatically, keyed by URL. */
  readonly canned = new Map<string, string>();

  constructor() {
    this.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const signal = init?.signal ?? null;
      return new Promise<Response>((resolve, reject) => {
        const request = new FakeRequest(url, signal, resolve, reject);
        this.requests.push(request);
        if (signal !== null) {
          if (signal.aborted) {
            request.fail(abortError());
          } else {
            signal.addEventListener(
              "abort",
              (): void => {
                request.fail(abortError());
              },
              { once: true },
            );
          }
        }
        const body = this.canned.get(url);
        if (body !== undefined) {
          request.respond(body);
        }
      });
    };
  }

  /** How many requests have not been answered. */
  get pendingCount(): number {
    let count = 0;
    for (const request of this.requests) {
      if (!request.isSettled) {
        count += 1;
      }
    }
    return count;
  }

  /** The oldest unanswered request for a URL, or `null`. */
  pending(url: string): FakeRequest | null {
    for (const request of this.requests) {
      if (request.url === url && !request.isSettled) {
        return request;
      }
    }
    return null;
  }

  /** The oldest unanswered request for a URL, failing the test when there is none. */
  expect(url: string): FakeRequest {
    const request = this.pending(url);
    if (request === null) {
      throw new Error(`No pending request for ${url}; saw ${this.requests.map((r) => r.url).join(", ")}`);
    }
    return request;
  }

  /** Answers every unanswered request with the same body. */
  respondAll(body: BodyInit = ""): void {
    for (const request of this.requests.slice()) {
      request.respond(body);
    }
  }

  /** The URLs of every request made so far, in order. */
  get urls(): string[] {
    return this.requests.map((request) => request.url);
  }
}

/** Reads the URL out of whichever form the caller passed; the service always passes a string. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/** The rejection `fetch` produces when its signal aborts. */
function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
