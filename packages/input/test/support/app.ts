import { createApp, createManualClock } from "@ignifx/core";
import { defineInputActions, input } from "../../src/index.js";
import type { GamepadReader, InputActionsDefinition, InputOptions } from "../../src/index.js";
import type { App, FetchLike, SettingsInput } from "@ignifx/core";

/** Options accepted by {@link createInputApp}. */
export interface InputAppOptions {
  readonly settings?: SettingsInput;
  readonly options?: InputOptions;
  readonly fetch?: FetchLike;
  readonly gamepadReader?: GamepadReader | null;
}

/** A headless app with `@ignifx/input` registered, plus the manual step helper. */
export interface InputAppHarness {
  readonly app: App;
  /** Runs one frame, advancing the manual clock by the same amount. */
  readonly step: (deltaSeconds?: number) => void;
  /** Lets every pending microtask run, runs one frame, and flushes again. */
  readonly settle: (deltaSeconds?: number) => Promise<void>;
  /** Disposes the app. */
  readonly dispose: () => void;
}

/**
 * Lets every queued microtask and promise continuation run. A zero-delay task hop, not a sleep: the
 * fake `fetch` resolves immediately and this only yields the turn its continuations need
 * (coding standards §10).
 */
export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Builds a headless app with the input extension registered and no gamepad polling by default, so
 * `simulate` is the only thing that writes device state.
 */
export async function createInputApp(options?: InputAppOptions): Promise<InputAppHarness> {
  const clock = createManualClock();
  const app = await createApp({
    headless: true,
    clock,
    extensions: [input({ gamepadReader: null, ...options?.options })],
    ...(options?.settings === undefined ? {} : { settings: options.settings }),
    ...(options?.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const step = (deltaSeconds = 1 / 60): void => {
    clock.advance(deltaSeconds * MILLISECONDS_PER_SECOND);
    app.step(deltaSeconds);
  };
  return {
    app,
    step,
    settle: async (deltaSeconds = 1 / 60): Promise<void> => {
      await flushMicrotasks();
      step(deltaSeconds);
      await flushMicrotasks();
    },
    dispose: (): void => {
      app.dispose();
    },
  };
}

/** The document most suites drive: a `Player` map with a move vector, a jump button, and a look. */
export function demoActions(): InputActionsDefinition {
  return defineInputActions({
    controlSchemes: [
      { name: "KeyboardMouse", devices: ["Keyboard", "Mouse"] },
      { name: "Gamepad", devices: ["Gamepad"] },
      { name: "Touch", devices: ["Touch"] },
    ],
    maps: [
      {
        name: "Player",
        actions: [
          {
            name: "move",
            type: "vector2",
            bindings: [
              {
                composite: "2DVector",
                up: "<Keyboard>/w",
                down: "<Keyboard>/s",
                left: "<Keyboard>/a",
                right: "<Keyboard>/d",
                scheme: "KeyboardMouse",
              },
              { path: "<Gamepad>/leftStick", processors: ["deadzone(0.15)"], scheme: "Gamepad" },
            ],
          },
          {
            name: "jump",
            type: "button",
            bindings: [{ path: "<Keyboard>/space" }, { path: "<Gamepad>/buttonSouth" }],
          },
          {
            name: "look",
            type: "vector2",
            bindings: [{ path: "<Mouse>/delta", processors: ["scale(0.1)"] }],
          },
          {
            name: "throttle",
            type: "axis",
            bindings: [{ composite: "1DAxis", negative: "<Keyboard>/s", positive: "<Keyboard>/w" }],
          },
        ],
      },
      {
        name: "UI",
        enabled: false,
        actions: [{ name: "submit", type: "button", bindings: [{ path: "<Keyboard>/enter" }] }],
      },
    ],
  });
}

/**
 * Narrows an indexed read, so a test reads the value it expects rather than a union with
 * `undefined`. A missing value fails the test with a message that names what was missing.
 */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`the test expected ${what} to exist`);
  }
  return value;
}
