import { signalConnectOwner } from "../src/rules/signal-connect-owner.ts";
import { createRuleTester } from "./rule-tester.ts";

const ruleTester = createRuleTester();

ruleTester.run("signal-connect-owner", signalConnectOwner, {
  valid: [
    "class Mover extends Script { awake(): void { this.entity.onDestroyed.connect(this.stop, { owner: this }); } }",
    "class Health extends Component { awake(): void { this.sig.connect(this.on, { once: true, owner: this }); } }",
    "class Mover extends Script.define({ speed: f32(5) }) { awake(): void { this.sig.connect(this.on, { owner: this }); } }",
    "class Hud extends HTMLElement { attach(): void { this.sig.connect(this.on); } }",
    "function wire(sig: Signal<void>): void { sig.connect(handler); }",
    "class Mover extends Script { awake(): void { this.sig.connect(this.on, options); } }",
    "class Mover extends Script { awake(): void { this.sig.connect(this.on, { ...defaults }); } }",
    "class Mover extends Script { awake(): void { this.socket.connect(); } }",
    {
      code: "class Mover extends Behaviour { awake(): void { this.sig.connect(this.on, { owner: this }); } }",
      options: [{ baseClasses: ["Behaviour"] }],
    },
    "class Bare { awake(): void { this.sig.connect(this.on); } }",
    "class Made extends make({ a: 1 }) { awake(): void { this.sig.connect(this.on); } }",
    "class Made extends factories[0]() { awake(): void { this.sig.connect(this.on); } }",
    "class Mover extends Script { awake(): void { this.sig[name](this.on); } }",
    "class Mover extends Script { awake(): void { this.sig.connect(...handlers); } }",
  ],
  invalid: [
    {
      code: "class Mover extends Script { awake(): void { this.sig.connect(this.on); } }",
      output: "class Mover extends Script { awake(): void { this.sig.connect(this.on, { owner: this }); } }",
      errors: [{ messageId: "missingOwner" }],
    },
    {
      code: "class Health extends Component { awake(): void { this.sig.connect(this.on); } }",
      output: "class Health extends Component { awake(): void { this.sig.connect(this.on, { owner: this }); } }",
      errors: [{ messageId: "missingOwner" }],
    },
    {
      code: "class Mover extends Script.define({ speed: f32(5) }) { awake(): void { this.sig.connect(this.on); } }",
      output:
        "class Mover extends Script.define({ speed: f32(5) }) { awake(): void { this.sig.connect(this.on, { owner: this }); } }",
      errors: [{ messageId: "missingOwner" }],
    },
    {
      code: "class Mover extends Script { awake(): void { this.sig.connect(() => { this.stop(); }); } }",
      output:
        "class Mover extends Script { awake(): void { this.sig.connect(() => { this.stop(); }, { owner: this }); } }",
      errors: [{ messageId: "missingOwner" }],
    },
    {
      code: "class Mover extends Script { awake(): void { this.sig.connect(this.on, { once: true }); } }",
      errors: [{ messageId: "ownerNotDeclared" }],
    },
    {
      code: "class Mover extends Script { awake(): void { this.sig.connect(this.on, {}); } }",
      errors: [{ messageId: "ownerNotDeclared" }],
    },
    {
      code: "const Mover = class extends Script { awake(): void { this.sig.connect(this.on); } };",
      output: "const Mover = class extends Script { awake(): void { this.sig.connect(this.on, { owner: this }); } };",
      errors: [{ messageId: "missingOwner" }],
    },
    {
      code: "class Mover extends Script { awake(): void { a.connect(this.x); b.connect(this.y, { deferred: true }); } }",
      output:
        "class Mover extends Script { awake(): void { a.connect(this.x, { owner: this }); b.connect(this.y, { deferred: true }); } }",
      errors: [{ messageId: "missingOwner" }, { messageId: "ownerNotDeclared" }],
    },
    {
      code: "class Mover extends Behaviour { awake(): void { this.sig.connect(this.on); } }",
      options: [{ baseClasses: ["Behaviour"] }],
      output: "class Mover extends Behaviour { awake(): void { this.sig.connect(this.on, { owner: this }); } }",
      errors: [{ messageId: "missingOwner" }],
    },
  ],
});
