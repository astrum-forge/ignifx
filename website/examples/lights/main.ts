import { Camera, Light } from "ignifx";
import { bootExample } from "../_kit/boot.ts";
import { attachOrbit } from "../_kit/orbit.ts";
import { bind, color, readout, slider, toggle } from "../_kit/panel.ts";
import { createArrow, createCone, createOrb, createRing, createSkyMarker } from "./gizmos.ts";
import {
  createLightSwitch,
  createSubjects,
  degrees,
  degreesPerSecond,
  FOCUS,
  fromHex,
  groundColor,
  LAMP,
  lightColor,
  metres,
  paints,
  SHADOW_MAP_SIZE,
  SKY,
  Spinner,
  SPOT,
  SUN,
} from "./scene.ts";

/**
 * The four lights ignifx has, in one scene, each drawn with a gizmo so you can see what you are
 * changing.
 *
 * A `Light` is described by two things: its own fields, and **its entity's transform**. A
 * directional light shines along the entity's `+Z` and has no position at all; a point light sits
 * at the entity's origin and fades to nothing at `range`; a spot light does both and adds a cone; a
 * hemispheric light has neither, only a sky direction — the entity's `+Y` — and two colours it
 * mixes between. So every lamp below is placed, then aimed with `lookAt`, and each gizmo is simply
 * a child entity: it inherits the pose, and nothing has to keep the two in step.
 *
 * Two of the four can cast. Shadows come from a directional or a spot light only; a point or
 * hemispheric light that asks for them is refused with `IGX-0703`
 * (`skills/ignifx/references/concepts/rendering.md` §1). What the gizmos are made of, and what the
 * numbers are, is `gizmos.ts` and `scene.ts` beside this file.
 */

bootExample({
  title: "Light types",
  settings: {
    rendering: {
      clearColor: { r: 0.043, g: 0.055, b: 0.078, a: 1 },
      msaaSamples: 4,
      // Read once, when `app.start()` registers the scene; asking afterwards is `IGX-0704`. Without
      // it a light's `shadows.enabled` is a no-op with a logged warning.
      features: { shadows: true },
    },
    time: { fixedDeltaTime: 1 / 60 },
  },

  async setup({ app, panel }) {
    app.registerComponents([Spinner]);

    const eye = app.world.createEntity("Main Camera");
    eye.addComponent(Camera, { near: 0.1, far: 200, fov: 45 });
    attachOrbit(app, eye, { yaw: 26, pitch: 29, distance: 10.5, target: FOCUS, minDistance: 4, maxDistance: 30 });
    await createSubjects(app);

    // ── Directional: a direction, and no position. `lookAt` is what sets it. ──────────────
    const sunEntity = app.world.createEntity("Sun", { position: SUN.at });
    sunEntity.transform.lookAt(FOCUS);
    const sun = sunEntity.addComponent(Light, { type: "directional", intensity: SUN.intensity });
    sun.color = fromHex(SUN.color);
    sun.shadows.enabled = true;
    sun.shadows.mapSize = SHADOW_MAP_SIZE;
    // A PCF-only offset along the surface normal, without which a map this size stripes a curved
    // surface with its own shadow.
    sun.shadows.normalBias = 0.02;
    sun.shadows.darkness = 0.28;
    const sunArrow = createArrow(app, { parent: sunEntity, size: SUN.arrow, color: fromHex(SUN.color) });
    const sunSwitch = createLightSwitch(sun, SUN.intensity, [sunArrow.entity]);

    // ── Point: a position and a range. The pivot is what walks it around the scene. ───────
    const pivot = app.world.createEntity("Lamp Pivot");
    const lampEntity = app.world.createEntity("Lamp", { parent: pivot, position: LAMP.at });
    const lamp = lampEntity.addComponent(Light, { type: "point", intensity: LAMP.intensity, range: LAMP.range });
    lamp.color = fromHex(LAMP.color);
    const lampOrb = createOrb(app, { parent: lampEntity, size: 0.22, color: fromHex(LAMP.color) });
    const lampRing = createRing(app, { parent: lampEntity, size: LAMP.range, color: fromHex(LAMP.color) });
    const lampSwitch = createLightSwitch(lamp, LAMP.intensity, [lampOrb.entity, lampRing.entity]);
    const spinner = pivot.addComponent(Spinner, { speed: LAMP.spin });
    // The ring is the range, so the two move together.
    const setRange = (value: number): void => {
      lamp.range = value;
      lampRing.setRadius(value);
    };

    // ── Spot: a position, a direction, a range and a cone. ────────────────────────────────
    const spotEntity = app.world.createEntity("Spot", { position: SPOT.at });
    spotEntity.transform.lookAt(SPOT.aim);
    const spot = spotEntity.addComponent(Light, {
      type: "spot",
      intensity: SPOT.intensity,
      range: SPOT.range,
      spotAngle: SPOT.angle,
      spotExponent: SPOT.exponent,
    });
    spot.color = fromHex(SPOT.color);
    // Lite gives a spot light one shadow generator, PCF, and ignores whatever `technique` says.
    spot.shadows.enabled = true;
    spot.shadows.mapSize = SHADOW_MAP_SIZE;
    spot.shadows.normalBias = 0.02;
    spot.shadows.darkness = 0.28;
    const spotOrb = createOrb(app, { parent: spotEntity, size: 0.2, color: fromHex(SPOT.color) });
    const cone = { parent: spotEntity, length: SPOT.cone, angleDegrees: SPOT.angle, color: fromHex(SPOT.color) };
    const spotCone = createCone(app, cone);
    const spotSwitch = createLightSwitch(spot, SPOT.intensity, [spotOrb.entity, spotCone.entity]);
    // The cone gizmo is the `spotAngle`, drawn.
    const setAngle = (value: number): void => {
      spot.spotAngle = value;
      spotCone.setAngle(value);
    };

    // ── Hemispheric: two colours and an up axis. Ambient, and it cannot cast. ─────────────
    const skyEntity = app.world.createEntity("Ambient", { position: SKY.at });
    const ambient = skyEntity.addComponent(Light, { type: "hemispheric", intensity: SKY.intensity });
    ambient.color = fromHex(SKY.color);
    ambient.groundColor = fromHex(SKY.ground);
    const skyMarker = createSkyMarker(app, { parent: skyEntity, size: 0.8, color: fromHex(SKY.color) });
    skyMarker.setGroundColor(fromHex(SKY.ground));
    const skySwitch = createLightSwitch(ambient, SKY.intensity, [skyMarker.entity]);

    panel({
      title: "Light types",
      groups: [
        {
          label: "Lamps",
          controls: [
            toggle("Directional", { value: true, change: sunSwitch.setOn }),
            toggle("Point", { value: true, change: lampSwitch.setOn }),
            toggle("Spot", { value: true, change: spotSwitch.setOn }),
            toggle("Hemispheric", { value: true, change: skySwitch.setOn }),
          ],
        },
        {
          label: "Directional",
          collapsed: true,
          controls: [
            slider("Intensity", { min: 0, max: 6, step: 0.1 }, { value: SUN.intensity, change: sunSwitch.setLevel }),
            color("Colour", { value: SUN.color, change: paints(lightColor(sun), sunArrow.setColor) }),
            toggle("Casts shadows", bind(sun.shadows, "enabled")),
          ],
        },
        {
          label: "Point",
          collapsed: true,
          controls: [
            slider("Intensity", { min: 0, max: 30, step: 0.5 }, { value: LAMP.intensity, change: lampSwitch.setLevel }),
            color("Colour", {
              value: LAMP.color,
              change: paints(lightColor(lamp), lampOrb.setColor, lampRing.setColor),
            }),
            slider("Range", { min: 1, max: 16, step: 0.5, format: metres }, { value: LAMP.range, change: setRange }),
            slider("Orbit", { min: 0, max: 60, step: 2, format: degreesPerSecond }, bind(spinner, "speed")),
          ],
        },
        {
          label: "Spot",
          collapsed: true,
          controls: [
            slider("Intensity", { min: 0, max: 60, step: 1 }, { value: SPOT.intensity, change: spotSwitch.setLevel }),
            color("Colour", {
              value: SPOT.color,
              change: paints(lightColor(spot), spotOrb.setColor, spotCone.setColor),
            }),
            slider(
              "Cone angle",
              { min: 6, max: 120, step: 1, format: degrees },
              { value: SPOT.angle, change: setAngle },
            ),
            slider("Edge falloff", { min: 0, max: 8, step: 0.1 }, bind(spot, "spotExponent")),
            toggle("Casts shadows", bind(spot.shadows, "enabled")),
          ],
        },
        {
          label: "Hemispheric",
          collapsed: true,
          controls: [
            slider("Intensity", { min: 0, max: 2, step: 0.05 }, { value: SKY.intensity, change: skySwitch.setLevel }),
            color("Sky", { value: SKY.color, change: paints(lightColor(ambient), skyMarker.setSkyColor) }),
            color("Ground", { value: SKY.ground, change: paints(groundColor(ambient), skyMarker.setGroundColor) }),
          ],
        },
        {
          label: "Frame",
          collapsed: true,
          controls: [
            readout("Draw calls", (): string => String(app.renderer.drawCalls)),
            readout("Shadow maps", (): string => String(Number(sun.isCastingShadows) + Number(spot.isCastingShadows))),
          ],
        },
      ],
    });
  },
});
