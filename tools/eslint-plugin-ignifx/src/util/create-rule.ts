import { ESLintUtils } from "@typescript-eslint/utils";

/**
 * The factory every ignifx rule is built with. It stamps the shared documentation pointer onto each
 * rule's metadata and gives `create` fully typed options and message ids.
 */

/**
 * Points at the rule's section of the plugin README. The plugin is repository-internal and never
 * published, so there is no public documentation site to link to; a repository-relative path is the
 * honest answer and is what a reviewer needs.
 *
 * @param ruleName - The rule name as registered in the plugin.
 * @returns A repository-relative pointer to that rule's documentation.
 */
function ruleDocumentation(ruleName: string): string {
  return `tools/eslint-plugin-ignifx/README.md#${ruleName}`;
}

/**
 * Creates an ignifx lint rule.
 *
 * @internal
 */
export const createRule = ESLintUtils.RuleCreator(ruleDocumentation);
