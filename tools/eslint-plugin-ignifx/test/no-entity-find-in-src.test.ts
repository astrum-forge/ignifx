import { noEntityFindInSrc } from "../src/rules/no-entity-find-in-src.ts";
import { createRuleTester } from "./rule-tester.ts";

const ruleTester = createRuleTester();
const SRC = "packages/core/src/world/world.ts";

ruleTester.run("no-entity-find-in-src", noEntityFindInSrc, {
  valid: [
    { code: "export function f(xs: number[]): number | undefined { return xs.find((x) => x > 1); }", filename: SRC },
    { code: "export function f(e: Entity, p: string): Entity | null { return e.find(p); }", filename: SRC },
    { code: "export function f(e: Entity): Entity | null { return e.findChild(isArm); }", filename: SRC },
    { code: "const arm = entity.find('Body/Arm.L');", filename: "packages/core/test/scene-graph.test.ts" },
    { code: "const arm = entity.find('Body/Arm.L');", filename: "packages/core/test/picking.browser.test.ts" },
    { code: "const arm = entity.find('Body/Arm.L');", filename: "examples/platformer/src/main.ts" },
    { code: "const arm = entity.find('Body/Arm.L');", filename: "tools/inspector/src/probe.ts" },
    { code: "const arm = entity.find('Body/Arm.L');", filename: "scripts/lib/scene-report.ts" },
    { code: "const arm = entity.find('Body/Arm.L');", filename: "templates/2d-top-down/game/main.ts" },
    { code: "const arm = entity.find('Body/Arm.L');", filename: SRC, options: [{ exclude: ["**/src/**"] }] },
    { code: "export function f(): Entity | null { return find('Body'); }", filename: SRC },
    { code: "export function f(e: Entity): Entity | null { return e.find(); }", filename: SRC },
    { code: "export function f(e: Entity): Entity | null { return e[key]('Body'); }", filename: SRC },
  ],
  invalid: [
    {
      code: "export function f(e: Entity): Entity | null { return e.find('Body/Arm.L'); }",
      filename: SRC,
      errors: [{ messageId: "entityFind" }],
    },
    {
      code: "export function f(e: Entity): Entity | null { return e.find(`Body/Arm.L`); }",
      filename: SRC,
      errors: [{ messageId: "entityFind" }],
    },
    {
      code: "export function f(e: Entity, n: string): Entity | null { return e.find(`Body/${n}`); }",
      filename: SRC,
      errors: [{ messageId: "entityFind" }],
    },
    {
      code: "export function f(w: World): Entity | null { return w.root.find('../Sibling'); }",
      filename: "packages/2d/src/tilemap/tilemap.ts",
      errors: [{ messageId: "entityFind" }],
    },
    {
      code: "export function f(e: Entity): void { e.find('A'); e.find('B'); }",
      filename: SRC,
      errors: [{ messageId: "entityFind" }, { messageId: "entityFind" }],
    },
    {
      code: "export function f(e: Entity): Entity | null { return e['find']('Body'); }",
      filename: SRC,
      errors: [{ messageId: "entityFind" }],
    },
    {
      code: "const arm = entity.find('Body/Arm.L');",
      filename: "packages/core/test/scene-graph.test.ts",
      options: [{ include: ["**/test/**"], exclude: [] }],
      errors: [{ messageId: "entityFind" }],
    },
  ],
});
