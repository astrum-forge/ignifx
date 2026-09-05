import { noConsole } from "../src/rules/no-console.ts";
import { createRuleTester } from "./rule-tester.ts";

const ruleTester = createRuleTester();

ruleTester.run("no-console", noConsole, {
  valid: [
    { code: "export function f(): void { app.log.info('hi'); }", filename: "packages/core/src/app/app.ts" },
    { code: "console.log('sink');", filename: "packages/core/src/log/console-sink.ts" },
    { code: "console.error('failed');", filename: "scripts/docs-harness.ts" },
    { code: "console.log('usage');", filename: "packages/cli/src/bin.ts" },
    { code: "console.log('config');", filename: "vitest.config.ts" },
    { code: "console.log('tool');", filename: "tools/eslint-plugin-ignifx/src/index.ts" },
    { code: "console.log('site');", filename: "website/src/main.ts" },
    { code: "console.log('test');", filename: "packages/core/test/app.test.ts" },
    {
      code: "console.log('anywhere');",
      filename: "packages/core/src/app/app.ts",
      options: [{ allow: ["**/src/**"] }],
    },
  ],
  invalid: [
    {
      code: "export function f(): void { console.log('x'); }",
      filename: "packages/core/src/app/app.ts",
      errors: [{ messageId: "console" }],
    },
    {
      code: "console.warn('x');",
      filename: "packages/2d/src/sprite/sprite-renderer.ts",
      errors: [{ messageId: "console" }],
    },
    {
      code: "const write = console.debug;",
      filename: "packages/core/src/world/world.ts",
      errors: [{ messageId: "console" }],
    },
    {
      code: "console['log']('x');",
      filename: "packages/core/src/world/world.ts",
      errors: [{ messageId: "console" }],
    },
    {
      code: "console.log('a'); console.error('b');",
      filename: "packages/core/src/world/world.ts",
      errors: [{ messageId: "console" }, { messageId: "console" }],
    },
    {
      code: "console.log.bind(console)('x');",
      filename: "packages/core/src/world/world.ts",
      errors: [{ messageId: "console" }],
    },
    {
      code: "console.log('sink');",
      filename: "packages/core/src/log/console-sink.ts",
      options: [{ allow: [] }],
      errors: [{ messageId: "console" }],
    },
  ],
});
