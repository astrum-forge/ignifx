import { Component } from "../../src/component/component.js";
import { asset, componentRef, entityRef, f32, str, u32 } from "../../src/schema/field-kinds.js";
import { Script } from "../../src/script/script.js";
import { sinkOf } from "../support/create-test-world.js";
import type { App } from "../../src/app/types.js";
import type { ConcreteComponentType } from "../../src/component/component-type.js";
import type { Entity } from "../../src/entity/entity.js";
import type { HotReloadReport } from "../../src/hot-reload/contract.js";
import type { LogRecord } from "../../src/log/log-level.js";
import type { MemorySink } from "../../src/log/memory-sink.js";

/**
 * The class pairs the hot-reload suites reload between. Each pair shares one `typeId` and stands
 * for the same source file before and after an edit: `Script.define` builds a fresh base class on
 * every module evaluation, so two independent declarations here are exactly what Vite hands the
 * engine after it re-executes a script module.
 */

/** Version 1 of the script every patch test reloads. */
export class MoverV1 extends Script.define({ speed: f32(1) }) {
  static typeId = "test/Mover";

  /** Transient state a `"patch"` reload must preserve; it is not in the schema. */
  hits = 0;

  awake(): void {
    sinkOf(this.world).push("awake:mover-v1");
  }

  update(): void {
    this.hits += 1;
  }

  /**
   * The method whose behaviour the reload changes.
   *
   * @returns Which version is running.
   */
  version(): string {
    return "v1";
  }
}

/** Version 2: the same fields, new behaviour, and one more callback. */
export class MoverV2 extends Script.define({ speed: f32(1) }) {
  static typeId = "test/Mover";
  static executionOrder = 25;

  /** Never re-initialised by a patch, because no constructor runs. */
  hits = 0;

  awake(): void {
    sinkOf(this.world).push("awake:mover-v2");
  }

  update(): void {
    this.hits += 1;
  }

  lateUpdate(): void {
    sinkOf(this.world).push("lateUpdate:mover-v2");
  }

  /**
   * The method whose behaviour the reload changes.
   *
   * @returns Which version is running.
   */
  version(): string {
    return "v2";
  }
}

/** Version 2 with one extra schema field, so the shape check fires under the default policy. */
export class MoverReshaped extends Script.define({ speed: f32(1), turbo: f32(2) }) {
  static typeId = "test/Mover";

  /**
   * The method whose behaviour the reload changes.
   *
   * @returns Which version is running.
   */
  version(): string {
    return "reshaped";
  }
}

/** A script that records every lifecycle callback, for the `"recreate"` ordering assertions. */
class BagBase extends Script.define({ slots: u32(1), label: str("") }) {
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
}

/** Version 1 of the re-created script. */
export class BagV1 extends BagBase {
  static typeId = "test/Bag";
  static hotReload = "recreate" as const;

  /**
   * The method whose behaviour the reload changes.
   *
   * @returns Which version is running.
   */
  version(): string {
    return "v1";
  }
}

/** Version 2 of the re-created script. */
export class BagV2 extends BagBase {
  static typeId = "test/Bag";
  static hotReload = "recreate" as const;

  /**
   * The method whose behaviour the reload changes.
   *
   * @returns Which version is running.
   */
  version(): string {
    return "v2";
  }
}

/** What {@link HolderV1}'s `onHotReload` recorded, so the class-level hook can be asserted on. */
export const migrations: string[] = [];

/** A component holding a tracked reference at a `Bag`, for the re-pointing assertion. */
export class Holder extends Component.define({ target: componentRef(BagV1) }) {
  static typeId = "test/Holder";
}

/** Version 1 of the class whose migration hook is exercised. */
export class HookedV1 extends Script.define({ note: str("one") }) {
  static typeId = "test/Hooked";
}

/** Version 2, which migrates class-level state from the class it replaces. */
export class HookedV2 extends Script.define({ note: str("one") }) {
  static typeId = "test/Hooked";

  /**
   * Records which class it replaced.
   *
   * @param previous - The class that was registered before.
   */
  static onHotReload(previous: ConcreteComponentType): void {
    migrations.push(previous.prototype.constructor.name);
  }
}

/** Version 2 whose migration hook throws, to prove one failure does not stop the rest. */
export class HookedThrowing extends Script.define({ note: str("one") }) {
  static typeId = "test/Hooked";

  /** Always throws. */
  static onHotReload(): void {
    throw new Error("migration failed");
  }
}

/**
 * Applies one replacement class and hands back the report.
 *
 * @param app - The app under test.
 * @param types - The classes the replaced module exports.
 * @returns The report.
 */
export function reload(app: App, ...types: readonly ConcreteComponentType[]): HotReloadReport {
  return app.hotReload.apply([{ types }]);
}

/**
 * Every log line a sink retained whose message contains a fragment.
 *
 * @param sink - The memory sink.
 * @param fragment - The text to look for.
 * @returns The matching records, oldest first.
 */
export function linesContaining(sink: MemorySink, fragment: string): readonly LogRecord[] {
  return sink.toArray().filter((record) => record.message.includes(fragment));
}

/** A component the rich script points a tracked reference at. */
export class Note extends Component.define({ text: str("") }) {
  static typeId = "test/Note";
}

/** Stand-in asset class the `asset()` field points at. */
export class Clip {
  static assetType = "audio";
  /** How long the clip runs, in seconds. */
  duration = 0;
}

/** The fields the rich pair declares: one of every kind the recreate path treats specially. */
const richSchema = {
  speed: f32(1),
  friend: entityRef<Entity>(),
  buddy: componentRef(Note),
  clip: asset(Clip),
  scratch: f32(0, { transient: true }),
} as const;

/** Version 1 of the re-created script that exercises references, assets, and transient fields. */
export class RichV1 extends Script.define(richSchema) {
  static typeId = "test/Rich";
  static hotReload = "recreate" as const;

  /**
   * The method whose behaviour the reload changes.
   *
   * @returns Which version is running.
   */
  version(): string {
    return "v1";
  }
}

/** Version 2 of the same script. */
export class RichV2 extends Script.define(richSchema) {
  static typeId = "test/Rich";
  static hotReload = "recreate" as const;

  /**
   * The method whose behaviour the reload changes.
   *
   * @returns Which version is running.
   */
  version(): string {
    return "v2";
  }
}

/** A schema-less script version 1, so the `null` schema paths are exercised. */
export class BareV1 extends Script {
  static typeId = "test/Bare";
  static hotReload = "recreate" as const;

  /** Transient state that a recreate deliberately does not carry over. */
  touched = 1;
}

/** A schema-less script version 2. */
export class BareV2 extends Script {
  static typeId = "test/Bare";
  static hotReload = "recreate" as const;

  /** Transient state that a recreate deliberately does not carry over. */
  touched = 1;
}

/** Version 3 of the rich script, with two fields dropped, so the decode reports unknown fields. */
export class RichTrimmed extends Script.define({ speed: f32(1) }) {
  static typeId = "test/Rich";
  static hotReload = "recreate" as const;
}

/** A class whose `typeId` is not `<namespace>/<Name>`, so registering it fails. */
export class Malformed extends Script {
  static typeId = "nope";
}
