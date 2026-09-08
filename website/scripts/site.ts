/**
 * The Vite plugin that turns this package into a prerendered static site.
 *
 * `vite build` is the first step of the one build command (`08-execution.md` §4.1): it empties
 * `dist/`, writes every page, `404.html`, `sitemap.xml`, `_headers`, `_redirects` and the fonts, and
 * then the examples build and the template builds add `dist/examples/**` with `emptyOutDir: false`.
 * There is **no HTML entry**: the plugin writes every page in `generateBundle`, so Vite's HTML
 * pipeline — and the inline module-preload polyfill it injects, which `script-src` would refuse —
 * never runs.
 *
 * The build fails, in production, when the tree cannot back what a page says: a catalogue entry
 * without a directory, a first source file or all three posters; a recipe with no guide group; a
 * missing `ATTRIBUTION.md`; a press file the page lists. Under `vite build --mode development`
 * those are warnings, so the site can be worked on while the examples and press kits are still
 * being produced.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CATALOGUE } from "../examples/catalogue.ts";
import { site } from "../site.config.ts";
import { checkCatalogue } from "./examples.ts";
import { fontFaceCss, loadFonts } from "./fonts.ts";
import { renderHeaders, renderRedirects } from "./headers.ts";
import { createCodeHighlighter } from "./highlight.ts";
import { renderDocument, SITE_ORIGIN } from "./layout.ts";
import {
  browserSupportPage,
  docsPage,
  gettingStartedPage,
  guidePage,
  guidesIndexPage,
  notFoundPage,
} from "./pages-docs.ts";
import { attributionPage, ATTRIBUTION_FILE, examplePage, examplesIndexPage } from "./pages-examples.ts";
import { featuresPage } from "./pages-features.ts";
import { homePage } from "./pages-home.ts";
import { pressPage } from "./pages-press.ts";
import { missingPressFiles, pressScreenshots } from "./press-files.ts";
import { readGuides, ungroupedRecipes } from "./repo-content.ts";
import { llmsUrls, repoPathOf } from "./skill-tree.ts";
import type { Assets } from "./layout.ts";
import type { Plugin } from "vite";

/** A route and the document to write for it. */
interface Emitted {
  /** The route, used by the sitemap. */
  readonly route: string;
  /** The path inside `dist`. */
  readonly fileName: string;
  /** The document text. */
  readonly html: string;
}

/**
 * Maps a route to the file that serves it. Cloudflare Pages serves `dist/features/index.html` at
 * `/features/`.
 *
 * @param route - The route.
 * @returns The path inside `dist`.
 */
export function fileNameForRoute(route: string): string {
  if (route === "/") {
    return "index.html";
  }
  const trimmed = route.replace(/^\//u, "");
  return trimmed.endsWith("/") ? `${trimmed}index.html` : `${trimmed}.html`;
}

/**
 * Renders `sitemap.xml`.
 *
 * @param routes - Every route, in emission order.
 * @returns The XML text.
 */
function sitemap(routes: readonly string[]): string {
  const entries = routes.map((route) => `  <url><loc>${SITE_ORIGIN}${route}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/**
 * Creates the plugin.
 *
 * @param repositoryRoot - Absolute path to the repository root.
 * @param websiteRoot - Absolute path to `website/`.
 * @returns The Vite plugin.
 */
export function ignifxSite(repositoryRoot: string, websiteRoot: string): Plugin {
  let strict = true;
  return {
    name: "ignifx-site",
    apply: "build",
    // After `vite:css-post`, which emits the stylesheet asset in its own `generateBundle`.
    enforce: "post",
    configResolved(config): void {
      strict = config.mode === "production";
    },
    async generateBundle(_options, bundle): Promise<void> {
      const highlighter = await createCodeHighlighter();
      const guides = readGuides(repositoryRoot);

      /**
       * Reports one problem: fatally in production, as a warning while the site is being built.
       *
       * @param message - What is wrong and how to fix it.
       */
      const complain = (message: string): void => {
        if (strict) {
          this.error(`ignifx-site: ${message}`);
        } else {
          this.warn(`ignifx-site: ${message} (a production build fails here)`);
        }
      };

      const ungrouped = ungroupedRecipes(repositoryRoot);
      if (ungrouped.length > 0) {
        this.error(
          `ignifx-site: recipes with no guide group: ${ungrouped.join(", ")}. Add them to GUIDE_GROUPS in scripts/repo-content.ts.`,
        );
      }
      for (const problem of checkCatalogue(repositoryRoot, websiteRoot)) {
        complain(`example "${problem.slug}": ${problem.message}`);
      }
      // The `_headers` rule that relaxes `style-src` for the example frames is `/examples/*run/`,
      // because Cloudflare allows one splat per pattern. A slug ending in `run` would be caught by
      // it and would lose the site's strict policy.
      for (const entry of CATALOGUE) {
        if (entry.slug.endsWith("run")) {
          this.error(
            `ignifx-site: the slug "${entry.slug}" ends in "run", which the /examples/*run/ headers rule would match. Rename it.`,
          );
        }
      }

      // Rollup has named the hashed entry and stylesheet by now; find them by shape rather than by
      // guessing at Vite's naming, which changes between majors.
      let scriptUrl = "";
      let cssUrl = "";
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk" && chunk.isEntry && chunk.name === "main") {
          scriptUrl = `/${fileName}`;
        }
        if (chunk.type === "asset" && fileName.endsWith(".css")) {
          cssUrl = `/${fileName}`;
        }
      }
      if (scriptUrl === "" || cssUrl === "") {
        this.error(
          `ignifx-site: the main entry chunk or the stylesheet is missing from the bundle (${Object.keys(bundle).join(", ")}).`,
        );
      }

      const fonts = loadFonts(websiteRoot);
      for (const font of fonts) {
        this.emitFile({ type: "asset", fileName: font.fileName, source: font.bytes });
        this.emitFile({
          type: "asset",
          fileName: `licenses/${font.font.slug}-OFL.txt`,
          source: font.license,
        });
      }

      // Rendered first, because rendering is what fills the highlighter's class table.
      const documents: Emitted[] = [];
      const assetsPlaceholder: Assets = {
        css: cssUrl,
        codeCss: "%%GENERATED_CSS%%",
        script: scriptUrl,
        preloadFonts: fonts.filter((font) => font.font.preload).map((font) => font.url),
      };

      /**
       * Queues one document.
       *
       * @param route - The route.
       * @param title - The complete `<title>`.
       * @param description - The meta description.
       * @param main - The `<main>` contents.
       * @param bodyClass - Optional `<body>` class.
       */
      const add = (route: string, title: string, description: string, main: string, bodyClass?: string): void => {
        documents.push({
          route,
          fileName: fileNameForRoute(route),
          html: renderDocument({
            route,
            title,
            description,
            main,
            assets: assetsPlaceholder,
            ...(bodyClass === undefined ? {} : { bodyClass }),
          }),
        });
      };

      add(
        "/",
        "ignifx · The TypeScript game engine for WebGPU",
        "Build 2D and 3D games in TypeScript and ship them to any modern browser and the desktop. Open source, WebGPU-only, batteries included.",
        homePage(repositoryRoot, websiteRoot, highlighter),
        "page-home",
      );
      add(
        "/features/",
        "Features · ignifx",
        "The complete list of what ignifx does: rendering, physics, 2D, 3D, input, audio, UI, desktop, devtools, tooling, and headless testing.",
        featuresPage(),
      );
      add(
        "/examples/",
        "Examples · ignifx",
        "Runnable ignifx examples: rendering, post-processing, lighting, glTF models, 2D, physics, gameplay, input, audio and UI, each with its source code.",
        examplesIndexPage(websiteRoot),
      );
      for (const entry of CATALOGUE) {
        const guide = guides.find((candidate) => candidate.name === entry.guide);
        add(
          `/examples/${entry.slug}/`,
          `${entry.title} · ignifx examples`,
          entry.line,
          examplePage(repositoryRoot, websiteRoot, entry, highlighter, guide?.route ?? null),
        );
      }
      const attribution = attributionPage(repositoryRoot, highlighter);
      if (!attribution.found) {
        complain(`${ATTRIBUTION_FILE} does not exist, so the attribution page cannot credit the sample assets.`);
      }
      add(
        "/examples/attribution/",
        "Example asset credits · ignifx",
        "Every sample asset the ignifx examples load, with its author, licence and source.",
        attribution.html,
      );
      add(
        "/docs/",
        "Docs · ignifx",
        "Getting started, guides, the API reference, templates and browser support for ignifx.",
        docsPage(guides),
      );
      add(
        "/docs/getting-started/",
        "Getting started · ignifx",
        "Install ignifx, pick a template, and run your first game in the browser or on the desktop.",
        gettingStartedPage(highlighter),
      );
      add(
        "/docs/guides/",
        "Guides · ignifx",
        `The ${String(guides.length)} ignifx guides: one task each, with code the engine's documentation checks compile and run.`,
        guidesIndexPage(guides),
      );
      for (const guide of guides) {
        add(
          guide.route,
          `${guide.title} · ignifx guides`,
          guide.line === "" ? `An ignifx guide: ${guide.title}.` : guide.line,
          guidePage(guide, guides, highlighter),
        );
      }
      add(
        "/docs/browser-support/",
        "Browser support · ignifx",
        "ignifx runs on WebGPU. Which browsers have it, how to enable it, and how to check.",
        browserSupportPage(),
      );

      // The press page is rendered last, because it is the one page whose content comes from another
      // owner's directory (`08-execution.md` §5) and the build reports what is not there yet.
      const missingPress = missingPressFiles(websiteRoot);
      if (missingPress.length > 0) {
        complain(
          `the press kit is missing ${String(missingPress.length)} file(s) the page lists: ${missingPress.join(", ")}.`,
        );
      }
      if (pressScreenshots(websiteRoot).length === 0) {
        // A warning, not a failure: the six captures come from the visual suite once the examples
        // exist (`05-press-kit.md` §5), and the page reads the directory rather than naming them.
        this.warn(
          "ignifx-site: website/public/press/screenshots/ holds no PNG, so the press page shows no screenshot.",
        );
      }
      add(
        "/press/",
        "Press kit · ignifx",
        "Boilerplate, logos, badges, screenshots and usage rules for writing about ignifx or showing that your game runs on it.",
        pressPage(websiteRoot, highlighter),
      );

      const notFound = renderDocument({
        route: "/404.html",
        title: "Page not found · ignifx",
        description: "That ignifx page does not exist. Home, features, examples, docs and the press kit still work.",
        main: notFoundPage(),
        assets: assetsPlaceholder,
      });

      const generatedCss = fontFaceCss(fonts) + highlighter.stylesheet();
      const generatedName = `assets/generated-${createHash("sha256").update(generatedCss).digest("hex").slice(0, 8)}.css`;
      this.emitFile({ type: "asset", fileName: generatedName, source: generatedCss });

      for (const document of documents) {
        this.emitFile({
          type: "asset",
          fileName: document.fileName,
          source: document.html.replaceAll("%%GENERATED_CSS%%", `/${generatedName}`),
        });
      }
      this.emitFile({
        type: "asset",
        fileName: "404.html",
        source: notFound.replaceAll("%%GENERATED_CSS%%", `/${generatedName}`),
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: sitemap(documents.map((document) => document.route)),
      });
      this.emitFile({ type: "asset", fileName: "_headers", source: renderHeaders(websiteRoot) });
      this.emitFile({ type: "asset", fileName: "_redirects", source: renderRedirects(repositoryRoot, websiteRoot) });

      // The contract with `pnpm docs:llms` since ADR-0020: every URL it publishes is an absolute
      // link to a file that exists in the working tree, not a page on this site.
      const llms = readFileSync(path.join(websiteRoot, "public", "llms.txt"), "utf8");
      const urls = llmsUrls(llms);
      const broken: string[] = [];
      for (const url of urls) {
        const repoPath = repoPathOf(url, site.blob);
        if (repoPath === null) {
          broken.push(`${url} (not a ${site.blob} URL)`);
        } else if (!existsSync(path.join(repositoryRoot, repoPath))) {
          broken.push(`${url} (no file at ${repoPath})`);
        }
      }
      if (urls.length === 0 || broken.length > 0) {
        this.error(
          `ignifx-site: website/public/llms.txt publishes ${String(broken.length)} URL(s) that do not resolve to a repository file: ${broken.join(", ")}. Run \`pnpm docs:llms\`.`,
        );
      }

      this.info(
        `ignifx-site: ${String(documents.length + 1)} pages, ${String(CATALOGUE.length)} examples, ${String(guides.length)} guides.`,
      );
    },
  };
}
