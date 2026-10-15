// THROWAWAY spike S0.1. The editor renderer: one cross-origin iframe on the project's dev server,
// a MessagePort handed into it, JSON-RPC ping, timings reported to main.
interface SpikeBridge {
  readonly devOrigin: string;
  readonly play: boolean;
  readonly playOrigin: string;
  report(message: unknown): void;
  onServerReady(callback: () => void): void;
}
declare global {
  interface Window {
    spike: SpikeBridge;
  }
}

interface RpcMessage {
  readonly jsonrpc: "2.0";
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly error?: unknown;
}

const bar = document.querySelector("#bar");
const views = document.querySelector("#views");
const { spike } = window;

function say(text: string): void {
  if (bar !== null) {
    bar.textContent = text;
  }
}

function report(kind: string, data: Record<string, unknown>): void {
  spike.report({ kind, rendererNow: performance.now(), epochMs: Date.now(), ...data });
}

window.addEventListener("securitypolicyviolation", (event) => {
  report("cspViolation", {
    directive: event.effectiveDirective,
    blocked: event.blockedURI,
    policy: event.originalPolicy,
  });
});

function openSceneView(): void {
  const iframeCreatedAt = performance.now();
  const iframe = document.createElement("iframe");
  iframe.src = `${spike.devOrigin}/__ignifx_editor__/`;
  iframe.title = "scene view";
  // A new channel per document: a reloaded iframe is a new document and the old port is gone
  // (re-posting a transferred port throws DataCloneError "already neutered").
  let port: MessagePort = new MessageChannel().port1;
  let loads = 0;
  let nextId = 1;
  const waiting = new Map<number, (message: RpcMessage) => void>();

  function call(method: string): Promise<{ message: RpcMessage; rttMs: number }> {
    const id = nextId;
    nextId += 1;
    const sentAt = performance.now();
    return new Promise((resolve) => {
      waiting.set(id, (message) => {
        resolve({ message, rttMs: performance.now() - sentAt });
      });
      port.postMessage({ jsonrpc: "2.0", id, method });
    });
  }

  async function measurePings(): Promise<void> {
    const rtts: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      // Sequential on purpose: each round trip is measured alone.
      // eslint-disable-next-line no-await-in-loop
      const { rttMs } = await call("ping");
      rtts.push(rttMs);
    }
    report("pingRtts", { rtts });
  }

  const onPortMessage = (event: MessageEvent): void => {
    const message = event.data as RpcMessage;
    if (message.id !== undefined) {
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
      return;
    }
    if (message.method === "firstFrame") {
      report("firstFrame", { load: loads, sinceIframeCreatedMs: performance.now() - iframeCreatedAt, params: message.params });
      say(`scene view: first frame ${Math.round(performance.now() - iframeCreatedAt)} ms after iframe creation`);
      if (loads === 1) {
        void measurePings();
      }
      return;
    }
    report(message.method ?? "unknown", { params: message.params });
  };

  iframe.addEventListener("load", () => {
    loads += 1;
    report("iframeLoad", { load: loads, sinceIframeCreatedMs: performance.now() - iframeCreatedAt });
    port.close();
    waiting.clear();
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = onPortMessage;
    // The target origin is the dev server's, so the port cannot be delivered to anything else that
    // the frame might have navigated to.
    iframe.contentWindow?.postMessage({ type: "ignifx-editor/connect", protocol: 0 }, spike.devOrigin, [channel.port2]);
    void call("ping").then(({ message, rttMs }) => {
      report("firstPong", { load: loads, sinceIframeCreatedMs: performance.now() - iframeCreatedAt, rttMs, result: message.result });
    });
  });
  views?.append(iframe);
  report("iframeCreated", { src: iframe.src });
}

function openPlayView(): void {
  const iframe = document.createElement("iframe");
  iframe.src = `${spike.playOrigin}/`;
  iframe.title = "play view";
  views?.append(iframe);
  report("playIframeCreated", { src: iframe.src });
}

spike.onServerReady(() => {
  say("dev server ready; loading scene view");
  openSceneView();
  if (spike.play) {
    openPlayView();
  }
});
report("rendererReady", { origin: window.location.origin, isSecureContext: window.isSecureContext });
