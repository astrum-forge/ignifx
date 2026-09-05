import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * Purely syntactic AST helpers. None of the ignifx rules ask for type information, so every helper
 * here answers from the parsed tree alone; that keeps the plugin usable without a TypeScript
 * program and keeps `pnpm lint` fast (coding standards §6).
 */

/**
 * Reads the name of a non-computed member, property, or class-member key.
 *
 * @param key - The key or property node.
 * @param computed - Whether the key was written in brackets.
 * @returns The static name, or `null` when the key is computed or not a plain identifier/string.
 */
export function staticKeyName(key: TSESTree.Node, computed: boolean): string | null {
  if (computed) {
    // `obj["literal"]` is still statically known; anything else is not.
    return key.type === AST_NODE_TYPES.Literal && typeof key.value === "string" ? key.value : null;
  }
  if (key.type === AST_NODE_TYPES.Identifier) {
    return key.name;
  }
  if (key.type === AST_NODE_TYPES.Literal && typeof key.value === "string") {
    return key.value;
  }
  return null;
}

/**
 * Builds the dotted source name of a callee, so that options can name a callee as `Script.define`.
 *
 * @param callee - The callee expression of a call or `new` expression.
 * @returns The dotted name (`foo`, `Script.define`, `a.b.c`), or `null` when any link is computed
 * or is not an identifier.
 */
export function calleeName(callee: TSESTree.Node): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.computed) {
    return null;
  }
  const objectName = calleeName(callee.object);
  const propertyName = staticKeyName(callee.property, false);
  if (objectName === null || propertyName === null) {
    return null;
  }
  return `${objectName}.${propertyName}`;
}

/**
 * Reads the compile-time string value of a node when it has one.
 *
 * @param node - Any expression node.
 * @returns The string for a string literal or a substitution-free template literal, else `null`.
 */
export function staticStringValue(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Literal) {
    return typeof node.value === "string" ? node.value : null;
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
    const [quasi] = node.quasis;
    return quasi === undefined ? null : quasi.value.cooked;
  }
  return null;
}

/**
 * Reports whether a class is a script or component: it extends one of `baseClasses` directly or
 * through the schema factory `<Base>.define({...})` (ADR-0004), or it declares the serializable
 * component marker `static typeId` (`03-scripting-and-components.md` §4).
 *
 * @param node - The class declaration or expression.
 * @param baseClasses - Base class names, e.g. `["Script", "Component"]`.
 * @returns `true` when the class is in scope for the script-model rules.
 */
export function isScriptLikeClass(
  node: TSESTree.ClassDeclaration | TSESTree.ClassExpression,
  baseClasses: readonly string[],
): boolean {
  const superClass = node.superClass;
  if (superClass !== null) {
    if (superClass.type === AST_NODE_TYPES.Identifier && baseClasses.some((base) => base === superClass.name)) {
      return true;
    }
    if (superClass.type === AST_NODE_TYPES.CallExpression) {
      const name = calleeName(superClass.callee);
      if (name !== null && baseClasses.some((base) => name === `${base}.define`)) {
        return true;
      }
    }
  }
  return node.body.body.some(
    (member) =>
      member.type === AST_NODE_TYPES.PropertyDefinition &&
      member.static &&
      staticKeyName(member.key, member.computed) === "typeId",
  );
}
