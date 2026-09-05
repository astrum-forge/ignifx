import { noAsyncLifecycle } from "../src/rules/no-async-lifecycle.ts";
import { createRuleTester } from "./rule-tester.ts";

const ruleTester = createRuleTester();

ruleTester.run("no-async-lifecycle", noAsyncLifecycle, {
  valid: [
    "class Mover extends Script { update(dt: number): void { this.step(dt); } }",
    "class Mover extends Script { async loadLevel(): Promise<void> { await fetch('/level'); } }",
    "class Mover extends Script { *walk(): Coroutine { yield waitSeconds(1); } }",
    "class Mover extends Script { awake(): void {} onEnable(): void {} onDestroy(): void {} }",
    "class Mover extends Script { update = (dt: number): void => { this.step(dt); }; }",
    "class Mover extends Script { update: number = 0; }",
    "const handlers = { async update() { await tick(); } };",
    "class AppImpl implements App { async start(): Promise<void> { await this.host.start(); } }",
    "class Scheduler { update(dt: number): Promise<void> { return this.tick(dt); } }",
    "class Mover extends Other { async update(dt: number) { await load(); } }",
    "abstract class Base extends Script { abstract update(dt: number): void; }",
    "class Mover extends Script { start(): void { void this.load(); } private async load(): Promise<void> {} }",
    {
      code: "class Mover extends Script { async tick(): Promise<void> { await x(); } }",
      options: [{ extraCallbacks: ["other"] }],
    },
  ],
  invalid: [
    {
      code: "class Mover extends Script { async awake(): Promise<void> { await load(); } }",
      errors: [{ messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover extends Script.define({ speed: f32(1) }) { async update(dt: number) { await load(); } }",
      errors: [{ messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover { static typeId = 'demo/Mover'; async update(dt: number) { await load(); } }",
      errors: [{ messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover extends Behaviour { async update(dt: number) { await load(); } }",
      options: [{ baseClasses: ["Behaviour"] }],
      errors: [{ messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover extends Script { async update(dt: number) { await load(); } }",
      errors: [{ messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover extends Script { async onCollisionEnter(c: Collision) { await log(c); } }",
      errors: [{ messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover extends Script { update = async (dt: number): Promise<void> => { await load(); }; }",
      errors: [{ messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover extends Script { onDestroy = async function () { await flush(); }; }",
      errors: [{ messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover extends Script { start(): Promise<void> { return load(); } }",
      errors: [{ messageId: "promiseLifecycle" }],
    },
    {
      code: "abstract class Base extends Script { abstract lateUpdate(dt: number): Promise<void>; }",
      errors: [{ messageId: "promiseLifecycle" }],
    },
    {
      code: "class Mover extends Script { async onHotReload() {} async onDetach() {} }",
      errors: [{ messageId: "asyncLifecycle" }, { messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover extends Script { async tick(): Promise<void> { await x(); } }",
      options: [{ extraCallbacks: ["tick"] }],
      errors: [{ messageId: "asyncLifecycle" }],
    },
    {
      code: "class Mover extends Script { async ['update'](dt: number) { await load(); } }",
      errors: [{ messageId: "asyncLifecycle" }],
    },
  ],
});
