---
name: electron
description: Ships an ignifx game as an Electron desktop app with @ignifx/electron: the main-process window factory that enables WebGPU, a typed and sandboxed preload bridge, the ignifx:// asset protocol, the file-system storage backend, and the renderer-side extension that exposes app.desktop. Use when packaging, configuring, or debugging an ignifx desktop build, or when the user mentions @ignifx/electron, createGameWindow, the preload bridge, or desktop templates.
license: Apache-2.0
metadata:
  ignifx-version: "0.0.0-unreleased"
---

# @ignifx/electron

> **Scaffold notice.** ignifx is in the planning phase and `@ignifx/electron` is an empty package. Every section below is filled by Phase 9 of `docs/plan/engineering-plan.md`; until then this file makes no API claims (`CONSTITUTION.md` Article V).

## What this is / when to use

`@ignifx/electron` is the ignifx extension that provides the main-process window factory with WebGPU flags, the typed preload bridge, and the file-system storage backend _(populated in Phase 9)_.

## Environment

Engine version, the pinned Babylon Lite version, and the registration snippet for this extension _(populated in Phase 9)_.

## Mental model

How this subsystem's components, services, and phases fit into the App → World → Entity model _(populated in Phase 9)_.

## First app

A complete, compiling example that registers the extension and uses it once _(populated in Phase 9)_.

## Core APIs

Component and service tables generated from `skills/ignifx/references/api/electron.md` _(populated in Phase 9)_.

## Recipes

Task-oriented examples extracted from `examples/recipes/` _(populated in Phase 9)_.

## File formats

The file formats this subsystem reads and writes, with links to `skills/ignifx/references/formats/` _(populated in Phase 9)_.

## Gotchas

The traps this subsystem has, each with the replacement to use instead _(populated in Phase 9)_.

## Deprecated (current window)

None (pre-1.0: no deprecation window; breaking changes are listed in the changelog).

## Where to look next

`skills/ignifx/SKILL.md` for the engine entry skill · `docs/architecture/` for design rationale.
