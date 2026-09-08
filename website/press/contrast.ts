/**
 * WCAG 2.1 contrast, for the badge check in `05-press-kit.md` §6.
 *
 * The site's own test (`website/test/site.test.ts`) recomputes the token pairs; the badges are not
 * tokens — they are files other people embed — so the generator checks them itself and refuses to
 * write a badge whose label fails AA.
 */

/** The minimum ratio normal-size text must clear (WCAG 2.1 success criterion 1.4.3, level AA). */
export const AA_NORMAL_TEXT = 4.5;

/**
 * Relative luminance of an `#RRGGBB` colour, per WCAG 2.1.
 *
 * @param hex - The colour, `#` plus six hex digits.
 * @returns The relative luminance, 0 to 1.
 * @throws When the string is not a six-digit hex colour.
 */
function luminance(hex: string): number {
  const match = /^#([0-9a-fA-F]{6})$/u.exec(hex);
  if (match === null) {
    throw new Error(`${hex} is not a six-digit hex colour`);
  }
  const digits = match[1] ?? "";
  let total = 0;
  const weights = [0.2126, 0.7152, 0.0722];
  for (let channel = 0; channel < 3; channel++) {
    const value = Number.parseInt(digits.slice(channel * 2, channel * 2 + 2), 16) / 255;
    const linear = value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    total += (weights[channel] ?? 0) * linear;
  }
  return total;
}

/**
 * Contrast ratio between two opaque colours.
 *
 * @param foreground - The text colour.
 * @param background - The ground behind it.
 * @returns The ratio, 1 to 21.
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
