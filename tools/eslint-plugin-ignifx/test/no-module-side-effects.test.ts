import { noModuleSideEffects } from "../src/rules/no-module-side-effects.ts";
import { createRuleTester } from "./rule-tester.ts";

const ruleTester = createRuleTester();
const SRC = "packages/core/src/lite/headless.ts";

ruleTester.run("no-module-side-effects", noModuleSideEffects, {
  valid: [
    { code: "const MILLISECONDS_PER_SECOND = 1000;\nexport { MILLISECONDS_PER_SECOND };", filename: SRC },
    {
      code: "export interface A { a: number }\nexport type B = A;\nexport class C {}\nexport function d(): void {}",
      filename: SRC,
    },
    { code: "const KINDS = { a: 1, b: 2 } as const;\nexport { KINDS };", filename: SRC },
    { code: "const TAG = Symbol('ignifx');\nconst KEY = Symbol.for('ignifx');\nexport { TAG, KEY };", filename: SRC },
    { code: "export const FROZEN = Object.freeze({ a: 1 });", filename: SRC },
    { code: "export const IDENTITY = new Float32Array([1, 0, 0, 1]);", filename: SRC },
    { code: "export const EXT = defineExtension({ name: 'x' });", filename: SRC },
    { code: "export const make = (): number => compute();", filename: SRC },
    { code: "export class Mover extends Script.define({ speed: f32(5) }) {}", filename: SRC },
    { code: "let cache = null;\nexport function get(): unknown { cache ??= new Map(); return cache; }", filename: SRC },
    // Outside `src/`, and in the excluded file kinds, the rule does not apply.
    { code: "register();", filename: "packages/core/test/app.test.ts" },
    { code: "run();", filename: "packages/cli/src/bin.ts" },
    { code: "main();", filename: "scripts/docs-harness.ts" },
    { code: "document.body.append(canvas);", filename: "packages/core/src/lite/headless.browser.test.ts" },
    { code: "register();", filename: SRC, options: [{ include: ["**/nowhere/**"] }] },
    { code: "createThing();", filename: SRC, options: [{ allowCallees: ["createThing"] }] },
    { code: "export default defineConfig({ a: 1 });", filename: SRC },
    { code: "export const literal = { a: 1 };", filename: SRC },
    { code: "register();", filename: "packages/core/src/a-b.ts", options: [{ exclude: ["**/a?b.ts"] }] },
  ],
  invalid: [
    { code: "register();", filename: SRC, errors: [{ messageId: "sideEffectStatement" }] },
    { code: "globalThis.ignifx = {};", filename: SRC, errors: [{ messageId: "sideEffectStatement" }] },
    { code: "export const cache = new Map();", filename: SRC, errors: [{ messageId: "sideEffectInitializer" }] },
    {
      code: "const seen = new WeakSet();\nexport { seen };",
      filename: SRC,
      errors: [{ messageId: "sideEffectInitializer" }],
    },
    { code: "export const value = compute();", filename: SRC, errors: [{ messageId: "sideEffectInitializer" }] },
    {
      code: "export const wrapped = Object.freeze({ made: create() });",
      filename: SRC,
      errors: [{ messageId: "sideEffectInitializer" }],
    },
    { code: "export const value = await load();", filename: SRC, errors: [{ messageId: "topLevelAwait" }] },
    { code: "await load();", filename: SRC, errors: [{ messageId: "topLevelAwait" }] },
    { code: "if (globalThis.debug) { enable(); }", filename: SRC, errors: [{ messageId: "controlFlowStatement" }] },
    {
      code: "for (const kind of kinds) { register(kind); }",
      filename: SRC,
      errors: [{ messageId: "controlFlowStatement" }],
    },
    { code: "try { register(); } catch { }", filename: SRC, errors: [{ messageId: "controlFlowStatement" }] },
    {
      code: "export const a = first();\nexport const b = second();",
      filename: SRC,
      errors: [{ messageId: "sideEffectInitializer" }, { messageId: "sideEffectInitializer" }],
    },
    {
      code: "export const EXT = defineExtension({ name: 'x' });",
      filename: SRC,
      options: [{ allowCallees: [] }],
      errors: [{ messageId: "sideEffectInitializer" }],
    },
    {
      code: "register();",
      filename: "packages/core/test/app.test.ts",
      options: [{ include: ["**/test/**"], exclude: [] }],
      errors: [{ messageId: "sideEffectStatement" }],
    },
    { code: "export default compute();", filename: SRC, errors: [{ messageId: "sideEffectInitializer" }] },
    { code: "export const first = fns[0]();", filename: SRC, errors: [{ messageId: "sideEffectInitializer" }] },
    { code: "export const deep = a[b].c();", filename: SRC, errors: [{ messageId: "sideEffectInitializer" }] },
    {
      code: "export const tagged = new (kinds.get(id))();",
      filename: SRC,
      errors: [{ messageId: "sideEffectInitializer" }],
    },
  ],
});
