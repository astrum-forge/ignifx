import { noEntityFindInSrc } from "../src/rules/no-entity-find-in-src.ts";
import { createRuleTester } from "./rule-tester.ts";

const ruleTester = createRuleTester();
const SRC = "packages/core/src/world/world.ts";

/** A game script inside a template — the case `**\/scripts\/**` used to exempt by accident. */
const TEMPLATE_SCRIPT = "templates/2d-topdown/src/scripts/player-controller.ts";

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
    // Repository tooling is out of scope through `include`, not through an exclude glob: no
    // `scripts/` directory in the workspace sits under a `src/`.
    { code: "const arm = entity.find('Body/Arm.L');", filename: "scripts/docs-harness.ts" },
    // The by-name service lookups. `actions.find("jump")` is the documented way for a script to
    // resolve an `InputAction` (`packages/input/src/actions/actions-view.ts`).
    { code: "const jump = actions.find('jump');", filename: TEMPLATE_SCRIPT },
    { code: "const jump = this.app.input.actions.find('jump');", filename: TEMPLATE_SCRIPT },
    { code: "const jump = app.input.actions.find(`jump`);", filename: SRC },
    { code: "const atlas = app.assets.find('2d/hero.atlas.json');", filename: SRC },
    { code: "const jump = getActions().find('jump');", filename: SRC, options: [{ allowedReceivers: ["getActions"] }] },
    // An array literal's `find` takes a predicate; a string there is a type error, not a path.
    { code: "const hit = ['a', 'b'].find('a');", filename: SRC },
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
    {
      // A game script under `templates/*/src/scripts/` is in scope: the old `**/scripts/**` exclude
      // exempted it by accident.
      code: "const arm = this.entity.find('Body/Arm.L');",
      filename: TEMPLATE_SCRIPT,
      errors: [{ messageId: "entityFind" }],
    },
    {
      // The allowance is by receiver *name*, not by "any member expression".
      code: "const arm = this.entity.actionsOwner.find('Body/Arm.L');",
      filename: TEMPLATE_SCRIPT,
      errors: [{ messageId: "entityFind" }],
    },
    {
      // An identifier that merely contains an allowed name is still a scene path.
      code: "const arm = uiActions.find('Body/Arm.L');",
      filename: SRC,
      errors: [{ messageId: "entityFind" }],
    },
  ],
});
