# ADR-0011 · Left-handed, Y-up, +Z forward; metres, seconds, degrees

**Status:** Accepted · **Date:** 2026-09-05

## Context

Babylon Lite is left-handed (matching Babylon.js and its glTF loader conventions); Unity is left-handed, Y up, +Z forward; Godot is right-handed. Lite works in milliseconds; Unity in seconds.

## Decision

- 3D: left-handed, Y up, +Z forward, identical to Lite and Unity; quaternions internally, Euler degrees in public component APIs.
- 2D: Y up, X right, rotation counter-clockwise in degrees; pixels-per-unit converts to Lite's Y-down pixel layers.
- Units: metres and seconds in all public APIs; `Ms`/`Px`/`Rad` suffixes mark exceptions.

## Consequences

- No handedness conversion between ignifx and Lite; glTF assets load as Lite loads them.
- Godot users must adapt to Y-up 2D; the skill calls this out.
