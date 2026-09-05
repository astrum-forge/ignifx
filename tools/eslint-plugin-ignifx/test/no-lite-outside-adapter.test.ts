import { noLiteOutsideAdapter } from "../src/rules/no-lite-outside-adapter.ts";
import { createRuleTester } from "./rule-tester.ts";

const ruleTester = createRuleTester();

ruleTester.run("no-lite-outside-adapter", noLiteOutsideAdapter, {
  valid: [
    {
      code: "import { createNullEngine } from '@babylonjs/lite';",
      filename: "packages/core/src/lite/headless.ts",
    },
    {
      code: "import type { SceneContext } from '@babylonjs/lite';",
      filename: "packages/core/src/lite/render.ts",
    },
    {
      code: "import { IgnifxError } from '../errors.ts';",
      filename: "packages/core/src/world/world.ts",
    },
    {
      code: "import { createNullEngine } from '@babylonjs/lite';",
      filename: "packages/core/test/lite/compatibility.test.ts",
    },
    {
      code: "import { createEngine } from '@babylonjs/lite';",
      filename: "packages/core/test/lite/engine.browser.test.ts",
    },
    {
      code: "export async function load(): Promise<unknown> { return import('@babylonjs/havok'); }",
      filename: "packages/physics/src/lite/havok.ts",
    },
    {
      code: "import RAPIER from '@dimforge/rapier2d-compat';",
      filename: "packages/physics-2d/src/lite/rapier.ts",
    },
    {
      code: "import { thing } from '@babylonjs/lite';",
      filename: "packages/core/src/adapter/thing.ts",
      options: [{ adapterDirectories: ["src/adapter/"] }],
    },
    {
      code: "import { thing } from '@acme/other';",
      filename: "packages/core/src/world/world.ts",
      options: [{ packages: ["@babylonjs/lite"] }],
    },
    { code: "const lite = obj.require('@babylonjs/lite');", filename: "packages/core/src/world/world.ts" },
    { code: "const lite = require();", filename: "packages/core/src/world/world.ts" },
    { code: "const lite = require(name);", filename: "packages/core/src/world/world.ts" },
    {
      code: "export async function f(): Promise<unknown> { return import(name); }",
      filename: "packages/core/src/world/world.ts",
    },
  ],
  invalid: [
    {
      code: "import { createNullEngine } from '@babylonjs/lite';",
      filename: "packages/core/src/world/world.ts",
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
    {
      code: "import { Vector3 } from '@babylonjs/lite/math/vector';",
      filename: "packages/core/src/math/vec3.ts",
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
    {
      code: "export { createEngine } from '@babylonjs/lite';",
      filename: "packages/core/src/index.ts",
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
    {
      code: "export * from '@babylonjs/lite';",
      filename: "packages/core/src/index.ts",
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
    {
      code: "export async function load(): Promise<unknown> { return import('@babylonjs/lite'); }",
      filename: "packages/core/src/world/world.ts",
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
    {
      code: "const lite = require('@babylonjs/lite');",
      filename: "packages/core/src/world/world.ts",
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
    {
      code: "import { HavokPlugin } from '@babylonjs/havok';",
      filename: "packages/physics/src/body/rigidbody.ts",
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
    {
      code: "import RAPIER from '@dimforge/rapier2d-compat';",
      filename: "packages/physics-2d/src/body/rigidbody-2d.ts",
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
    {
      // A `*.test.ts` file that does not live under a package `test/` directory is not an adapter
      // compatibility test, so the allowance does not apply.
      code: "import { createNullEngine } from '@babylonjs/lite';",
      filename: "packages/core/src/lite-helpers.test.ts",
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
    {
      code: "import { createNullEngine } from '@babylonjs/lite';",
      filename: "packages/core/test/lite/compatibility.test.ts",
      options: [{ allow: [] }],
      errors: [{ messageId: "liteOutsideAdapter" }],
    },
  ],
});
