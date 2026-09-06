// Search over the skill pages, from an index the build writes to `/search-index.js`.
//
// The index is loaded on demand by appending a `<script>` element, not by `fetch`: the site's
// Content-Security-Policy sets `connect-src 'none'`, so the page makes no network requests of its
// own — a script element is governed by `script-src 'self'` and is exactly what "no requests off
// this origin" is meant to allow. The dialog itself is built here rather than shipped in every
// page's HTML, because 55 pages should not each carry a search panel they may never open.

/** One indexed page. Field names are short because the index ships as JSON. */
interface SearchEntry {
  /** The route. */
  readonly u: string;
  /** The page title. */
  readonly t: string;
  /** The section label. */
  readonly s: string;
  /** The lead sentence. */
  readonly d: string;
  /** Heading text and slug pairs. */
  readonly h: readonly (readonly [string, string])[];
}

/** One hit, with the heading that matched when it was a heading and not the title. */
interface Hit {
  /** The page. */
  readonly entry: SearchEntry;
  /** The URL to open, which may carry a heading anchor. */
  readonly href: string;
  /** The line shown under the title. */
  readonly detail: string;
  /** Lower is better. */
  readonly rank: number;
}

/** Most results shown at once. */
const MAX_HITS = 12;

declare global {
  interface Window {
    /** Written by `/search-index.js`, which the dialog loads the first time it opens. */
    ignifxSearchIndex?: readonly SearchEntry[];
  }
}

let indexPromise: Promise<readonly SearchEntry[]> | null = null;
let dialog: HTMLDialogElement | null = null;

/**
 * Loads `/search-index.js` once.
 *
 * @returns The indexed pages, or an empty list when the script fails to load.
 */
function loadIndex(): Promise<readonly SearchEntry[]> {
  indexPromise ??= new Promise<readonly SearchEntry[]>((resolve) => {
    const existing = window.ignifxSearchIndex;
    if (existing !== undefined) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = "/search-index.js";
    script.addEventListener("load", () => {
      resolve(window.ignifxSearchIndex ?? []);
    });
    script.addEventListener("error", () => {
      resolve([]);
    });
    document.head.append(script);
  });
  return indexPromise;
}

/** Starts loading the index before the dialog is opened. */
export function prefetchSearch(): void {
  void loadIndex();
}

/**
 * Ranks one page against a lower-cased query.
 *
 * @param entry - The page.
 * @param query - The lower-cased query.
 * @returns The hit, or `null` when nothing matched.
 */
function match(entry: SearchEntry, query: string): Hit | null {
  const title = entry.t.toLowerCase();
  if (title.startsWith(query)) {
    return { entry, href: entry.u, detail: entry.d, rank: 0 };
  }
  if (title.includes(query)) {
    return { entry, href: entry.u, detail: entry.d, rank: 1 };
  }
  for (const [text, id] of entry.h) {
    if (text.toLowerCase().includes(query)) {
      return { entry, href: `${entry.u}#${id}`, detail: text, rank: 2 };
    }
  }
  if (entry.d.toLowerCase().includes(query)) {
    return { entry, href: entry.u, detail: entry.d, rank: 3 };
  }
  return null;
}

/**
 * Renders the result list.
 *
 * @param list - The `<ul>` to fill.
 * @param hits - The hits, already ranked.
 * @param query - The query, for the empty state.
 */
function paintResults(list: HTMLUListElement, hits: readonly Hit[], query: string): void {
  list.replaceChildren();
  if (hits.length === 0) {
    const empty = document.createElement("li");
    empty.className = "search-empty";
    empty.textContent = query === "" ? "Type to search the skill." : `Nothing matches “${query}”.`;
    list.append(empty);
    return;
  }
  for (const hit of hits) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "search-hit";
    link.href = hit.href;
    const section = document.createElement("span");
    section.className = "search-section";
    section.textContent = hit.entry.s;
    const title = document.createElement("span");
    title.className = "search-title";
    title.textContent = hit.entry.t;
    const detail = document.createElement("span");
    detail.className = "search-detail";
    detail.textContent = hit.detail;
    link.append(section, title, detail);
    item.append(link);
    list.append(item);
  }
}

/**
 * Builds the dialog once.
 *
 * @returns The dialog, its input, and its result list.
 */
function buildDialog(): {
  readonly node: HTMLDialogElement;
  readonly input: HTMLInputElement;
  readonly list: HTMLUListElement;
} {
  const node = document.createElement("dialog");
  node.className = "search";
  node.setAttribute("aria-label", "Search the skill");

  const form = document.createElement("form");
  form.className = "search-form";
  form.method = "dialog";

  const label = document.createElement("label");
  label.className = "search-label";
  label.htmlFor = "search-input";
  label.textContent = "Search the skill";

  const input = document.createElement("input");
  input.className = "search-input";
  input.id = "search-input";
  input.type = "search";
  input.autocomplete = "off";
  input.placeholder = "Component, IGX code, heading…";

  const close = document.createElement("button");
  close.className = "search-close";
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    node.close();
  });

  const list = document.createElement("ul");
  list.className = "search-results";

  form.append(label, input, close);
  node.append(form, list);
  document.body.append(node);

  node.addEventListener("click", (event: MouseEvent) => {
    if (event.target === node) {
      node.close();
    }
  });
  return { node, input, list };
}

/**
 * Opens the search dialog, loading the index the first time.
 */
export async function openSearch(): Promise<void> {
  const parts = dialog === null ? buildDialog() : null;
  if (parts !== null) {
    dialog = parts.node;
    const entries = await loadIndex();
    const update = (): void => {
      const query = parts.input.value.trim().toLowerCase();
      const hits =
        query.length < 2
          ? []
          : entries
              .map((entry) => match(entry, query))
              .filter((hit): hit is Hit => hit !== null)
              .toSorted((left, right) => left.rank - right.rank || left.entry.t.localeCompare(right.entry.t))
              .slice(0, MAX_HITS);
      paintResults(parts.list, hits, query);
    };
    parts.input.addEventListener("input", update);
    update();
  }
  dialog?.showModal();
  dialog?.querySelector("input")?.focus();
}
