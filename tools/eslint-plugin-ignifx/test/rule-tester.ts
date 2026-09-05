import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";

/**
 * `@typescript-eslint/rule-tester` looks for Mocha-style globals. Vitest exposes the same functions
 * as imports rather than globals here (`globals` is off in `vitest.config.ts`), so they are handed
 * to the tester explicitly, which is the wiring its documentation prescribes.
 */
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/**
 * Builds a rule tester. None of the ignifx rules ask for type information, so no `project` is set
 * and the tests run without a TypeScript program.
 *
 * @returns A fresh tester.
 */
export function createRuleTester(): RuleTester {
  return new RuleTester();
}
