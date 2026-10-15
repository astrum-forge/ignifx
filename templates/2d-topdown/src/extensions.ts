import { twoD } from "@ignifx/2d";
import { audio } from "@ignifx/audio";
import { electron } from "@ignifx/electron";
import { input } from "@ignifx/input";
import { physics2d } from "@ignifx/physics-2d";
import { ui } from "@ignifx/ui";
import type { Extension } from "@ignifx/core";

/**
 * The extensions this game registers, in registration order.
 *
 * `main.ts` passes the list to `createApp`, and so does anything else that builds an app over this
 * project — the editor's scene view imports this module by its default path, `src/extensions.ts`.
 * Keeping the list here, rather than inline in `main.ts`, is what lets both get the same engine.
 *
 * `electron()` is registered in **both** builds. Without a preload bridge it is inert — one debug
 * line, and an `app.desktop` that answers `isElectron === false` — so the browser build is unchanged
 * and the desktop build needs no second entry point. It goes first because it only requires core,
 * and because `app.storage` should be the file backend before any other extension reads a setting
 * from it.
 *
 * @returns A fresh list; each call creates new extension instances, one set per app.
 */
export function extensions(): readonly Extension[] {
  return [electron(), twoD(), physics2d(), input(), audio(), ui()];
}
