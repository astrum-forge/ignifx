# ADR-0006 · 2D physics backend

**Status:** Accepted · **Date:** 2026-09-05 · **Validated:** 2026-09-06 (Phase 6 spike S6.2), amended 2026-09-08 (sensor filtering, see Validation below)

## Context

Lite ships Havok (3D). 2D games (platformers, top-down) need 2D bodies, one-way platforms, tile collision, and a kinematic character controller with slopes and step handling. `CONSTITUTION.md` §3.10 requires 2D to be first-class.

## Options considered

1. **Havok 3D constrained to a plane** — one physics engine. Cons: no linear-axis locks in Lite's API, drift correction hacks, no 2D-specific features (one-way platforms, edge chains), heavier.
2. **Rapier 2D (`@dimforge/rapier2d-compat` 0.20, Apache-2.0)** — deterministic across platforms, WASM, TypeScript bindings, built-in kinematic character controller (autostep, slopes, snap-to-ground), sensors, joints, active community.
3. **Box2D v3 WASM (`box2d3-wasm` 5.x, MIT)** — excellent solver. Cons: thinner TS bindings, no built-in character controller, single-maintainer port.
4. **Custom AABB/tile collision only** — tiny. Cons: no rigid bodies; users outgrow it quickly.

## Decision

Rapier 2D behind `@ignifx/physics-2d`, following the stepping model of `docs/architecture/09-physics.md` §1. The Phase 6 spike validates bundle size (inline-WASM `-compat` vs. Vite-served `.wasm`), determinism, and controller behaviour before the API is frozen.

## Consequences

- Two physics WASM modules exist in the ecosystem, but a given game loads only one.
- Both extensions expose the same component vocabulary (`Rigidbody`/`Rigidbody2D`, colliders, `CharacterController`/`CharacterController2D`), so the Agent Skill can document them side by side.
- If the spike fails, option 3 is the fallback with the same public API.

## Validation (2026-09-06)

Phase 6 spike S6.2, measured against `@dimforge/rapier2d-compat@0.20.0` on macOS arm64, Node 24.
**The decision stands: Rapier 2D, on the `-compat` build.** Box2D v3 is not needed.

### Bundle size — `-compat` (inline WebAssembly) stays the default

A Vite 8 production build of a two-line fixture app, once without Rapier and once with it, minified
with oxc:

| Build                                 | Raw             | Gzipped       |
| ------------------------------------- | --------------- | ------------- |
| Fixture alone                         | 85 B            | 111 B         |
| Fixture + `@dimforge/rapier2d-compat` | 2,115,219 B     | 794,615 B     |
| **Contribution of `-compat`**         | **2,115,134 B** | **794,504 B** |

The served-`.wasm` variant, estimated from the registry tarball of `@dimforge/rapier2d@0.20.0`
(`npm view @dimforge/rapier2d dist.tarball`): the binary is the same 1,486,188 B file, 554,508 B
gzipped, and the JavaScript glue is 673,586 B raw / 88,508 B gzipped unminified — so about
643 KB gzipped in total, split into a small chunk plus a `.wasm` fetched in parallel.

`-compat` therefore costs roughly **148 KB gzipped** more than serving the binary. That is well
inside the 300 KB threshold the plan set for switching, so the package ships `-compat`: one
dependency, no public-asset plumbing, and the same code path in Node, the browser, and Electron.
Serving the `.wasm` through the Vite plugin's extension public assets remains a Phase 12 option if
the number moves.

### Determinism — locally yes, cross-platform **no**

Two worlds built from the same scene and stepped 600 times are bit-identical, and the ignifx
determinism suite reproduces a committed FNV-1a hash of twelve settled bodies (`5718c5f0`) across
two apps in one process, interleaved or not, and across separate process runs.

The context section's claim that Rapier 2D is "deterministic across platforms" is **wrong for this
package**. `@dimforge/rapier2d-compat` is Rapier's _main_ build; its README states that it "does
**not** guarantee cross-platform determinism of the physics simulation (but it is still locally
deterministic, on the same machine)". The `enhanced-determinism` feature ships as a separate npm
package, `@dimforge/rapier2d-deterministic` / `-deterministic-compat`, described as "a less
optimized build but with a guarantee of a cross-platform deterministic execution". Switching is a
one-line dependency change with no API change, and is the answer if lockstep networking ever needs
it. `docs/architecture/11-2d-toolkit.md` §8 has been corrected to match.

### Character controller — everything works, with one measured limit

`world.createCharacterController(offset)` plus `setUp`, `setMaxSlopeClimbAngle`,
`setMinSlopeSlideAngle`, `enableAutostep`, `enableSnapToGround`, `computeColliderMovement`,
`computedMovement` and `computedGrounded` behave as documented:

- **Slopes.** With `maxSlopeClimbAngle` 45°, a character walks a 30° ramp and is stopped dead at the
  foot of a 60° one; raising the limit to 75° lets it climb the 60° ramp.
- **Snap-to-ground.** Descending a 25° ramp at 4 m/s, `enableSnapToGround(0.5)` kept the character
  grounded on every one of 200 steps; without it, 66 steps were airborne.
- **One-way platforms.** The `filterPredicate` argument of `computeColliderMovement` is the
  mechanism: returning `false` for a platform makes the character pass straight through it, so a
  one-way platform is "ignore this collider unless the character is moving down and its feet already
  cleared the top". No sensor or solver hook is needed.
- **Autostep needs a box.** With a box character, `enableAutostep(0.35, 0.05, true)` clears a 0.3 m
  step and refuses a 0.5 m one; with a capsule of radius 0.2 the same call clears 0.15 m but not
  0.2 m, and no combination of `minWidth`, `maxHeight`, `offset` or capsule height changed that.
  `CharacterController2D` therefore gained a `shape` field (`"capsule" | "box"`, default
  `"capsule"`), and the skill documents that `stepOffset` needs `shape: "box"`.

### Sensors are obstacles to the character controller (measured 2026-09-08)

`KinematicCharacterController.computeColliderMovement(collider, delta, filterFlags, filterGroups,
filterPredicate)` takes `filterFlags` as its **third** argument, and the adapter used to pass
`undefined` there. Measured against `@dimforge/rapier2d-compat@0.20.0` on macOS arm64, Node 24: a
kinematic box driven by the controller towards a static sensor ball stops dead at the sensor's
surface (`x = 0.49` for a sensor at `x = 1` with radius 0.3, a 0.2 half-width character and a 0.01
offset) and, because it never overlaps the sensor, `drainCollisionEvents` reports nothing at all.
With `QueryFilterFlags.EXCLUDE_SENSORS` (value `8`) as `filterFlags`, the same character walks
through to `x = 3.0` and the queue reports the `started`/`stopped` pair.

Sensors are regions of space, not geometry, so the adapter now passes `EXCLUDE_SENSORS` on every
controller move. This is what makes a collectible work: the templates author a coin as a
`CircleCollider2D { isTrigger: true }` on an entity with no rigidbody, and a `CharacterController2D`
player could neither reach it nor raise `onTriggerEnter` on it. Sensors correspondingly no longer
appear in `CharacterController2D.onCollided`, which is right — a trigger is not an obstacle.

### Two further Rapier facts the adapter is built around

- **The broadphase only exists after `World.step`.** Before the first step, `castRay` returns `null`
  and `computeColliderMovement` reports the requested motion with no obstacles at all; a collider
  created since the last step is invisible until the next one. A zero-length step rebuilds the
  structure without integrating, but it is not free of side effects on a running simulation (a
  settled pile hashes differently), so the runtime primes only when the collider set changed, and
  queries before the first fixed step report `IGX-1153`.
- **The move filter must not call back into Rapier.** `filterPredicate` runs inside WebAssembly.
  Calling Rapier from it — `collider.translation()`, say — is a re-entrant call: the obstacle is then
  _not_ excluded even though the predicate returned `false`, and the world's WebAssembly state is
  left corrupted (`world.free()` afterwards throws "attempted to take ownership of Rust value while
  it was borrowed"). The runtime caches every one-way platform's world top before the move instead.

### Consequence for the API

- `InteractionGroups` is one 32-bit word — membership in the high 16 bits, filter in the low 16 —
  so only sixteen layers can be filtered by. A collider above them reports `IGX-1152` and falls back
  to layer 0.
- `ActiveCollisionTypes.DEFAULT` covers dynamic-versus-anything only, so colliders that want events
  are given `ActiveCollisionTypes.ALL`; without it a kinematic character never reports entering a
  static sensor.
