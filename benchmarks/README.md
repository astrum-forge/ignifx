# benchmarks

Frame time, heap growth and bundle size for the reference scenes. The numbers, with the machine and
date of each, are committed in `baselines.json` (`CONSTITUTION.md` §6.4, coding standards §7); this
file does not repeat them.

```sh
pnpm bench          # frame time of hello-cube and thousand-entities, reported
pnpm bundle-size    # builds examples/hello-cube and the templates and gzips them, asserted
pnpm test:perf      # heap growth, bundle size and the devtools-closed comparison, asserted
pnpm test           # includes the two tests that check recorded rows against their budgets
```

## The scenes

| Scene (`scenes/`)   | What it holds                                                            |
| ------------------- | ------------------------------------------------------------------------ |
| `hello-cube`        | `examples/hello-cube` headless: camera, light, ground, one spinning cube |
| `thousand-entities` | 1,000 entities, each a `MeshRenderer` and a rotating script              |
| `instancing-20k`    | 20,000 instances on one `InstancedMeshRenderer`                          |
| `particles-10k`     | A particle system with 10,000 live particles                             |
| `terrain-512`       | A 513 × 513 height field in 64 chunks, each with four levels of detail   |

They run on `createApp({ headless: true })` with a manual clock, so `app.step(1 / 60)` is one whole
frame of CPU: the fixed loop, every script callback, the component sync systems, and the render-sync
pass on Lite's null engine. GPU time is measured by `pnpm test:gpu-budget` (`tests/visual/README.md`).

## What is asserted and what is reported

**Frame time is reported** (`frame-time.bench.ts`). `vitest bench` measures ops/sec on whatever
machine runs it, and a shared CI runner's number says more about the runner than about the engine.
The budgets standards §7 asserts are millisecond budgets on a real device. `baselines.json` exists
so a human can see whether a change moved the shape of the curve.

In Vitest 5 `bench` is not a top-level export: a benchmark is registered inside a `test` in a file
matched by `benchmark.include`, and `bench.compare` runs the registrations. `frame-time.bench.ts`
shows the shape.

**Heap growth is asserted**, by `alloc.test.ts`. Each scene runs 600 steps in a child process under
`node --expose-gc`, the heap is settled with repeated collections before and after, and the delta has to
stay inside the ceiling in `baselines.json`. It is a child process because Vitest 5 has no per-file
way to add a V8 flag, and because `test.skipIf(globalThis.gc === undefined)` would let the gate
vanish silently. Growth that scales with neither entities nor frames is V8's own bookkeeping, not
the engine allocating.

**Bundle size is asserted**, by `bundle-size.test.ts`. It builds `examples/hello-cube` and the four
templates, finds the chunk each `index.html` loads, and gzips it. Lite code-splits hard, so the
ceiling is on the _entry_ chunk, which is what a first load fetches, and the sum over every chunk
is recorded beside it so weight moving into a lazy chunk stays visible. Each ceiling is its
measurement plus 10%. The templates have their own ceilings because their backend payloads differ:
a 2D template carries Rapier's inlined WebAssembly. The `hello-cube` entry chunk is above the
250,000-byte target for core plus a minimal Lite scene; the gate guards against regression while
that target stays open (`docs/plan/engineering-plan.md`).

**An unopened devtools overlay is asserted to cost nothing measurable**, by
`devtools-closed.test.ts`, which compares live frame time with and without the extension registered.

These three are in the `perf` Vitest project (`vitest.config.ts`), because they assert on wall-clock
time or heap.

**Recorded rows are checked against their budgets** in the `node` project, without re-measuring:
`template-frame-time.test.ts` holds the templates' frame-time and GPU-time rows to the standards §7
budgets (the live measurements are `pnpm test:frame-budget` and `pnpm test:gpu-budget`), and
`two-d-baselines.test.ts` does the same for the recorded 2D sprite-sync and pixel-perfect results.

If `alloc.test.ts` fails, that is a finding. Raise the ceiling only in a pull request that says what
now allocates and why it is acceptable.
