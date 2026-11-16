# ADR-0040 · Lighting strategy: foundations first, dynamic GI as a desktop tier

**Status:** Accepted (2026-11-02; the coordinator took the decisions on the owner's authority) · **Date:** 2026-11-02 · **Deciders:** Astrum Forge Studios (owner)

## Context

The owner asked what it would take for ignifx lighting to look like Unreal Engine 5's Lumen, and whether that is possible. The assessment of 2026-10-29 found:

- Most of that look is not global illumination (GI). It comes from HDR rendering, stable shadows, temporal anti-aliasing, physically based bloom and exposure, ambient occlusion and reflections. For static scenes, baked lighting then gets close at almost no run-time cost.
- Lumen parity is out of reach. Lumen leans on hardware ray tracing, bindless resources and a 4–8 ms GPU budget on console-class hardware. WebGPU has neither feature, and the reference machine is an integrated GPU (Apple M1).
- Lite's lighting loop accepts only 2D-texture plugins within a tight sampler budget; soft shadows and area lights need changes in Lite itself (`CONSTITUTION.md` §1.3).

## Options considered

Costs are estimates at 1080p, scaled from published references; none was measured on ignifx.

| Option                                  | Result                                         | Mid-range desktop | Integrated GPU | Phones  |
| --------------------------------------- | ---------------------------------------------- | ----------------- | -------------- | ------- |
| Foundations                             | HDR, stable shadows, TAA, AO, bloom, exposure  | 2–3 ms            | 5–8 ms         | partial |
| A. Screen-space GI                      | one on-screen bounce, screen-space reflections | 2.5–4 ms          | 8–12 ms        | AO only |
| B. Probe volume GI against a global SDF | dynamic diffuse GI for static geometry         | 1.5–3 ms          | 4–8 ms         | no      |
| C. Radiance cascades                    | proven in 2D; research-grade in 3D             | unknown           | unknown        | no      |
| D. A Lumen-faithful port                | closest to Unreal                              | 8–15 ms           | 16–30 ms       | no      |
| E. Baked lightmaps and probes           | best static quality                            | under 0.3 ms      | under 0.3 ms   | yes     |

## Decision

1. **Target devices.** Dynamic GI (option B and anything beyond it) is a desktop quality tier. Phones and integrated GPUs get baked lighting and ambient occlusion.
2. **Order.** The foundations come first. Nothing was decided about what follows them.
3. **Upstream.** Changes Lite needs are filed as issues on the Lite repository; ignifx does not fork it.
4. **Editor scope.** The lightmap baker waits for editor 0.8 or later.
5. **Static-world rule.** Dynamic GI covers static geometry. Moving objects receive light but do not bounce it.
6. **GPU budget.** A GPU budget per quality tier is written with the foundations (coding standards §7).

## Consequences

- The foundations and the run-time half of baked lighting are implemented: `docs/architecture/07-rendering.md` §2.7 and §2.12–§2.15. The engine bakes light probes; it does not bake lightmaps.
- The lightmap baker (a UV2 unwrap and a GPU path tracer) is editor work. An unwrap library is a new dependency and needs its own ADR (`CONSTITUTION.md` §9.3).
- Dynamic diffuse GI (option B) is a candidate for after 1.0, not a commitment. The assessment sketched it as an extension package: a signed-distance or voxel volume built from static meshes; a compute pass that traces rays from a subset of probes each frame and writes octahedral irradiance and visibility into a 2D atlas; a PBR plugin that samples the atlas in place of the global diffuse term; screen-space reflections for specular. Known risks: light leaking through thin walls, memory on large worlds, and a possible Lite change to drop the built-in diffuse term.
- The assessment proposed a review in 2027: screen probes and a radiance cache on top of B, or hardware ray tracing if WebGPU ships it.
- The assessment recommended radiance cascades as the route for 2D lighting, after 1.0; that is not decided either.
- Open items are listed in `docs/plan/engineering-plan.md`.
