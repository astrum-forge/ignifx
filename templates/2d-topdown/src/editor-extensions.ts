// THROWAWAY spike S0.2 — the project's extension list as a module the editor host can import.
// `src/main.ts` declares the same list inline in its `createApp` call; nothing exports it today.
import { twoD } from "@ignifx/2d";
import { audio } from "@ignifx/audio";
import { electron } from "@ignifx/electron";
import { input } from "@ignifx/input";
import { physics2d } from "@ignifx/physics-2d";
import { ui } from "@ignifx/ui";
import type { Extension } from "@ignifx/core";

export function extensions(): Extension[] {
  return [electron(), twoD(), physics2d(), input(), audio(), ui()];
}
