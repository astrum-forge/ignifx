// The site's enhancement module. Every page is complete HTML before this runs: it adds the theme
// toggle, copy buttons, the WebGPU support pill, the gallery filter, the source tabs, and — only on
// a page that embeds an example — the viewer bridge, which is a separate chunk.
//
// The website is an application, not a published library, so the coding standards' rule against
// import-time side effects does not apply to this entry module; the ESLint config records the same
// exemption for `website/**`.
// This import is how Vite discovers and emits the stylesheet; there is nothing to bind to.
// oxlint-disable-next-line import/no-unassigned-import -- see above.
import "./styles/site.css";

/** Where the visitor's theme choice lives; the same key `theme.ts` reads before the first paint. */
const STORAGE_KEY = "ignifx-theme";

/** How long a copy button stays in its confirmed state. */
const COPIED_MS = 1400;

const root = document.documentElement;

/**
 * Reports the theme in force: an explicit choice if there is one, otherwise the OS preference.
 *
 * @returns `"dark"` or `"light"`.
 */
function currentTheme(): "dark" | "light" {
  const explicit = root.dataset["theme"];
  if (explicit === "dark" || explicit === "light") {
    return explicit;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Writes the toggle's accessible name. The icon itself is swapped by CSS, so the label is the only
 * thing that needs updating.
 *
 * @param toggle - The theme button.
 */
function paintToggle(toggle: HTMLButtonElement): void {
  const theme = currentTheme();
  toggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  toggle.setAttribute("aria-label", `Theme: ${theme}. Switch to ${theme === "dark" ? "light" : "dark"}.`);
}

/**
 * Wires the theme toggle.
 */
function installTheme(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (toggle === null) {
    return;
  }
  paintToggle(toggle);
  toggle.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    root.dataset["theme"] = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage is unavailable; the choice still applies for this page view.
    }
    paintToggle(toggle);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    paintToggle(toggle);
  });
}

/**
 * Puts text on the clipboard and confirms it on the button that asked.
 *
 * @param button - The button pressed.
 * @param text - What to copy.
 * @param label - The button's resting label.
 */
function copy(button: HTMLElement, text: string, label: string): void {
  const target = button.querySelector(".btn-text") ?? button;
  void navigator.clipboard.writeText(text).then(
    () => {
      target.textContent = "Copied";
      button.classList.add("is-copied");
      window.setTimeout(() => {
        target.textContent = label;
        button.classList.remove("is-copied");
      }, COPIED_MS);
    },
    () => {
      target.textContent = "Press ⌘C";
    },
  );
}

/**
 * Wires every copy button: the one on each code block, and the ones that carry their own text
 * (`data-copy-text`) for install commands and press boilerplate.
 */
function installCopyButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const label = button.textContent;
    button.addEventListener("click", () => {
      copy(button, button.closest(".code")?.querySelector("code")?.textContent ?? "", label);
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy-text]")) {
    const text = button.dataset["copyText"] ?? "";
    const label = (button.querySelector(".btn-text") ?? button).textContent;
    button.addEventListener("click", () => {
      copy(button, text, label);
    });
  }
}

/**
 * Asks for a WebGPU adapter and writes the answer into every support pill on the page.
 *
 * The pill reads "WebGPU: checking…" in the HTML, which is what a visitor with no JavaScript sees
 * and is the honest answer: the page cannot know. Colour is never the only carrier — the words
 * change with the state (`02-design-system.md` §6).
 */
function installSupportPill(): void {
  const pills = [...document.querySelectorAll<HTMLElement>("[data-support]")];
  if (pills.length === 0) {
    return;
  }

  /**
   * Paints one state onto every pill.
   *
   * @param state - Whether an adapter was found.
   */
  const paint = (state: "ok" | "warn"): void => {
    for (const pill of pills) {
      const text = pill.querySelector("[data-support-text]");
      const link = pill.querySelector<HTMLElement>("[data-support-link]");
      pill.classList.add(state === "ok" ? "is-ok" : "is-warn");
      if (text !== null) {
        text.textContent =
          state === "ok" ? "WebGPU available in this browser" : "WebGPU is not available in this browser.";
      }
      if (link !== null && state === "warn") {
        link.hidden = false;
      }
    }
  };

  // `@webgpu/types` declares `navigator.gpu` as always present, but a browser without WebGPU does
  // not have the property at all — which is the whole question this function exists to answer.
  // Widening it back is the DOM boundary that coding standards §5.2 allows an assertion at.
  const gpu = navigator.gpu as GPU | undefined;
  if (gpu === undefined) {
    paint("warn");
    return;
  }
  void gpu.requestAdapter().then(
    (adapter) => {
      paint(adapter === null ? "warn" : "ok");
    },
    () => {
      paint("warn");
    },
  );
}

/**
 * Upgrades the gallery's category chips from anchors into an in-place filter.
 *
 * The chips are real anchor links in the HTML and jump to a section without JavaScript. With it,
 * they hide the other sections and keep the URL hash in step, so a filtered view can be shared.
 */
function installFilters(): void {
  const bar = document.querySelector<HTMLElement>("[data-filters]");
  if (bar === null) {
    return;
  }
  const chips = [...bar.querySelectorAll<HTMLAnchorElement>("[data-filter]")];
  const sections = [...document.querySelectorAll<HTMLElement>("[data-category]")];

  /**
   * Shows one category, or all of them.
   *
   * @param wanted - A category id, or `"all"`.
   */
  const apply = (wanted: string): void => {
    for (const chip of chips) {
      chip.classList.toggle("is-active", (chip.dataset["filter"] ?? "") === wanted);
      if ((chip.dataset["filter"] ?? "") === wanted) {
        chip.setAttribute("aria-current", "true");
      } else {
        chip.removeAttribute("aria-current");
      }
    }
    for (const section of sections) {
      section.hidden = wanted !== "all" && (section.dataset["category"] ?? "") !== wanted;
    }
  };

  /**
   * Reads the filter out of the current URL hash.
   *
   * @returns A category id, or `"all"`.
   */
  const fromHash = (): string => {
    const hash = window.location.hash.replace(/^#/u, "");
    return chips.some((chip) => (chip.dataset["filter"] ?? "") === hash) ? hash : "all";
  };

  for (const chip of chips) {
    chip.addEventListener("click", (event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
        return;
      }
      event.preventDefault();
      const wanted = chip.dataset["filter"] ?? "all";
      const url = wanted === "all" ? window.location.pathname : `#${wanted}`;
      window.history.replaceState(null, "", url);
      apply(wanted);
    });
  }
  window.addEventListener("hashchange", () => {
    apply(fromHash());
  });
  apply(fromHash());
}

/**
 * Turns the viewer's stacked source files into a tab strip, and points Copy at the active file.
 *
 * Without JavaScript every file is on the page under its own file-name bar, which is why the tab
 * strip is `js-only` and the panes are only hidden once `data-js` is set.
 */
function installSourceTabs(): void {
  const files = [...document.querySelectorAll<HTMLElement>("[data-source-file]")];
  if (files.length === 0) {
    return;
  }
  const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-source-tab]")];

  /**
   * Activates one file.
   *
   * @param name - The file's label.
   */
  const show = (name: string): void => {
    for (const file of files) {
      file.classList.toggle("is-active", (file.dataset["sourceFile"] ?? "") === name);
    }
    for (const tab of tabs) {
      const active = (tab.dataset["sourceTab"] ?? "") === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    }
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      show(tab.dataset["sourceTab"] ?? "");
    });
  }

  const button = document.querySelector<HTMLButtonElement>("[data-source-copy]");
  if (button !== null) {
    button.addEventListener("click", () => {
      const active = files.find((file) => file.classList.contains("is-active")) ?? files[0];
      copy(button, active?.querySelector("code")?.textContent ?? "", "Copy");
    });
  }
}

installTheme();
installCopyButtons();
installSupportPill();
installFilters();
installSourceTabs();

// The bridge is only needed where an example is embedded: the home page and the viewer pages. It is
// a dynamic import so every other route pays nothing for it.
if (document.querySelector("[data-viewer]") !== null) {
  void import("./viewer.ts").then(
    (module) => {
      module.installViewers();
    },
    () => {
      // The example still runs; only Pause, Fullscreen and the metrics are lost.
    },
  );
}
