// `wgsl_reflect`'s `main` is a CommonJS build inside a `"type": "module"` package, so Node refuses
// it; the ESM build beside it is the same library and carries the same types.
declare module "wgsl_reflect/wgsl_reflect.module.js" {
  export { WgslReflect } from "wgsl_reflect";
}
