# ADR-0010 · Frame-sequenced logic uses generator coroutines, not async/await

**Status:** Accepted · **Date:** 2026-09-05

## Context
Unity coroutines resume at defined points of the frame. JavaScript promise continuations run as microtasks after the current callback stack unwinds, i.e. after the entire ignifx frame function, outside any phase, making ordering non-deterministic relative to other scripts.

## Options considered
1. **`async` lifecycle methods and `await app.nextFrame()`** — familiar. Cons: continuations execute between frames, not inside `Update`; unhandled-rejection semantics; cannot be paused deterministically.
2. **Generator coroutines resumed by the scheduler** (`yield waitSeconds(1)`) — synchronous, deterministic, pausable, cancellable.

## Decision
Option 2 for gameplay sequencing; `async`/`await` remains the right tool for I/O (assets, storage, network), and a coroutine may `yield` a promise to bridge the two. `async` lifecycle callbacks are lint errors.

## Consequences
- Slight learning curve for developers used to `async`; the skill documents the pattern with examples.
- Coroutine bookkeeping is per script; state is paused with the script and cancelled on destroy.
