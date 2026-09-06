import { createApp, createConsoleSink, f32, Script } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { createDevtoolsLogSink, devtools } from "../src/index.js";

/**
 * The compiled, executed form of every headless example in
 * `packages/devtools/skills/devtools/SKILL.md`.
 *
 * The skill's examples are shipped as documentation, not run by the docs harness, so this file is
 * what makes the claim "these compile and work" true rather than hopeful (`p2-common.md`: run your
 * skill examples once before shipping them). Each block below is the example verbatim, with
 * `console.log` turned into an assertion and the umbrella import rewritten to the source paths the
 * suite can resolve.
 */

/** The `Mover` from the skill's **First app**. */
class Mover extends Script.define({ speed: f32(3) }) {
  /** The namespaced registration id. */
  static typeId = "mygame/Mover";

  /**
   * Advances the entity along X.
   *
   * @param dt - Seconds since the previous frame.
   */
  update(dt: number): void {
    this.transform.localPosition.x += this.speed * dt;
  }
}

describe("the SKILL.md examples", () => {
  it("First app", async () => {
    const app = await createApp({ headless: true, logLevel: "silent", extensions: [devtools()] });
    app.registerComponents([Mover]);

    const hero = app.world.createEntity("Hero");
    hero.addComponent(Mover, { speed: 5 });

    await app.start();
    app.step(1 / 60);

    const frame = app.diagnostics.frame;
    expect(frame.frame).toBeGreaterThan(0);
    expect(frame.scriptsUpdated).toBe(1);
    expect(app.world.scenes[0]?.roots.length).toBe(1);

    app.devtools.select(hero);
    app.devtools.panel("inspector").show();
    expect(app.devtools.selected?.name).toBe("Hero");
    expect(app.devtools.isOpen).toBe(false);

    app.dispose();
  });

  it("Read the numbers the Stats panel shows", async () => {
    const app = await createApp({ headless: true, logLevel: "silent", extensions: [devtools()] });
    await app.start();
    app.step(1 / 60);

    const frame = app.diagnostics.frame;
    expect(frame.rawDeltaMs).toBeCloseTo(1000 / 60, 3);
    expect(frame.fixedSteps).toBeGreaterThanOrEqual(0);
    expect(frame.scriptsUpdated).toBe(0);

    const render = app.diagnostics.group("render");
    expect(render).not.toBeNull();
    if (render !== null) {
      expect(render.get(render.index("drawCalls"))).toBeGreaterThanOrEqual(0);
    }

    app.dispose();
  });

  it("Put the log in the Console panel", async () => {
    const logSink = createDevtoolsLogSink({ limit: 500, tee: createConsoleSink() });
    const app = await createApp({
      headless: true,
      logSink,
      logLevel: "debug",
      extensions: [devtools({ logSink })],
    });

    app.log.child("assets").warn("no atlas for {sprite}", "hero");
    expect(logSink.length).toBeGreaterThan(0);
    expect(logSink.at(logSink.length - 1)?.message).toBe("no atlas for {sprite}");

    app.dispose();
  });

  it("Open a specific panel on a key of your own", async () => {
    const app = await createApp({
      headless: true,
      logLevel: "silent",
      extensions: [devtools({ toggleKey: "F1" })],
    });
    await app.start();

    app.devtools.onOpened.connect(() => {
      app.devtools.panel("timeline").show();
    });
    app.devtools.panel("audio").hide();

    const summary = app.devtools.panels.map((panel) => `${panel.name}:${String(panel.visible)}`).join(" ");
    expect(summary).toContain("audio:false");
    expect(summary).toContain("stats:true");

    app.dispose();
  });
});
