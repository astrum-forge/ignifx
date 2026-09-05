# benchmarks

Frame time, heap growth and bundle size for the reference scenes, with the numbers committed in
`baselines.json` (`CONSTITUTION.md` §6.4, coding standards §7).

```sh
pnpm bench          # frame time, reported
pnpm bundle-size    # builds examples/hello-cube and gzips it, asserted
pnpm exec vitest run --project node benchmarks   # heap growth + bundle size, asserted
```

## The scenes

| Scene               | What it holds                                                            |
| ------------------- | ------------------------------------------------------------------------ |
| `hello-cube`        | `examples/hello-cube` headless: camera, light, ground, one spinning cube |
| `thousand-entities` | 1,000 entities, each a `MeshRenderer` and a rotating script              |

Both run on `createApp({ headless: true })` with a manual clock, so `app.step(1 / 60)` is one whole
frame of CPU: the fixed loop, every script callback, the component sync systems, and the render-sync
pass on Lite's null engine. GPU time is the browser job's to measure.

## What is asserted and what is reported

**Frame time is reported.** `vitest bench` measures ops/sec on whatever machine runs it, and a
shared CI runner's number says more about the runner than about the engine. The budgets standards §7
asserts are millisecond budgets on a real device. `baselines.json` exists so a human can see whether
a change moved the shape of the curve.

Vitest 5 moved benchmarking behind a test-context fixture — `bench` is not a top-level export any
more; a benchmark is registered inside a `test` in a file matched by `benchmark.include`, and
`bench.compare` runs the registrations. `frame-time.bench.ts` shows the shape.

**Heap growth is asserted**, by `alloc.test.ts`. Each scene runs 600 steps in a child process under
`node --expose-gc`, the heap is settled with four collections before and after, and the delta has to
stay inside the ceiling in `baselines.json`. It is a child process because Vitest 5 has no per-file
way to add a V8 flag, and because `test.skipIf(globalThis.gc === undefined)` would let the gate
vanish silently.

**Bundle size is asserted**, by `bundle-size.test.ts`. It builds `examples/hello-cube`, finds the
chunk `index.html` loads, and gzips it. Lite code-splits hard — this build emits 294 chunks — so the
ceiling is on the _entry_ chunk, which is what a first load fetches, and the sum over every chunk is
recorded beside it so weight moving into a lazy chunk stays visible.

## Measured on 2026-09-06 (macOS arm64, Node 25.2.1)

| Metric                            | Measured  | Ceiling   |
| --------------------------------- | --------- | --------- |
| `hello-cube` frame                | 0.0007 ms | reported  |
| `thousand-entities` frame         | 0.163 ms  | reported  |
| `hello-cube` heap, 600 steps      | 104,088 B | 262,144 B |
| `thousand-entities` heap          | 9,072 B   | 65,536 B  |
| `examples/hello-cube` entry, gzip | 270,551 B | 298,000 B |

The heap numbers are the point of this directory. 1,002 entities kept 9,072 bytes over 600 frames —
the same value on every run — while the four-entity scene kept more, and quadrupling the step count
did not quadruple either figure. Growth that scales with neither entities nor frames is V8's own
bookkeeping, not the engine allocating: the allocation-free-frame rule holds.

The bundle number does **not** meet the plan's Phase 2 target of "core + a minimal Lite scene under
250 KB gzipped". The entry chunk is 270,551 bytes, 20,551 over. The ceiling committed here is the
measurement plus 10%, so the gate guards against regression while the target stays open.

If `alloc.test.ts` fails, that is a finding. Raise the ceiling only in a pull request that says what
now allocates and why it is acceptable.
