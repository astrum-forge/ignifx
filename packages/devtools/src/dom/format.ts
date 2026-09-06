/**
 * The number formatting every panel shares. Kept in one module so a readout never disagrees with
 * another about how many decimals a millisecond gets.
 */

/** The unit ladder {@link formatBytes} walks. */
const BYTE_UNITS: readonly string[] = ["B", "KiB", "MiB", "GiB"];

/** How many bytes are in the next unit up. */
const BYTE_STEP = 1024;

/**
 * Formats a millisecond count with two decimals.
 *
 * @param value - The duration in milliseconds.
 * @returns The text, for example `"16.70 ms"`.
 *
 * @internal
 */
export function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}

/**
 * Formats a byte count on the binary unit ladder.
 *
 * @param value - The size in bytes; negative means "the host does not measure this".
 * @returns The text, for example `"1.50 MiB"`, or `"-"` for a negative input.
 *
 * @internal
 */
export function formatBytes(value: number): string {
  if (value < 0) {
    return "-";
  }
  let size = value;
  let unit = 0;
  while (size >= BYTE_STEP && unit < BYTE_UNITS.length - 1) {
    size /= BYTE_STEP;
    unit += 1;
  }
  const decimals = unit === 0 ? 0 : 2;
  return `${size.toFixed(decimals)} ${BYTE_UNITS[unit] ?? "B"}`;
}

/** The thousands separator: U+2009 THIN SPACE, written as an escape so it is visible in the source. */
const THIN_SPACE = "\u2009";

/**
 * Formats an integer count with thousands separators the way every locale-independent readout in
 * this package does: a thin space, so `10000` reads as `10\u2009000` and never as a date. It is
 * deliberately not `toLocaleString`, whose separator depends on the developer's locale and would
 * make a screenshot of the Stats panel unreadable to the next person.
 *
 * @param value - The count.
 * @returns The text.
 *
 * @internal
 */
export function formatCount(value: number): string {
  const rounded = Math.round(value);
  const digits = String(Math.abs(rounded));
  let out = "";
  for (let index = 0; index < digits.length; index += 1) {
    const remaining = digits.length - index;
    out += digits[index] ?? "";
    if (remaining > 1 && remaining % 3 === 1) {
      out += THIN_SPACE;
    }
  }
  return rounded < 0 ? `-${out}` : out;
}
