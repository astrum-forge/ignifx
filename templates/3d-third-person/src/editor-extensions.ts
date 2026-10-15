// THROWAWAY spike S0.1 — the project's extension list as a module the editor host can import.
// `src/main.ts` declares the same list inline in its `createApp` call; nothing exports it today.
import { threeD } from "@ignifx/3d";
import { audio } from "@ignifx/audio";
import { electron } from "@ignifx/electron";
import { input } from "@ignifx/input";
import { physics } from "@ignifx/physics";
import { ui } from "@ignifx/ui";
import type { Extension } from "@ignifx/core";

export function extensions(): Extension[] {
  return [electron(), physics(), input(), audio(), threeD(), ui()];
}
