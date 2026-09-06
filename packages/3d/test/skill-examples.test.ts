import { describe, expect, it } from "vitest";

/**
 * Runs every headless example from `packages/3d/skills/3d/SKILL.md` and
 * `skills/ignifx/references/concepts/scripting.md` once, verbatim apart from the import
 * specifiers, which point at the sources rather than at the published packages.
 */
describe("skill examples", () => {
  it("first app", async () => {
    const { Camera, createApp } = await import("@ignifx/core");
    const { BoxCollider, CharacterController, Rigidbody, physics } = await import("@ignifx/physics");
    const { input } = await import("@ignifx/input");
    const { ThirdPersonCamera, ThirdPersonController, threeD } = await import("../src/index.js");
    const { loadHavokForTests } = await import("./lite/fixtures/havok.js");

    const app = await createApp({
      headless: true,
      extensions: [physics({ havok: await loadHavokForTests() }), input(), threeD()],
    });

    const floor = app.world.createEntity("Floor", { position: { x: 0, y: -0.5, z: 0 } });
    floor.addComponent(BoxCollider, { size: { x: 60, y: 1, z: 60 } });
    floor.addComponent(Rigidbody, { bodyType: "static" });

    const hero = app.world.createEntity("Hero", { position: { x: 0, y: 1, z: 0 } });
    hero.addComponent(CharacterController, { height: 1.8, radius: 0.35, slopeLimit: 45 });
    const controller = hero.addComponent(ThirdPersonController, {
      walkSpeed: 4,
      sprintSpeed: 7,
      jumpHeight: 1.2,
      stepHeight: 0.3,
    });

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera);
    eye.addComponent(ThirdPersonCamera, { target: hero, distance: 5, shoulderOffset: { x: 0.5, y: 1.5, z: 0 } });

    await app.start();
    app.step(1 / 60);
    app.log.info("grounded={grounded} speed={speed}", controller.isGrounded, controller.speed);
    expect(controller.speed).toBe(0);
    app.dispose();
  }, 30_000);

  it("a tween", async () => {
    const { createApp } = await import("@ignifx/core");
    const app = await createApp({ headless: true });
    const door = app.world.createEntity("Door");
    const tween = app.tweens.to(
      door.transform,
      { position: { x: 0, y: 3, z: 0 } },
      {
        duration: 0.8,
        ease: "cubicInOut",
        onComplete: (): void => app.log.info("open"),
      },
    );
    await app.start();
    app.step(0.4);
    app.log.info("halfway: {progress}", tween.progress);
    expect(tween.progress).toBeGreaterThan(0);
    app.dispose();
  }, 30_000);

  it("a companion that walks to the player", async () => {
    const { createApp } = await import("@ignifx/core");
    const { input } = await import("@ignifx/input");
    const { physics } = await import("@ignifx/physics");
    const { NavMeshAgent, NavMeshSurface, threeD } = await import("../src/index.js");
    const { loadHavokForTests } = await import("./lite/fixtures/havok.js");

    const app = await createApp({
      headless: true,
      extensions: [physics({ havok: await loadHavokForTests() }), input(), threeD()],
    });

    const level = app.world.createEntity("Level");
    const surface = level.addComponent(NavMeshSurface, { agentRadius: 0.4, bakeOnAwake: false });
    surface.addSource([-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10], [0, 1, 2, 0, 2, 3], null);
    await surface.bake();

    const companion = app.world.createEntity("Companion", { position: { x: -8, y: 0, z: 0 } });
    const agent = companion.addComponent(NavMeshAgent, { speed: 4, stoppingDistance: 0.6 });
    agent.onArrived.connect((): void => app.log.info("arrived"), { owner: agent });

    await app.start();
    app.step(1 / 60);
    expect(agent.setDestination({ x: 8, y: 0, z: 0 })).toBe(true);
    app.dispose();
  }, 30_000);

  it("level of detail and billboards", async () => {
    const { MeshRenderer, createApp } = await import("@ignifx/core");
    const { input } = await import("@ignifx/input");
    const { physics } = await import("@ignifx/physics");
    const { Billboard, LodGroup, threeD } = await import("../src/index.js");
    const { loadHavokForTests } = await import("./lite/fixtures/havok.js");

    const app = await createApp({
      headless: true,
      extensions: [physics({ havok: await loadHavokForTests() }), input(), threeD()],
    });
    const tree = app.world.createEntity("Tree", { position: { x: 0, y: 0, z: 30 } });
    const highDetail = tree.addComponent(MeshRenderer);
    const lowDetail = app.world.createEntity("TreeFar", { parent: tree }).addComponent(MeshRenderer);
    tree.addComponent(LodGroup, {
      levels: [
        { distance: 20, renderer: highDetail },
        { distance: 60, renderer: lowDetail },
      ],
      hysteresis: 0.1,
    });
    const nameplate = app.world.createEntity("Nameplate", { parent: tree });
    nameplate.addComponent(Billboard, { mode: "yAxis" });
    await app.start();
    app.step(1 / 60);
    app.dispose();
    expect(true).toBe(true);
  }, 30_000);
});
