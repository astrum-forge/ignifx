/**
 * A deliberately small command-line parser for the docs scripts.
 *
 * `node:util`'s `parseArgs` would do the same job, but these scripts need only long options in the
 * two forms `--name value` and `--name=value` plus boolean flags, and a hand-rolled parser keeps
 * the return type precise (`ReadonlyMap`/`ReadonlySet`) instead of an index-signature bag.
 */

/** The result of parsing `process.argv.slice(2)`. */
export interface ParsedArguments {
  /** Boolean flags that were present, without their leading `--`. */
  readonly flags: ReadonlySet<string>;
  /** Value options that were present, keyed without their leading `--`. */
  readonly options: ReadonlyMap<string, string>;
  /** Arguments that were not options. */
  readonly positional: readonly string[];
}

/**
 * Parses long options out of an argument vector.
 *
 * @param argv - Arguments to parse, typically `process.argv.slice(2)`.
 * @param valueOptions - Names (without `--`) that take a value; anything else is a boolean flag.
 * @returns The parsed flags, options and positional arguments.
 * @throws When an option that takes a value is given without one, or an unknown `--` option appears.
 */
export function parseArguments(argv: readonly string[], valueOptions: readonly string[]): ParsedArguments {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  const positional: string[] = [];
  const takesValue = new Set(valueOptions);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    if (!takesValue.has(name)) {
      flags.add(name);
      continue;
    }
    if (separator !== -1) {
      options.set(name, argument.slice(separator + 1));
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`option --${name} needs a value`);
    }
    options.set(name, value);
    index += 1;
  }
  return { flags, options, positional };
}
