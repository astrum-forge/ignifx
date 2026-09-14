/**
 * Burst particles on a hit
 *
 * `emit(count)` spawns particles at the system's current clock whether or not it is playing, which
 * is what a one-off impact wants. Emission runs late in the `Update` phase, after every script, so
 * a burst asked for in `update` or from a physics callback is drawn in the same frame rather than
 * the next one.
 *
 * The effect here is not looping and has `playOnAwake` off: it exists to be hit. `emit` ignores
 * `app.particles.qualityScale` — a script that asked for twenty-four sparks meant twenty-four —
 * while `emission.rateOverTime` and bursts inside the document are scaled by it.
 *
 * Any hit source works the same way; this one uses a trigger volume because triggers carry both
 * entities, and Babylon Lite 1.27.0 reports plain collisions with no body identity.
 */
// docs:run
import { Camera, Script, createApp, u32 } from "@ignifx/core";
import { ParticleSystem, particleAssetFromDefinition, particleDefinition, particles } from "@ignifx/particles";
import { BoxCollider, Rigidbody, SphereCollider, physics } from "@ignifx/physics";
import type { ScriptCallbacks } from "@ignifx/core";
import type { TriggerEvent } from "@ignifx/physics";

/** Throws a burst of sparks at whatever lands in the volume it shares an entity with. */
class Impact extends Script.define({ sparks: u32(24) }) implements ScriptCallbacks {
  static typeId = "recipes/Impact";

  #effect: ParticleSystem | null = null;

  awake(): void {
    this.#effect = this.entity.getComponent(ParticleSystem);
  }

  onTriggerEnter(trigger: TriggerEvent): void {
    // The event object is pooled and reused, so read what you need now rather than storing it.
    this.app.log.info("hit by:", trigger.other?.name ?? "something");
    this.#effect?.emit(this.sparks);
  }
}

const app = await createApp({ headless: true, extensions: [physics(), particles()] });
app.registerComponents([Impact]);

const burst = particleAssetFromDefinition(
  app,
  particleDefinition("sparks", { main: { capacity: 256, looping: false, playOnAwake: false } }),
  "fx/impact-sparks",
);

app.world.createEntity("Main Camera", { position: { x: 0, y: 2, z: -6 } }).addComponent(Camera);

await app.start();

app.world.createEntity("Floor", { position: { x: 0, y: -0.5, z: 0 } }).addComponent(BoxCollider, {
  size: { x: 20, y: 1, z: 20 },
});

// The anvil is the effect *and* the trigger: one entity, so the sparks fly where the hit happened.
const anvil = app.world.createEntity("Anvil", { position: { x: 0, y: 0.5, z: 0 } });
anvil.addComponent(BoxCollider, { size: { x: 2, y: 1, z: 2 }, isTrigger: true });
const sparks = anvil.addComponent(ParticleSystem, { definition: burst, seed: 3 });
anvil.addComponent(Impact, { sparks: 24 });

const hammer = app.world.createEntity("Hammer", { position: { x: 0, y: 5, z: 0 } });
hammer.addComponent(SphereCollider, { radius: 0.3 });
hammer.addComponent(Rigidbody, { mass: 4 });

// Bodies are built at the start of the next fixed step, and the broadphase with them.
for (let frame = 0; frame < 90; frame += 1) {
  app.step(1 / 60);
}
app.log.info("sparks alive after the impact:", sparks.aliveCount);
app.dispose();
