import { str } from "../../src/schema/field-kinds.js";
import { Script } from "../../src/script/script.js";
import { sinkOf } from "./create-test-world.js";

/**
 * A script that appends `"<callback>:<label>"` to its world's shared log for every callback it
 * receives. Every lifecycle-order assertion in the suite reads that log.
 */
export class RecordingScript extends Script.define({ label: str("") }) {
  static typeId = "test/RecordingScript";

  /**
   * Appends one entry to the world's shared log.
   *
   * @param callback - The callback name.
   */
  record(callback: string): void {
    sinkOf(this.world).push(`${callback}:${this.label}`);
  }

  awake(): void {
    this.record("awake");
  }

  onEnable(): void {
    this.record("onEnable");
  }

  start(): void {
    this.record("start");
  }

  onDisable(): void {
    this.record("onDisable");
  }

  onDestroy(): void {
    this.record("onDestroy");
  }

  onDetach(): void {
    this.record("onDetach");
  }

  update(dt: number): void {
    this.record(`update(${String(dt)})`);
  }
}

/** A recorder that runs before the default order. */
export class EarlyScript extends RecordingScript {
  static override typeId = "test/EarlyScript";
  static executionOrder = -10;
}

/** A recorder that runs after the default order. */
export class LateScript extends RecordingScript {
  static override typeId = "test/LateScript";
  static executionOrder = 10;
}

/** A component-shaped recorder that implements no callbacks at all. */
export class SilentScript extends Script {
  static typeId = "test/SilentScript";
}
