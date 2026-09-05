import { schemaFieldShadowing } from "../src/rules/schema-field-shadowing.ts";
import { createRuleTester } from "./rule-tester.ts";

const ruleTester = createRuleTester();

ruleTester.run("schema-field-shadowing", schemaFieldShadowing, {
  valid: [
    "class Mover extends Script.define({ speed: f32(5) }) { #velocity = 0; }",
    "class Mover extends Script.define({ speed: f32(5) }) { static typeId = 'mygame/Mover'; }",
    "class Mover extends Script.define({ speed: f32(5) }) { static speed = 1; }",
    "class Mover extends Script { speed = 0; }",
    "class Mover extends Script.define({ speed: f32(5) }) { update(dt: number): void { this.step(dt); } }",
    "class Mover extends Script.define({}) { speed = 0; }",
    "class Mover extends Component.define({ hp: i32(10) }) { armor = 0; }",
    "class Mover extends defineSchema({ hp: i32(10) }) { armor = 0; }",
    "class Mover extends Script.define(schema) { speed = 0; }",
    "class Mover extends make({ speed: f32(5) }) { speed = 0; }",
    "class Mover extends factories[0]({ speed: f32(5) }) { speed = 0; }",
    "class Mover extends Script.define({ ...base, speed: f32(5) }) { [key] = 0; }",
    "class Mover extends Script.define({ [key]: f32(5) }) { speed = 0; }",
  ],
  invalid: [
    {
      code: "class Mover extends Script.define({ speed: f32(5) }) { speed = 0; }",
      errors: [{ messageId: "schemaFieldDeclaredHere" }, { messageId: "shadowsSchemaField" }],
    },
    {
      code: "class Mover extends Component.define({ hp: i32(10) }) { hp = 0; }",
      errors: [{ messageId: "schemaFieldDeclaredHere" }, { messageId: "shadowsSchemaField" }],
    },
    {
      code: "class Mover extends Script.define({ speed: f32(5) }) { declare speed: number; }",
      errors: [{ messageId: "schemaFieldDeclaredHere" }, { messageId: "shadowsSchemaField" }],
    },
    {
      code: "class Mover extends Script.define({ speed: f32(5) }) { accessor speed = 0; }",
      errors: [{ messageId: "schemaFieldDeclaredHere" }, { messageId: "shadowsSchemaField" }],
    },
    {
      code: "class Mover extends Script.define({ 'speed': f32(5) }) { ['speed'] = 0; }",
      errors: [{ messageId: "schemaFieldDeclaredHere" }, { messageId: "shadowsSchemaField" }],
    },
    {
      code: "class Mover extends defineSchema({ hp: i32(10) }) { hp = 0; }",
      errors: [{ messageId: "schemaFieldDeclaredHere" }, { messageId: "shadowsSchemaField" }],
    },
    {
      code: "class Mover extends Script.define({ speed: f32(5), hp: i32(1) }) { speed = 0; hp = 0; }",
      errors: [
        { messageId: "schemaFieldDeclaredHere" },
        { messageId: "schemaFieldDeclaredHere" },
        { messageId: "shadowsSchemaField" },
        { messageId: "shadowsSchemaField" },
      ],
    },
    {
      code: "const Mover = class extends Script.define({ speed: f32(5) }) { speed = 0; };",
      errors: [{ messageId: "schemaFieldDeclaredHere" }, { messageId: "shadowsSchemaField" }],
    },
    {
      code: "class Mover extends Script.define({ hp: i32(1) }) { hp = 0; }",
      options: [{ schemaFactories: [] }],
      errors: [{ messageId: "schemaFieldDeclaredHere" }, { messageId: "shadowsSchemaField" }],
    },
  ],
});
