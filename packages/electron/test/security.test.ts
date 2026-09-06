// Must come first: it registers the `electron` module mock every import below depends on.
// oxlint-disable-next-line import/no-unassigned-import -- see above.
import "./support/electron-mock.js";
import { describe, expect, it } from "vitest";
import { CSP_DIRECTIVE_ORDER, cspFor, defaultCsp } from "../src/main/csp.js";
import { allowedSenderOrigins, isAllowedExternalUrl, isTrustedSender } from "../src/main/ipc.js";
import { originOfUrl } from "../src/main/origin.js";
import { protocolPathFor } from "../src/main/protocol.js";
import {
  cspValueFor,
  DEFAULT_EXTERNAL_PROTOCOLS,
  ENFORCED_WEB_PREFERENCES,
  isDevServerEntry,
  windowOptionsFor,
} from "../src/main/window.js";

/**
 * The security checklist (`CONSTITUTION.md` §9.2, `docs/plan/engineering-plan.md` Phase 9 exit
 * criteria).
 *
 * Every assertion here is on a **pure builder**, which is the point: `windowOptionsFor`, `cspFor`,
 * and `isAllowedExternalUrl` were factored out of `createGameWindow` and `installHostHandlers`
 * precisely so the four `webPreferences` values §9.2 fixes, the exact Content-Security-Policy, and
 * the `openExternal` allow-list can be checked on every `pnpm test` — on CI runners with no
 * display, in a Node process with no Electron binary — rather than only on a machine that can open
 * a window.
 *
 * `tests/visual/tests/desktop.spec.ts` then proves the same four values *at runtime* through
 * `webContents.getLastWebPreferences()`, so the pure builder and the real window are pinned to each
 * other.
 */

const PRELOAD = "/Applications/Game.app/Contents/Resources/app/preload/index.cjs";

describe("the window options CONSTITUTION.md §9.2 fixes", () => {
  it("forces context isolation, the sandbox, no Node, and web security", () => {
    const { webPreferences } = windowOptionsFor({ entry: "index.html", preload: PRELOAD });

    expect(webPreferences?.contextIsolation).toBe(true);
    expect(webPreferences?.sandbox).toBe(true);
    expect(webPreferences?.nodeIntegration).toBe(false);
    expect(webPreferences?.webSecurity).toBe(true);
  });

  it("also refuses Node in workers and subframes, insecure content, webviews, and experiments", () => {
    const { webPreferences } = windowOptionsFor({ entry: "index.html", preload: PRELOAD });

    expect(webPreferences?.nodeIntegrationInWorker).toBe(false);
    expect(webPreferences?.nodeIntegrationInSubFrames).toBe(false);
    expect(webPreferences?.allowRunningInsecureContent).toBe(false);
    expect(webPreferences?.experimentalFeatures).toBe(false);
    expect(webPreferences?.webviewTag).toBe(false);
  });

  it("states the empty Blink feature list and turns WebSQL off rather than leaving both to defaults", () => {
    const { webPreferences } = windowOptionsFor({ entry: "index.html", preload: PRELOAD });

    // `enableBlinkFeatures` (electron.d.ts 19410) turns on features that ship disabled; the empty
    // string is the reviewable spelling of "none".
    expect(webPreferences?.enableBlinkFeatures).toBe("");
    expect(webPreferences?.enableWebSQL).toBe(false);
  });

  it("cannot be talked out of any of them by the caller", () => {
    // Every enforced key, offered as its opposite. `windowOptionsFor` spreads
    // `ENFORCED_WEB_PREFERENCES` last, so none of this reaches the result.
    const weakened = {
      entry: "index.html",
      preload: PRELOAD,
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: true,
      webSecurity: false,
      webviewTag: true,
    } as const;

    const { webPreferences } = windowOptionsFor(weakened);

    for (const key of Object.keys(ENFORCED_WEB_PREFERENCES)) {
      expect(webPreferences?.[key as keyof typeof webPreferences]).toBe(
        ENFORCED_WEB_PREFERENCES[key as keyof typeof ENFORCED_WEB_PREFERENCES],
      );
    }
  });

  it("points the window at the preload script it was given and turns background throttling off", () => {
    const { webPreferences } = windowOptionsFor({ entry: "index.html", preload: PRELOAD });

    expect(webPreferences?.preload).toBe(PRELOAD);
    // A throttled renderer stops rAF entirely, which stops the fixed step rather than pausing it.
    expect(webPreferences?.backgroundThrottling).toBe(false);
  });

  it("opens hidden by default so the first frame is never a white rectangle", () => {
    expect(windowOptionsFor({ entry: "index.html", preload: PRELOAD }).show).toBe(false);
    expect(windowOptionsFor({ entry: "index.html", preload: PRELOAD, show: true }).show).toBe(true);
  });
});

describe("the Content-Security-Policy", () => {
  it("denies everything by default and never allows inline or eval'd script", () => {
    const policy = cspFor();

    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toContain("'unsafe-inline'; script");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows WebAssembly through the narrow token, because the physics extensions need it", () => {
    expect(cspFor()).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(cspFor({ wasm: false })).toContain("script-src 'self';");
    expect(cspFor({ wasm: false })).not.toContain("wasm-unsafe-eval");
  });

  it("allows inline styles, which @ignifx/ui and every template's index.html use", () => {
    expect(cspFor()).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("forbids framing, plugins, form posts, and base-tag rewriting", () => {
    const policy = cspFor();

    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
  });

  it("emits every directive, once, in a stable order", () => {
    const policy = cspFor();
    const names = policy.split("; ").map((part) => part.split(" ")[0] ?? "");

    expect(names).toEqual([...CSP_DIRECTIVE_ORDER]);
    expect(new Set(names).size).toBe(names.length);
    // Byte-identical across calls: the security checklist compares against a literal.
    expect(cspFor()).toBe(defaultCsp());
  });

  it("widens to the dev server, and its websocket, only in development", () => {
    const dev = cspFor({ mode: "development", devServerOrigin: "http://localhost:5173" });

    expect(dev).toContain("http://localhost:5173");
    expect(dev).toContain("ws://localhost:5173");
    // The same origin in production mode is ignored: a packaged build never talks to a dev server.
    expect(cspFor({ mode: "production", devServerOrigin: "http://localhost:5173" })).toBe(defaultCsp());
  });

  it("is chosen from the entry: a dev-server URL gets the development policy", () => {
    expect(isDevServerEntry("http://localhost:5173/")).toBe(true);
    expect(isDevServerEntry("index.html")).toBe(false);

    expect(cspValueFor({ entry: "index.html", preload: PRELOAD })).toBe(defaultCsp());
    expect(cspValueFor({ entry: "http://localhost:5173/", preload: PRELOAD })).toContain("ws://localhost:5173");
    expect(cspValueFor({ entry: "index.html", preload: PRELOAD, csp: null })).toBeNull();
    expect(cspValueFor({ entry: "index.html", preload: PRELOAD, csp: "default-src 'none'" })).toBe(
      "default-src 'none'",
    );
  });
});

describe("the openExternal allow-list", () => {
  it("passes https and mailto", () => {
    expect(isAllowedExternalUrl("https://ignifx.com/docs", DEFAULT_EXTERNAL_PROTOCOLS)).toBe(true);
    expect(isAllowedExternalUrl("mailto:hello@ignifx.com", DEFAULT_EXTERNAL_PROTOCOLS)).toBe(true);
  });

  it("refuses file, javascript, plain http, and every custom scheme", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://ignifx.com",
      "ignifx://app/index.html",
      "vscode://file/etc/passwd",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      expect(isAllowedExternalUrl(url, DEFAULT_EXTERNAL_PROTOCOLS)).toBe(false);
    }
  });

  it("refuses anything that is not a URL at all, rather than guessing", () => {
    // A relative reference has no protocol to check, so it can never be on the list.
    for (const url of ["", "not a url", "//ignifx.com", "/docs/index.html"]) {
      expect(isAllowedExternalUrl(url, DEFAULT_EXTERNAL_PROTOCOLS)).toBe(false);
    }
  });

  it("checks the protocol and nothing else, because the host is the OS browser's problem", () => {
    // `https:/\/evil.example` is normalised by the WHATWG parser to `https://evil.example`, and it
    // is allowed: the list gates *protocols*, and handing an https URL to the user's browser is the
    // whole point of `openExternal`. Guarding hosts would be a different feature with a different
    // failure mode, and pretending this check does it would be worse than not having it.
    expect(isAllowedExternalUrl("https:/\\/evil.example", DEFAULT_EXTERNAL_PROTOCOLS)).toBe(true);
    expect(isAllowedExternalUrl("https://evil.example", DEFAULT_EXTERNAL_PROTOCOLS)).toBe(true);
  });
});

describe("the IPC sender check", () => {
  it("only trusts the game window's own top-level document", () => {
    const origins = allowedSenderOrigins();

    expect(origins).toEqual(["ignifx://app"]);
    expect(isTrustedSender({ origin: "ignifx://app", isMainFrame: true, isGameWindow: true }, origins)).toBe(true);
    // The three ways to be something else.
    expect(isTrustedSender({ origin: "ignifx://app", isMainFrame: false, isGameWindow: true }, origins)).toBe(false);
    expect(isTrustedSender({ origin: "ignifx://app", isMainFrame: true, isGameWindow: false }, origins)).toBe(false);
    expect(isTrustedSender({ origin: "https://evil.example", isMainFrame: true, isGameWindow: true }, origins)).toBe(
      false,
    );
    // A frame that has navigated or been destroyed reports no origin at all.
    expect(isTrustedSender({ origin: null, isMainFrame: true, isGameWindow: true }, origins)).toBe(false);
  });

  it("widens to the dev server only when the entry is one", () => {
    expect(allowedSenderOrigins("index.html")).toEqual(["ignifx://app"]);
    expect(allowedSenderOrigins("http://localhost:5173/")).toEqual(["http://localhost:5173", "ignifx://app"]);
  });
});

describe("the origins the guards compare", () => {
  it("does not collapse every ignifx:// authority to one value, the way URL.origin does", () => {
    // The defect this function exists for: the WHATWG parser has no special handling for `ignifx:`,
    // so both of these have the opaque origin `"null"` and an equality test on it always passes.
    expect(new URL("ignifx://app/index.html").origin).toBe("null");
    expect(new URL("ignifx://evil/index.html").origin).toBe("null");

    expect(originOfUrl("ignifx://app/index.html")).toBe("ignifx://app");
    expect(originOfUrl("ignifx://evil/index.html")).toBe("ignifx://evil");
    expect(originOfUrl("http://localhost:5173/x")).toBe("http://localhost:5173");
  });

  it("returns null for everything with no tuple origin, so a guard refuses rather than guesses", () => {
    for (const url of ["", "not a url", "//ignifx.com", "file:///etc/passwd", "data:text/html,x", "javascript:1"]) {
      expect(originOfUrl(url)).toBeNull();
    }
  });
});

describe("the ignifx:// protocol's path handling", () => {
  const ROOT = "/srv/game/dist";

  it("keeps a request inside the served directory", () => {
    expect(protocolPathFor("ignifx://app/assets/crate.png", ROOT)).toBe("/srv/game/dist/assets/crate.png");
    expect(protocolPathFor("ignifx://app/", ROOT)).toBe("/srv/game/dist/index.html");
  });

  it("refuses a traversal, its encoded spellings, a NUL byte, and a second authority", () => {
    for (const url of [
      "ignifx://app/..%2f..%2fetc/passwd",
      "ignifx://app/%2e%2e%2f%2e%2e%2fetc/passwd",
      "ignifx://app/a/..%5c..%5cetc/passwd",
      "ignifx://app/%00etc/passwd",
      "ignifx://app/%e0%a4%a",
      // Another authority is another Chromium origin serving the same bytes, which would make
      // `'self'` in the policy mean something other than the game.
      "ignifx://evil/index.html",
    ]) {
      expect(() => protocolPathFor(url, ROOT), url).toThrow("IGX-1465");
    }
  });
});

describe("cspFor's remaining switches", () => {
  it("adds a game's own backend origins to connect-src and nothing else", () => {
    const policy = cspFor({ connectSources: ["https://api.example.com"] });

    expect(policy).toContain("connect-src 'self' data: blob: https://api.example.com");
    expect(policy).not.toContain("script-src 'self' 'wasm-unsafe-eval' https://api.example.com");
  });

  it("ignores a dev-server origin whose protocol has no websocket twin", () => {
    const policy = cspFor({ mode: "development", devServerOrigin: "ignifx://app" });

    expect(policy).toContain("ignifx://app");
    expect(policy).not.toContain("ws://");
    expect(policy).not.toContain("wss://");
  });

  it("uses wss for an https dev server", () => {
    expect(cspFor({ mode: "development", devServerOrigin: "https://localhost:5173" })).toContain(
      "wss://localhost:5173",
    );
  });
});
