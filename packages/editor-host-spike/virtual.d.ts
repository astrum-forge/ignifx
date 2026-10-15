/// <reference types="@ignifx/vite-plugin/client" />
declare module "virtual:ignifx-editor-spike/project" {
  import type { Extension } from "@ignifx/core";
  export function extensions(): Extension[];
  export const scene: string;
  export const coreVersion: string;
  export const corePackagePath: string;
}
