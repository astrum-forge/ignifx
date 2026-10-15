// THROWAWAY spike S0.1. The narrowest typed bridge the shell needs: the dev-server origin, a report
// channel to main, and a "server ready" event.
import { contextBridge, ipcRenderer } from "electron";

const arg = process.argv.find((value) => value.startsWith("--spike-dev-origin="));
const devOrigin = arg === undefined ? "" : arg.slice("--spike-dev-origin=".length);
const playArg = process.argv.includes("--spike-play");
const playOriginArg = process.argv.find((value) => value.startsWith("--spike-play-origin="));
const playOrigin = playOriginArg === undefined ? devOrigin : playOriginArg.slice("--spike-play-origin=".length);

contextBridge.exposeInMainWorld("spike", {
  devOrigin,
  play: playArg,
  playOrigin,
  report(message: unknown): void {
    ipcRenderer.send("spike:report", message);
  },
  onServerReady(callback: () => void): void {
    ipcRenderer.on("spike:server-ready", () => {
      callback();
    });
  },
});
