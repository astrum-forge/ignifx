import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { calleeName, staticKeyName } from "../util/ast.ts";
import { createRule } from "../util/create-rule.ts";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * ADR-0004 consequence, spelled out in `03-scripting-and-components.md` §3: the base class returned
 * by `Script.define({ speed: f32(5) })` installs `speed` on the instance and applies the default in
 * its constructor. A subclass field with the same name re-declares that property, so the class field
 * initialiser (or an implicit `undefined` under `useDefineForClassFields`) overwrites the value the
 * serializer just wrote. Non-serialized runtime state must use a different name.
 */

/** Options accepted by `ignifx/schema-field-shadowing`. */
export interface Options {
  /** Names of factory functions whose first argument is a schema object literal. */
  readonly schemaFactories: readonly string[];
}

/** Bare factory names (as opposed to the `<Base>.define` member form). */
const DEFAULT_SCHEMA_FACTORIES = ["defineSchema"] as const;

/** The messages this rule can report. */
type MessageId = "schemaFieldDeclaredHere" | "shadowsSchemaField";

/**
 * Finds the schema object literal a class's `extends` clause declares, if any.
 *
 * @param node - The class declaration or expression.
 * @param schemaFactories - Bare factory names from the options.
 * @returns The schema object literal, or `null`.
 */
function schemaObject(
  node: TSESTree.ClassDeclaration | TSESTree.ClassExpression,
  schemaFactories: readonly string[],
): TSESTree.ObjectExpression | null {
  const superClass = node.superClass;
  if (superClass === null || superClass.type !== AST_NODE_TYPES.CallExpression) {
    return null;
  }
  const name = calleeName(superClass.callee);
  const isDefineMember = name !== null && name.endsWith(".define");
  const isFactory = name !== null && schemaFactories.some((factory) => factory === name);
  if (!isDefineMember && !isFactory) {
    return null;
  }
  const [first] = superClass.arguments;
  return first !== undefined && first.type === AST_NODE_TYPES.ObjectExpression ? first : null;
}

/**
 * The schema-shadowing rule.
 *
 * @internal
 */
export const schemaFieldShadowing = createRule<[Partial<Options>?], MessageId>({
  name: "schema-field-shadowing",
  meta: {
    type: "problem",
    docs: {
      description: "Forbid class fields that shadow a schema field declared in the `extends` clause (ADR-0004).",
    },
    messages: {
      shadowsSchemaField:
        "`{{name}}` is already declared by the schema in the `extends` clause. The base class installs " +
        "it and the serializer writes it, so this field re-declares the property and discards the " +
        "loaded value. Rename the runtime field (03-scripting-and-components.md §3).",
      schemaFieldDeclaredHere: "`{{name}}` is declared here as a schema field.",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          schemaFactories: { type: "array", items: { type: "string" } },
        },
      },
    ],
    defaultOptions: [{}],
  },
  create(context, [option]) {
    const schemaFactories = option?.schemaFactories ?? DEFAULT_SCHEMA_FACTORIES;

    /**
     * Checks one class against its own schema.
     *
     * @param node - The class declaration or expression.
     */
    function checkClass(node: TSESTree.ClassDeclaration | TSESTree.ClassExpression): void {
      const schema = schemaObject(node, schemaFactories);
      if (schema === null) {
        return;
      }
      const schemaProperties = new Map<string, TSESTree.Node>();
      for (const property of schema.properties) {
        if (property.type !== AST_NODE_TYPES.Property) {
          continue;
        }
        const name = staticKeyName(property.key, property.computed);
        if (name !== null) {
          schemaProperties.set(name, property.key);
        }
      }
      if (schemaProperties.size === 0) {
        return;
      }
      for (const member of node.body.body) {
        if (
          member.type !== AST_NODE_TYPES.PropertyDefinition &&
          member.type !== AST_NODE_TYPES.TSAbstractPropertyDefinition &&
          member.type !== AST_NODE_TYPES.AccessorProperty
        ) {
          continue;
        }
        if (member.static) {
          // A static member lives on the constructor, not on the instance, so it cannot shadow an
          // instance property the schema installed.
          continue;
        }
        const name = staticKeyName(member.key, member.computed);
        if (name === null) {
          continue;
        }
        const declaration = schemaProperties.get(name);
        if (declaration === undefined) {
          continue;
        }
        context.report({ node: member.key, messageId: "shadowsSchemaField", data: { name } });
        context.report({ node: declaration, messageId: "schemaFieldDeclaredHere", data: { name } });
      }
    }

    return {
      ClassDeclaration: checkClass,
      ClassExpression: checkClass,
    };
  },
});
