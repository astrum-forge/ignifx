#!/usr/bin/env node
/**
 * `pnpm vendor:decoders` — refreshes `packages/core/decoders/`, the decoders Babylon Lite loads at
 * run time, so a game serves them from its own origin instead of `cdn.babylonjs.com`.
 *
 * Lite 1.34 injects the KTX2 decoder (`babylon.ktx2Decoder.js`), which then fetches its Basis and
 * UASTC transcoders and a Zstandard decoder, and the meshopt decoder (`meshopt_decoder.js`), from
 * the Babylon CDN unless told otherwise (`lib/texture/ktx2-loader.js`,
 * `lib/loader-gltf/meshopt-decode.js`). A packaged game's `script-src 'self'` blocks the CDN. The
 * files therefore ship inside `@ignifx/core`, which lists them in `ignifx.assets.public`, and
 * `@ignifx/vite-plugin` copies them into the build like any extension's public files.
 *
 * They are committed rather than installed because the npm packages that carry them would make
 * every game install the whole of Babylon.js: `babylonjs-ktx2decoder` depends on `babylonjs`
 * (113 MB) and `@babylonjs/ktx2decoder` declares `@babylonjs/core` (72 MB) as a required peer.
 * This script is the only way the files change: it downloads the pinned tarballs with `npm pack`,
 * copies the files out (dropping a script's trailing `sourceMappingURL` comment, since the maps are
 * not vendored), and rewrites `vendored.json` with their SHA-256 digests, which
 * `scripts/test/vendored.test.ts` checks and `pnpm licenses:notices` reads. It needs the network,
 * so it is not part of `pnpm check`.
 *
 * Options:
 * - `--root <dir>` — write into a tree other than the repository.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArguments } from "./lib/args.ts";
import { writeGeneratedFile } from "./lib/fs-tree.ts";
import { log, logError } from "./lib/log.ts";
import { sha256Of, VENDORED_MANIFEST } from "./lib/vendored.ts";
import { isRecord, repositoryRoot } from "./lib/workspace.ts";
import type { VendoredComponent, VendoredManifest } from "./lib/vendored.ts";

/** Where the files go, from the repository root. */
const TARGET = "packages/core/decoders";

/** One upstream package and the files taken from it. */
interface Source {
  /** The npm name. */
  readonly name: string;
  /** The exact version. Keep the two Babylon packages on one version. */
  readonly version: string;
  /** The upstream repository. */
  readonly repository: string;
  /** The copyright line for the notices file. */
  readonly copyright: string;
  /** The licence file inside the package. */
  readonly licenseFrom: string;
  /** The `NOTICE` file inside the package, or `null`. */
  readonly noticeFrom: string | null;
  /** `[served name, path inside the package]` pairs. */
  readonly files: readonly (readonly [string, string])[];
}

/**
 * The pinned sources. 9.30.0 is the decoder Lite 1.34.0 was verified against (editor spike S0.6
 * §4.4 loaded ETC1S and UASTC files through `cdn.babylonjs.com/v9.30.0/`).
 */
const SOURCES: readonly Source[] = [
  {
    // The UMD build that defines the `KTX2DECODER` global Lite's loader reads; self-contained (it
    // never touches its `babylonjs` dependency at run time).
    name: "babylonjs-ktx2decoder",
    version: "9.30.0",
    repository: "https://github.com/BabylonJS/Babylon.js",
    copyright: "Copyright 2024 The Babylon.js team",
    licenseFrom: "license.md",
    noticeFrom: null,
    files: [["babylon.ktx2Decoder.js", "babylon.ktx2Decoder.js"]],
  },
  {
    // The transcoders the decoder fetches. The same files `cdn.babylonjs.com/ktx2Transcoders/1/`
    // serves; the package copies them from Babylon's own server tree.
    name: "@babylonjs/ktx2decoder",
    version: "9.30.0",
    repository: "https://github.com/BabylonJS/Babylon.js",
    copyright: "Copyright 2024 The Babylon.js team",
    licenseFrom: "wasm/license.md",
    noticeFrom: "NOTICE.md",
    files: [
      ["msc_basis_transcoder.js", "wasm/msc_basis_transcoder.js"],
      ["msc_basis_transcoder.wasm", "wasm/msc_basis_transcoder.wasm"],
      ["uastc_astc.wasm", "wasm/uastc_astc.wasm"],
      ["uastc_bc7.wasm", "wasm/uastc_bc7.wasm"],
      ["uastc_r8_unorm.wasm", "wasm/uastc_r8_unorm.wasm"],
      ["uastc_rg8_unorm.wasm", "wasm/uastc_rg8_unorm.wasm"],
      ["uastc_rgba8_srgb_v2.wasm", "wasm/uastc_rgba8_srgb_v2.wasm"],
      ["uastc_rgba8_unorm_v2.wasm", "wasm/uastc_rgba8_unorm_v2.wasm"],
      ["zstddec.wasm", "wasm/zstddec.wasm"],
    ],
  },
  {
    // The classic-script build: it declares the `MeshoptDecoder` global Lite's loader reads.
    name: "meshoptimizer",
    version: "1.3.0",
    repository: "https://github.com/zeux/meshoptimizer",
    copyright: "Copyright (c) 2016-2026 Arseny Kapoulkine",
    licenseFrom: "LICENSE.md",
    noticeFrom: null,
    files: [["meshopt_decoder.js", "meshopt_decoder.cjs"]],
  },
];

/**
 * Source edits applied to a vendored script, as `[exact upstream text, replacement]` pairs.
 *
 * `msc_basis_transcoder.js` is an Emscripten build with embind, which generates functions from
 * strings: `createNamedFunction` (while the module initialises), `craftEmvalAllocator`,
 * `craftInvokerFunction` (every bound C++ function) and `__emval_get_method_caller` (every JS method
 * the WASM calls), the last two through `new_(Function, …)`. A packaged game's
 * `script-src 'self' 'wasm-unsafe-eval'` refuses all four (`EvalError`), and every ETC1S
 * texture goes through this transcoder, so without the edit ETC1S
 * cannot load in a game (UASTC to ASTC or BC7 does not use it). Each is replaced by a closure that
 * does the same thing. The script fails loudly when an upstream update changes the text, and the
 * edited file says so in its first line, as Apache-2.0 §4(b) asks of a modified file.
 */
const PATCHES: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  "msc_basis_transcoder.js": [
    [
      String.raw`return new Function("body","return function "+name+"() {\n"+'    "use strict";'+"    return body.apply(this, arguments);\n"+"};\n")(body)`,
      String.raw`return{[name]:function(){"use strict";return body.apply(this,arguments)}}[name]`,
    ],
    [
      String.raw`function craftEmvalAllocator(argCount){var argsList="";for(var i=0;i<argCount;++i){argsList+=(i!==0?", ":"")+"arg"+i}var functionBody="return function emval_allocator_"+argCount+"(constructor, argTypes, args) {\n";for(var i=0;i<argCount;++i){functionBody+="var argType"+i+" = requireRegisteredType(Module['HEAP32'][(argTypes >>> 2) + "+i+'], "parameter '+i+'");\n'+"var arg"+i+" = argType"+i+".readValueFromPointer(args);\n"+"args += argType"+i+"['argPackAdvance'];\n"}functionBody+="var obj = new constructor("+argsList+");\n"+"return __emval_register(obj);\n"+"}\n";return new Function("requireRegisteredType","Module","__emval_register",functionBody)(requireRegisteredType,Module,__emval_register)}`,
      String.raw`function craftEmvalAllocator(argCount){return function(constructor,argTypes,args){var argList=[];for(var i=0;i<argCount;++i){var argType=requireRegisteredType(Module["HEAP32"][(argTypes>>>2)+i],"parameter "+i);argList.push(argType.readValueFromPointer(args));args+=argType["argPackAdvance"]}return __emval_register(new constructor(...argList))}}`,
    ],
    [
      String.raw`function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}var returns=argTypes[0].name!=="void";var argsList="";var argsListWired="";for(var i=0;i<argCount-2;++i){argsList+=(i!==0?", ":"")+"arg"+i;argsListWired+=(i!==0?", ":"")+"arg"+i+"Wired"}var invokerFnBody="return function "+makeLegalFunctionName(humanName)+"("+argsList+") {\n"+"if (arguments.length !== "+(argCount-2)+") {\n"+"throwBindingError('function "+humanName+" called with ' + arguments.length + ' arguments, expected "+(argCount-2)+" args!');\n"+"}\n";if(needsDestructorStack){invokerFnBody+="var destructors = [];\n"}var dtorStack=needsDestructorStack?"destructors":"null";var args1=["throwBindingError","invoker","fn","runDestructors","retType","classParam"];var args2=[throwBindingError,cppInvokerFunc,cppTargetFunc,runDestructors,argTypes[0],argTypes[1]];if(isClassMethodFunc){invokerFnBody+="var thisWired = classParam.toWireType("+dtorStack+", this);\n"}for(var i=0;i<argCount-2;++i){invokerFnBody+="var arg"+i+"Wired = argType"+i+".toWireType("+dtorStack+", arg"+i+"); // "+argTypes[i+2].name+"\n";args1.push("argType"+i);args2.push(argTypes[i+2])}if(isClassMethodFunc){argsListWired="thisWired"+(argsListWired.length>0?", ":"")+argsListWired}invokerFnBody+=(returns?"var rv = ":"")+"invoker(fn"+(argsListWired.length>0?", ":"")+argsListWired+");\n";if(needsDestructorStack){invokerFnBody+="runDestructors(destructors);\n"}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){var paramName=i===1?"thisWired":"arg"+(i-2)+"Wired";if(argTypes[i].destructorFunction!==null){invokerFnBody+=paramName+"_dtor("+paramName+"); // "+argTypes[i].name+"\n";args1.push(paramName+"_dtor");args2.push(argTypes[i].destructorFunction)}}}if(returns){invokerFnBody+="var ret = retType.fromWireType(rv);\n"+"return ret;\n"}else{}invokerFnBody+="}\n";args1.push(invokerFnBody);var invokerFunction=new_(Function,args1).apply(null,args2);return invokerFunction}`,
      String.raw`function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}var returns=argTypes[0].name!=="void";var expected=argCount-2;var firstArg=isClassMethodFunc?1:0;return function(){if(arguments.length!==expected){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expected+" args!")}var destructors=needsDestructorStack?[]:null;var wired=[];if(isClassMethodFunc){wired.push(argTypes[1].toWireType(destructors,this))}for(var i=0;i<expected;++i){wired.push(argTypes[i+2].toWireType(destructors,arguments[i]))}var rv=cppInvokerFunc.apply(null,[cppTargetFunc].concat(wired));if(needsDestructorStack){runDestructors(destructors)}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(i===1?wired[0]:wired[firstArg+i-2])}}}if(returns){return argTypes[0].fromWireType(rv)}}}`,
    ],
    [
      String.raw`function __emval_get_method_caller(argCount,argTypes){var types=__emval_lookupTypes(argCount,argTypes);var retType=types[0];var signatureName=retType.name+"_$"+types.slice(1).map(function(t){return t.name}).join("_")+"$";var params=["retType"];var args=[retType];var argsList="";for(var i=0;i<argCount-1;++i){argsList+=(i!==0?", ":"")+"arg"+i;params.push("argType"+i);args.push(types[1+i])}var functionName=makeLegalFunctionName("methodCaller_"+signatureName);var functionBody="return function "+functionName+"(handle, name, destructors, args) {\n";var offset=0;for(var i=0;i<argCount-1;++i){functionBody+="    var arg"+i+" = argType"+i+".readValueFromPointer(args"+(offset?"+"+offset:"")+");\n";offset+=types[i+1]["argPackAdvance"]}functionBody+="    var rv = handle[name]("+argsList+");\n";for(var i=0;i<argCount-1;++i){if(types[i+1]["deleteObject"]){functionBody+="    argType"+i+".deleteObject(arg"+i+");\n"}}if(!retType.isVoid){functionBody+="    return retType.toWireType(destructors, rv);\n"}functionBody+="};\n";params.push(functionBody);var invokerFunction=new_(Function,params).apply(null,args);return __emval_addMethodCaller(invokerFunction)}`,
      String.raw`function __emval_get_method_caller(argCount,argTypes){var types=__emval_lookupTypes(argCount,argTypes);var retType=types[0];return __emval_addMethodCaller(function(handle,name,destructors,args){var argList=[];var offset=0;for(var i=0;i<argCount-1;++i){argList.push(types[i+1].readValueFromPointer(args+offset));offset+=types[i+1]["argPackAdvance"]}var rv=handle[name].apply(handle,argList);for(var i=0;i<argCount-1;++i){if(types[i+1]["deleteObject"]){types[i+1].deleteObject(argList[i])}}if(!retType.isVoid){return retType.toWireType(destructors,rv)}})}`,
    ],
  ],
};

/** The first line of a script {@link PATCHES} edited. */
const PATCHED_HEADER =
  "/* Modified by ignifx (scripts/vendor-decoders.ts): embind's `new Function` code generation " +
  "replaced with closures so the script runs without 'unsafe-eval'. */\n";

/**
 * Applies the {@link PATCHES} for one file.
 *
 * @param file - The absolute path of a copied script.
 * @param name - Its served name.
 * @returns A note for `vendored.json`, or `null` when the file has no patches.
 * @throws Error when an upstream text is not found exactly once.
 */
function applyPatches(file: string, name: string): string | null {
  const patches = PATCHES[name];
  if (patches === undefined) {
    return null;
  }
  let text = readFileSync(file, "utf8");
  for (const [find, replace] of patches) {
    const count = text.split(find).length - 1;
    if (count !== 1) {
      throw new Error(`${name}: expected the patched text once, found it ${String(count)} times`);
    }
    text = text.replace(find, () => replace);
  }
  writeFileSync(file, PATCHED_HEADER + text, "utf8");
  return `patched: ${String(patches.length)} embind code generators replaced with closures`;
}

/**
 * A file-system-safe stem for a package name: `@babylonjs/ktx2decoder` → `babylonjs-ktx2decoder`.
 * The two Babylon packages would collide, so a scope keeps a marker.
 *
 * @param name - The npm name.
 * @returns The stem.
 */
function stemOf(name: string): string {
  return name.startsWith("@") ? `scoped-${name.slice(1).replace("/", "-")}` : name;
}

/**
 * Downloads and unpacks one tarball.
 *
 * @param source - The package to fetch.
 * @param workDirectory - A scratch directory.
 * @returns The unpacked `package/` directory and the tarball's integrity.
 */
function unpack(source: Source, workDirectory: string): { readonly directory: string; readonly integrity: string } {
  const destination = path.join(workDirectory, stemOf(source.name));
  mkdirSync(destination, { recursive: true });
  const output = execFileSync(
    "npm",
    ["pack", `${source.name}@${source.version}`, "--json", "--pack-destination", destination],
    { encoding: "utf8" },
  );
  const parsed: unknown = JSON.parse(output);
  const record: unknown = Array.isArray(parsed) ? parsed[0] : null;
  if (!isRecord(record) || typeof record["filename"] !== "string" || typeof record["integrity"] !== "string") {
    throw new Error(`npm pack ${source.name}@${source.version} printed no filename and integrity`);
  }
  execFileSync("tar", ["-xzf", path.join(destination, record["filename"]), "-C", destination]);
  return { directory: path.join(destination, "package"), integrity: record["integrity"] };
}

/**
 * Reads the `license` field of an unpacked package.
 *
 * @param directory - The unpacked `package/` directory.
 * @returns The SPDX expression.
 */
function licenseOf(directory: string): string {
  const manifest: unknown = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  if (!isRecord(manifest) || typeof manifest["license"] !== "string") {
    throw new Error(`${directory}/package.json has no license field`);
  }
  return manifest["license"];
}

/**
 * Removes a trailing `//# sourceMappingURL=` line. The maps are not vendored, so the comment would
 * only make a dev server and the browser's developer tools ask for a file that is not there.
 *
 * @param file - The absolute path of a copied script.
 */
function dropSourceMapComment(file: string): void {
  const text = readFileSync(file, "utf8");
  const stripped = text.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/u, "\n");
  if (stripped !== text) {
    writeFileSync(file, stripped, "utf8");
  }
}

/**
 * Copies one package's files and describes them.
 *
 * @param source - The package.
 * @param workDirectory - A scratch directory.
 * @param target - The absolute vendored directory.
 * @returns The component record.
 */
function vendor(source: Source, workDirectory: string, target: string): VendoredComponent {
  const { directory, integrity } = unpack(source, workDirectory);
  const stem = stemOf(source.name);
  const licenseFile = `${stem}.LICENSE.md`;
  copyFileSync(path.join(directory, source.licenseFrom), path.join(target, licenseFile));
  let noticeFile: string | null = null;
  if (source.noticeFrom !== null) {
    noticeFile = `${stem}.NOTICE.md`;
    copyFileSync(path.join(directory, source.noticeFrom), path.join(target, noticeFile));
  }
  const files = source.files.map(([file, from]) => {
    copyFileSync(path.join(directory, from), path.join(target, file));
    if (file.endsWith(".js")) {
      dropSourceMapComment(path.join(target, file));
    }
    const note = applyPatches(path.join(target, file), file);
    return {
      file,
      from,
      sha256: sha256Of(readFileSync(path.join(target, file))),
      ...(note === null ? {} : { note }),
    };
  });
  return {
    name: source.name,
    version: source.version,
    integrity,
    license: licenseOf(directory),
    repository: source.repository,
    copyright: source.copyright,
    licenseFile,
    noticeFile,
    files,
  };
}

/**
 * Runs the refresh.
 *
 * @returns The process exit code.
 */
function main(): number {
  const parsed = parseArguments(process.argv.slice(2), ["root"]);
  const root = path.resolve(parsed.options.get("root") ?? repositoryRoot(import.meta.url));
  const target = path.join(root, TARGET);
  const workDirectory = mkdtempSync(path.join(tmpdir(), "ignifx-decoders-"));
  try {
    mkdirSync(target, { recursive: true });
    const manifest: VendoredManifest = {
      components: SOURCES.map((source) => vendor(source, workDirectory, target)),
    };
    writeGeneratedFile(path.join(target, VENDORED_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    const count = manifest.components.reduce((total, component) => total + component.files.length, 0);
    log(`vendor:decoders — ${String(count)} files from ${String(SOURCES.length)} packages into ${TARGET}`);
    return 0;
  } catch (error) {
    logError(`vendor:decoders — ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

process.exitCode = main();
