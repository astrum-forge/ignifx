# ADR-0008 · Game UI is HTML over the canvas; world text uses Lite text

**Status:** Accepted · **Date:** 2026-09-05

## Context
Lite has no GUI system. Options are a canvas-drawn retained-mode GUI (like Babylon GUI or Unity uGUI) or DOM overlays. ignifx targets browsers and Electron only.

## Options considered
1. **Build a canvas GUI** — full control, works inside render textures. Cons: months of work (layout, text, input, accessibility), always behind HTML.
2. **DOM overlay host + helpers, world text via Lite** — leverages CSS layout, fonts, accessibility, any UI framework; Electron supports it identically. Cons: DOM cannot be rendered into textures; compositing over the canvas has a small cost.

## Decision
Option 2. `@ignifx/ui` provides the overlay host, focus routing into the input system, world↔DOM anchors, and Lite-based `WorldText`/`HudText`. No retained-mode canvas GUI is planned.

## Consequences
- UI code is portable web code; templates may pick any framework.
- In-texture UI (e.g. on a 3D screen) uses sprite/text layers directly.
- Screenshots via Lite exclude DOM UI; a `captureCompositeScreenshot` helper (DOM + canvas via `html2canvas`-style rendering) is a post-1.0 nicety.
