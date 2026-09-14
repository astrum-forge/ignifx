/**
 * `wgsl_reflect@1.6.0` declares `"type": "module"` but points `main` at a CommonJS file and ships no
 * `exports` map, so `import … from "wgsl_reflect"` fails under Node ESM with
 * `exports is not defined in ES module scope` (measured 2026-09-08). The ESM build has to be
 * imported by its file name — `wgsl_reflect/wgsl_reflect.module.js` — and without an `exports` map
 * TypeScript will not carry the package's `types` entry over to that subpath, so this shim points it
 * back at the declarations the package does ship.
 */

declare module "wgsl_reflect/wgsl_reflect.module.js" {
  export * from "wgsl_reflect";
}
