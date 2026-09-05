#!/usr/bin/env node
// Prints whether the current environment exposes WebGPU, plus the supported browser matrix and the
// Chromium flags headless testing needs. Informational only: it always exits 0.
// Node ESM, no dependencies (docs/architecture/16-docs-harness-and-skill.md §1).

import process from "node:process";

const USAGE = `Usage: node check-webgpu.mjs [--help]

Reports WebGPU availability for the environment this script runs in, the browsers ignifx supports,
and the Chromium flags used for headless WebGPU tests. Always exits 0.`;

/** Browsers ignifx supports (docs/architecture/14-platform-electron.md §6). */
const MATRIX = [
  ["Chrome / Edge 113+ (desktop)", "Supported"],
  ["Safari 26+ (macOS 26, iOS/iPadOS 26)", "Supported"],
  ["Firefox 141+ Windows, 145+ macOS Apple Silicon", "Supported; Linux/Android pending upstream"],
  ["Chrome Android 121+ (Android 12+, Qualcomm/ARM)", "Supported, reduced budgets"],
  ["Electron 44+ (current stable)", "Supported with the flags below; Linux best-effort"],
  ["Node 24 LTS (headless)", "Supported — no WebGPU, use createApp({ headless: true })"],
];

/** Chromium flags measured in ADR-0009 §"WebGPU flags (S0.1)". */
const FLAGS = [
  [
    "--enable-unsafe-webgpu",
    "required for Playwright's bundled headless shell; without it navigator.gpu hands out no adapter",
  ],
  ["--use-webgpu-adapter=swiftshader", "pins the software adapter so results do not depend on the host GPU"],
  [
    "--enable-features=Vulkan --use-angle=vulkan",
    "Linux only, for a hardware adapter; these two BREAK WebGPU on macOS",
  ],
];

/**
 * Describes the WebGPU capability of the current runtime.
 * @returns An `available` flag and a `detail` sentence for this environment.
 */
function probe() {
  if (globalThis.navigator !== undefined && globalThis.navigator.gpu !== undefined) {
    return {
      available: true,
      detail:
        "`navigator.gpu` exists. An adapter is still not guaranteed — WebGPU needs a secure context\n" +
        "  (https, or http://127.0.0.1/localhost) and, in headless Chromium, the flags below.\n" +
        "  ignifx checks for a real adapter inside `createApp` and rejects with IGX-0701 when there is none.",
    };
  }
  if (isNode()) {
    return {
      available: false,
      detail:
        "Node has no WebGPU implementation (its global `navigator` carries no `gpu`), which is why\n" +
        "  ignifx ships a headless mode on Babylon Lite's null engine. Run\n" +
        "  `createApp({ headless: true })` and drive frames with `app.step(dt)`; nothing renders,\n" +
        "  and the simulation is deterministic. Use `pnpm test:browser` for GPU-touching code.",
    };
  }
  return {
    available: false,
    detail: "`navigator.gpu` is missing: this runtime has no WebGPU, so ignifx cannot render here.",
  };
}

/**
 * Reports whether this is a Node process rather than a browser page.
 * @returns True under Node.
 */
function isNode() {
  return process.versions !== undefined && process.versions.node !== undefined;
}

/**
 * Writes a two-column block.
 * @param title - Section heading.
 * @param rows - The rows to print.
 */
function table(title, rows) {
  const width = Math.max(...rows.map(([left]) => left.length));
  process.stdout.write(`\n${title}\n`);
  for (const [left, right] of rows) {
    process.stdout.write(`  ${left.padEnd(width)}  ${right}\n`);
  }
}

const flags = new Set(process.argv.slice(2));

if (flags.has("--help") || flags.has("-h")) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const runtime = isNode() ? `Node ${process.version}` : "browser-like runtime";
const result = probe();

process.stdout.write(
  `ignifx WebGPU check\n\nRuntime:   ${runtime}\nWebGPU:    ${result.available ? "yes" : "no"}\n  ${result.detail}\n`,
);
process.stdout.write("\n  In code: `isWebGpuAvailable()` from @ignifx/core performs the same probe.\n");
table("Supported browsers (docs/architecture/14-platform-electron.md §6)", MATRIX);
table("Chromium flags for headless WebGPU tests (ADR-0009)", FLAGS);
process.stdout.write("\nWebGPU also needs a secure context: no adapter is handed out on about:blank.\n");
process.exit(0);
