---
"@ignifx/editor-host": minor
---

The editor can now read an entity of a running game: the play view answers `queryRuntime { entity, components? }` with the entity as the scene format writes it from the live world (at most 64 components, long strings and lists clipped), and lists `queryRuntime` in its capabilities. It refuses an unknown uid with the new `RpcErrorCode.unknownEntity`, and a stopped game with `notPlaying`; a paused or stepped game answers.
