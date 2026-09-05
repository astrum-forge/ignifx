/**
 * What a project hands `createApp` as its settings (`docs/architecture/04-extensions.md` §5). The
 * Vite plugin resolves `ignifx.config.ts` at build time and injects the same shape; tests and
 * Electron tooling pass it directly.
 *
 * @remarks
 * Values are `unknown` because each section is owned — and validated — by the extension that
 * registered it. A section whose schema declares exactly one field may be written as that field's
 * value (`layers: ["Default", "Ground"]`), which is the form `04-extensions.md` §5 shows.
 *
 * @example
 * ```ts
 * const app = await createApp({
 *   headless: true,
 *   settings: { layers: ["Default", "Player"], time: { fixedDeltaTime: 1 / 120 } },
 * });
 * ```
 *
 * @public
 */
export type SettingsInput = Readonly<Record<string, unknown>>;
