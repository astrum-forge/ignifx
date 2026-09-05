# ADR-0004 · Schema-driven serialization through `Component.define`; no decorators

**Status:** Accepted · **Date:** 2026-09-05

## Context
Components need serializable, inspectable, validated fields (`CONSTITUTION.md` §3.7). Unity uses attributes/reflection; Cocos and Needle use decorators. In 2026 the Vite 8/Oxc pipeline does not lower TC39 decorators, their native shipping status is unverified, and Node's type stripping cannot run them; `erasableSyntaxOnly` is part of the standards.

## Options considered
1. **Decorators (`@field()`)** — familiar. Cons: toolchain and runtime uncertainty; hidden metadata; harder for agents to read statically without running.
2. **Static `schema` + `declare` fields** — explicit. Cons: names duplicated between schema and fields; drift.
3. **`Script.define(fields)` / `Component.define(fields)`** returning a typed base class — one source of truth, typed properties, defaults applied automatically, plain TypeScript.

## Decision
Option 3. Serialized fields are declared once through a schema object; the base class exposes them as typed properties and attaches the schema for the serializer, the inspector, JSON Schema generation, and the docs harness. `typeId` is explicit and namespaced.

## Consequences
- No decorator support in the core; a decorator sugar layer could be an extension later without changing files.
- Schemas double as inspector metadata and validation; agents can read a component's fields without executing code.
- Non-serialized state is a normal class field; a lint rule prevents shadowing schema names.
