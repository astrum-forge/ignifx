import corePackage from "@ignifx/core/package.json" with { type: "json" };

/**
 * The engine version the tests' hosts run: `@ignifx/core`'s own `package.json` version, which is
 * what the Vite plugin reads from a project and what a stamped core reports as `VERSION`. Tests read
 * it here rather than writing a number, so a release does not break them.
 */
export const ENGINE_VERSION: string = corePackage.version;
