// The site's only ES module. Every page is complete HTML before this runs: it adds a theme toggle,
// a copy button on each code block, and a search dialog over the skill. Nothing here renders
// content, and nothing on the page waits for it.
//
// The website is an application, not a published library, so the coding standards' rule against
// import-time side effects does not apply to this entry module; the ESLint config records the same
// exemption for `website/**`.
// This import is how Vite discovers and emits the stylesheet; there is nothing to bind to.
// oxlint-disable-next-line import/no-unassigned-import -- see above.
import "./styles/site.css";
import { openSearch, prefetchSearch } from "./search.ts";

/** Where the visitor's theme choice lives; the same key `theme.ts` reads before the first paint. */
const STORAGE_KEY = "ignifx-theme";

/** How long the copy button stays in its confirmed state. */
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
 * Writes the toggle's label and pressed state.
 *
 * @param button - The toggle.
 */
function paintToggle(button: HTMLButtonElement): void {
  const theme = currentTheme();
  const label = button.querySelector("[data-theme-label]");
  if (label !== null) {
    label.textContent = theme === "dark" ? "Dark" : "Light";
  }
  button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  button.setAttribute("aria-label", `Theme: ${theme}. Switch to ${theme === "dark" ? "light" : "dark"}.`);
}

/**
 * Wires the theme toggle.
 */
function installTheme(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (button === null) {
    return;
  }
  paintToggle(button);
  button.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    root.dataset["theme"] = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage is unavailable; the choice still applies for this page view.
    }
    paintToggle(button);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    paintToggle(button);
  });
}

/**
 * Wires the copy button on every code block. The button is in the HTML already, so the layout does
 * not move when this runs.
 */
function installCopyButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    button.addEventListener("click", () => {
      const code = button.closest(".code")?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard.writeText(code).then(
        () => {
          button.textContent = "Copied";
          button.classList.add("is-copied");
          window.setTimeout(() => {
            button.textContent = "Copy";
            button.classList.remove("is-copied");
          }, COPIED_MS);
        },
        () => {
          button.textContent = "Press ⌘C";
        },
      );
    });
  }
}

/**
 * Wires the search button and the `s` shortcut.
 */
function installSearch(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-search]");
  if (button === null) {
    return;
  }
  button.addEventListener("click", () => {
    void openSearch();
  });
  button.addEventListener("pointerenter", prefetchSearch, { once: true });
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target;
    const inField =
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if (inField) {
      return;
    }
    if (event.key === "s" || event.key === "/") {
      event.preventDefault();
      void openSearch();
    }
  });
}

installTheme();
installCopyButtons();
installSearch();
