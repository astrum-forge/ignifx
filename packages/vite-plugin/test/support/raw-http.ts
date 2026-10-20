import { request } from "node:http";
import type { AddressInfo } from "node:net";
import type { PreviewServer, ViteDevServer } from "vite";

/** A response as {@link rawGet} reads it. */
export interface RawResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * Sends a request with the path exactly as given: `fetch` would resolve `..`, `./` and `\` first.
 *
 * @param port - The server's port on 127.0.0.1.
 * @param path - The raw request target.
 * @param headers - Extra request headers.
 */
export function rawGet(port: number, path: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path, method: "GET", headers: { Accept: "*/*", ...headers } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
        response.on("error", reject);
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** The port a listening server bound. */
export function portOf(server: ViteDevServer | PreviewServer): number {
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("The server is not listening on a TCP port.");
  }
  return (address satisfies AddressInfo).port;
}
