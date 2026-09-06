/**
 * The shared page furniture: the gutter/column section, the inline Markdown subset the editorial
 * copy is written in, and the hero's frame timeline.
 *
 * The timeline is the one bold thing on the site (`DESIGN.md`, "the instrument, not the poster").
 * It is inline SVG rather than a canvas, so it is complete and correct with JavaScript off and
 * needs no fallback image; the sweeping playhead is a CSS animation that
 * `prefers-reduced-motion: reduce` switches off. It draws two real numbers and nothing invented:
 * the 16.7 ms of one frame at 60 Hz, and the median CPU frame time `benchmarks/baselines.json`
 * records for the 1,002-entity scene. The six phase blocks are drawn at equal width because the
 * repository measures no per-phase split — the caption says so.
 */
import { each, esc, h, join } from "./html.ts";
import { SITE_ORIGIN } from "./layout.ts";
import type { RepositoryFacts } from "./repo.ts";

/** One frame at 60 Hz, in milliseconds. The scale of the budget bar. */
const BUDGET_MS = 1000 / 60;

const CODE_SPAN = /`([^`]+)`/gu;
const BOLD_SPAN = /\*\*([^*]+)\*\*/gu;
/** `<kbd>` is the one tag the repository's own Markdown uses in prose, and it survives escaping. */
const KBD_SPAN = /&lt;kbd&gt;(.*?)&lt;\/kbd&gt;/gu;

/**
 * Renders the tiny Markdown subset the editorial strings in `content.ts` use: `` `code` ``,
 * `**bold**`, and the `<kbd>` elements the template READMEs write into their control tables.
 * Everything is escaped first, so the source strings can hold `<` and `&` freely.
 *
 * @param text - The source text.
 * @returns HTML.
 */
export function md(text: string): string {
  return esc(text)
    .replaceAll(CODE_SPAN, "<code>$1</code>")
    .replaceAll(BOLD_SPAN, "<strong>$1</strong>")
    .replaceAll(KBD_SPAN, "<kbd>$1</kbd>");
}

/** A page section: a left gutter carrying a real identifier, and a column of content. */
export interface SectionInput {
  /** The `id` and anchor target. */
  readonly id: string;
  /** The gutter label — a package name, an error code, a measurement. Never a sequence number. */
  readonly gutter: string;
  /** The `<h2>` text. */
  readonly title: string;
  /** Optional lead paragraph, in the {@link md} subset. */
  readonly lead?: string;
  /** The section body HTML. */
  readonly body: string;
}

/**
 * Renders one section.
 *
 * @param input - Its id, gutter label, heading, and body.
 * @returns The `<section>` HTML.
 */
export function section(input: SectionInput): string {
  return h("section", { class: "band", id: input.id }, [
    h("p", { class: "gutter" }, md(input.gutter)),
    h("div", { class: "band-body" }, [
      h("h2", { class: "band-title" }, md(input.title)),
      input.lead === undefined ? "" : h("p", { class: "band-lead" }, md(input.lead)),
      input.body,
    ]),
  ]);
}

/**
 * Renders a labelled measurement, the site's one decorative-looking element that is actually data.
 *
 * @param value - The number, already formatted.
 * @param unit - Its unit, or an empty string.
 * @param label - What was measured.
 * @param source - The repository file the number comes from.
 * @returns The figure HTML.
 */
export function measure(value: string, unit: string, label: string, source: string): string {
  return h("div", { class: "measure" }, [
    h("p", { class: "measure-value" }, [
      esc(value),
      unit === "" ? "" : h("span", { class: "measure-unit" }, esc(unit)),
    ]),
    h("p", { class: "measure-label" }, md(label)),
    h("p", { class: "measure-source" }, esc(source)),
  ]);
}

/**
 * Renders the frame timeline.
 *
 * @param facts - The measured numbers, read from the repository.
 * @returns The `<figure>` holding the SVG, its caption, and the phase list.
 */
export function frameTimeline(facts: RepositoryFacts): string {
  const left = 44;
  const right = 924;
  const span = right - left;
  const measured = facts.thousandEntityMs;
  const measuredWidth = Math.max(3, (span * measured) / BUDGET_MS);

  const ticks = each(
    Array.from({ length: 17 }, (_, index) => index),
    (millisecond) => {
      const x = left + (span * millisecond) / BUDGET_MS;
      const major = millisecond % 4 === 0;
      return join(
        h("line", { class: major ? "tick tick-major" : "tick", x1: x, x2: x, y1: 76, y2: major ? 90 : 84 }),
        major ? h("text", { class: "tick-label", x, y: 104, "text-anchor": "middle" }, String(millisecond)) : null,
      );
    },
  );

  const gap = 8;
  const blockWidth = (span - gap * (facts.phases.length - 1)) / facts.phases.length;
  const blocks = each(facts.phases, (phase, index) => {
    const x = left + index * (blockWidth + gap);
    return h("g", { class: "phase" }, [
      h("rect", { class: "phase-box", x, y: 150, width: blockWidth, height: 46, rx: 1 }),
      h("text", { class: "phase-ordinal", x: x + 8, y: 168 }, String(phase.ordinal)),
      h("text", { class: "phase-name", x: x + 8, y: 188 }, esc(phase.name)),
    ]);
  });

  const svg = h(
    "svg",
    {
      class: "frame-svg",
      viewBox: "0 0 968 244",
      role: "img",
      "aria-label": `One frame at 60 Hz is ${BUDGET_MS.toFixed(1)} milliseconds. The 1,002-entity benchmark scene spends ${String(measured)} of them in the whole six-phase scheduler. The phases run in order: ${facts.phases.map((phase) => phase.name).join(", ")}.`,
    },
    [
      h("rect", { class: "budget", x: left, y: 44, width: span, height: 26, rx: 1 }),
      h("rect", { class: "budget-used", x: left, y: 44, width: measuredWidth, height: 26 }),
      h(
        "text",
        { class: "budget-label", x: right, y: 34, "text-anchor": "end" },
        `${BUDGET_MS.toFixed(1)} ms — one frame at 60 Hz`,
      ),
      h("text", { class: "budget-used-label", x: left, y: 34 }, `${String(measured)} ms measured`),
      ticks,
      h("text", { class: "tick-unit", x: left + span / 2, y: 122, "text-anchor": "middle" }, "milliseconds"),
      h("path", {
        class: "leader",
        d: `M ${String(left)} 72 L ${String(left)} 150 M ${String(left + measuredWidth)} 72 L ${String(right)} 150`,
      }),
      blocks,
      h("rect", { class: "playhead", x: left, y: 146, width: 2, height: 54 }),
    ],
  );

  // Each term/description pair is wrapped, so the grid lays out phases rather than interleaving
  // every `dt` and `dd` across the columns.
  const list = h(
    "dl",
    { class: "phase-list" },
    each(facts.phases, (phase) =>
      h("div", { class: "phase-entry" }, [
        h("dt", {}, [h("span", { class: "phase-key" }, String(phase.ordinal)), esc(phase.name)]),
        h("dd", {}, esc(phase.summary)),
      ]),
    ),
  );

  return h("figure", { class: "frame" }, [
    h("div", { class: "frame-plot" }, svg),
    h("figcaption", { class: "frame-caption" }, [
      md(
        `Phase order is fixed and every phase runs every frame; only the fixed loop and the three update callbacks pause. ` +
          `The blocks are drawn at equal width because the repository measures the scheduler as a whole, not per phase — ` +
          `${String(measured)} ms for ${facts.thousandEntityCount.toLocaleString("en-GB")} entities on ${facts.baselineMachine.split(",")[0] ?? ""}, recorded ${facts.baselineDate}.`,
      ),
    ]),
    list,
  ]);
}

/**
 * Formats a byte count as whole kilobytes.
 *
 * @param bytes - The measured bytes.
 * @returns The number of kilobytes, rounded, as a string.
 */
export function formatKilobytes(bytes: number): string {
  return String(Math.round(bytes / 1024));
}

/**
 * A link that leaves the site. Rendered with `rel="noreferrer"` so nothing about the visitor
 * reaches the destination (`CONSTITUTION.md` §9.1).
 *
 * @param href - The destination.
 * @param label - The link text, in the {@link md} subset.
 * @param className - Optional class.
 * @returns The anchor HTML.
 */
export function outbound(href: string, label: string, className?: string): string {
  return h("a", { href, rel: "noreferrer", class: className ?? null }, md(label));
}

/**
 * The canonical URL of a route, used by the sitemap.
 *
 * @param route - A site route.
 * @returns The absolute URL.
 */
export function absolute(route: string): string {
  return `${SITE_ORIGIN}${route}`;
}
