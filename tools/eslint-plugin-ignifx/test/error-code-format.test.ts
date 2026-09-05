import { errorCodeFormat } from "../src/rules/error-code-format.ts";
import { createRuleTester } from "./rule-tester.ts";

const ruleTester = createRuleTester();

ruleTester.run("error-code-format", errorCodeFormat, {
  valid: [
    "const code = 'IGX-0101';",
    "const code = 'IGX-0501';",
    "const code = 'IGX-1503';",
    "const code = 'IGX-9042';",
    "const code = `IGX-0201`;",
    "const message = 'entity not found';",
    "const doc = 'see IGX-0501 in the registry';",
    "throw new IgnifxError(ErrorCode.invalidRuntime, 'disposed');",
    "throw new IgnifxError(code, 'disposed');",
    "throw new IgnifxError('IGX-0201', 'Mover requires Rigidbody.');",
    "throw new RangeError('IGX-9999 is fine here');",
    "expect(message).toBe('IGX-0303 [layer]');",
    "const dev = 'IGX-0201: Mover requires Rigidbody.';",
    { code: "throw new CliError('IGX-1401', 'target not empty');", options: [{ errorConstructors: ["CliError"] }] },
    "throw new IgnifxError(`IGX-0101`, 'message');",
    "throw new IgnifxError(42, 'message');",
    "throw new IgnifxError();",
    "const template = `IGX-${range}01`;",
    "const notString = 42;",
  ],
  invalid: [
    { code: "const code = 'IGX-001';", errors: [{ messageId: "badFormat" }] },
    { code: "const code = 'IGX-05011';", errors: [{ messageId: "badFormat" }] },
    { code: "const code = 'IGX-abcd';", errors: [{ messageId: "badFormat" }] },
    { code: "const code = `IGX-12`;", errors: [{ messageId: "badFormat" }] },
    { code: "const code = 'IGX-0001';", errors: [{ messageId: "unregisteredRange" }] },
    { code: "const code = 'IGX-1601';", errors: [{ messageId: "unregisteredRange" }] },
    { code: "const code = 'IGX-8000';", errors: [{ messageId: "unregisteredRange" }] },
    {
      code: "throw new IgnifxError('nope', 'message');",
      errors: [{ messageId: "badFormatInError" }],
    },
    {
      code: "throw new IgnifxError('IGX-0002', 'disposed');",
      errors: [{ messageId: "unregisteredRangeInError" }],
    },
    {
      code: "throw new IgnifxError(`IGX-16`, 'disposed');",
      errors: [{ messageId: "badFormatInError" }],
    },
    {
      code: "const a = 'IGX-0001'; const b = 'IGX-16';",
      errors: [{ messageId: "unregisteredRange" }, { messageId: "badFormat" }],
    },
    {
      code: "throw new CliError('IGX-0000', 'x');",
      options: [{ errorConstructors: ["CliError"] }],
      errors: [{ messageId: "unregisteredRangeInError" }],
    },
  ],
});
