// Placeholder: the Phase 6 templates agent replaces this scaffold with the real template.
import { createApp } from "@ignifx/core";

const canvas = document.querySelector("canvas");
if (canvas instanceof HTMLCanvasElement) {
  const app = await createApp({ canvas });
  await app.start();
}
