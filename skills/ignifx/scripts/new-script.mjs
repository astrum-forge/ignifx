#!/usr/bin/env node
// Scaffolds an ignifx Script class: a `Script.define({...})` subclass with a namespaced typeId and
// an `update` stub, written to <dir>/<kebab-name>.ts. Node ESM, no dependencies.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const USAGE = `Usage: node new-script.mjs <Name> [--namespace <ns>] [--dir <dir>]

Scaffolds <dir>/<kebab-name>.ts holding a Script class with a schema, a namespaced typeId, and an
update stub. Refuses to overwrite an existing file.

  <Name>              PascalCase class name, e.g. PlayerController
  --namespace <ns>    typeId namespace (default: mygame) -> "<ns>/<Name>"
  --dir <dir>         output directory (default: src/scripts)
  --help              show this message`;

/**
 * Parses the command line.
 * @param argv - Arguments after the script path.
 * @returns The resolved `name`, `namespace`, and `dir`.
 */
function parseArgs(argv) {
  let name = "";
  let namespace = "mygame";
  let dir = path.join("src", "scripts");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--namespace" || arg === "--dir") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.startsWith("--")) {
        fail(`${arg} needs a value`);
      }
      if (arg === "--namespace") {
        namespace = value;
      } else {
        dir = value;
      }
      index += 1;
    } else if (typeof arg === "string" && arg.startsWith("--")) {
      fail(`unknown option ${arg}`);
    } else if (name === "") {
      name = arg;
    } else {
      fail(`unexpected argument ${arg}`);
    }
  }
  if (name === "") {
    fail("a class name is required");
  }
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(name)) {
    fail(`"${name}" is not a PascalCase class name`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(namespace)) {
    fail(`"${namespace}" is not a valid typeId namespace (lowercase, digits, hyphens)`);
  }
  return { name, namespace, dir };
}

/**
 * Prints a message and exits the process with a failure code; it never returns.
 * @param message - What went wrong.
 */
function fail(message) {
  process.stderr.write(`new-script: ${message}\n\n${USAGE}\n`);
  process.exit(1);
}

/**
 * Converts a PascalCase name to kebab-case for the file name (coding standards §5.1).
 * @param name - The class name.
 * @returns The kebab-case file stem.
 */
function toKebabCase(name) {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, "$1-$2")
    .toLowerCase();
}

/**
 * Renders the scaffolded module.
 * @param name - The class name.
 * @param namespace - The typeId namespace.
 * @returns The TypeScript source.
 */
function render(name, namespace) {
  return `import { Script, f32 } from "@ignifx/core";
import type { ScriptCallbacks } from "@ignifx/core";

/**
 * TODO: describe what ${name} does.
 *
 * Serialized fields are declared in the \`Script.define\` schema; ordinary class fields are
 * runtime-only. Register the class with \`app.registerComponents([${name}])\` before loading any
 * scene that uses it.
 */
export class ${name} extends Script.define({ speed: f32(1) }) implements ScriptCallbacks {
  static typeId = "${namespace}/${name}";

  /**
   * Runs once per frame while this script is effectively enabled.
   *
   * @param dt - Scaled seconds since the previous frame.
   */
  update(dt: number): void {
    this.transform.translate({ x: 0, y: 0, z: this.speed * dt });
  }
}
`;
}

const argv = process.argv.slice(2);
const wantsHelp = argv.includes("--help") || argv.includes("-h");

if (wantsHelp) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const options = parseArgs(argv);
const target = path.resolve(options.dir, `${toKebabCase(options.name)}.ts`);

mkdirSync(path.dirname(target), { recursive: true });
try {
  writeFileSync(target, render(options.name, options.namespace), { encoding: "utf8", flag: "wx" });
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "EEXIST") {
    fail(`${target} already exists; refusing to overwrite it`);
  }
  throw error;
}

process.stdout.write(`Created ${target}\n  typeId: ${options.namespace}/${options.name}\n`);
process.stdout.write(`  Next: register it — app.registerComponents([${options.name}]);\n`);
