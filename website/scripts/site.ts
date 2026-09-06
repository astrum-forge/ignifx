/**
 * The Vite plugin that turns this package into a prerendered static site.
 *
 * One command builds everything (`pnpm --filter @ignifx/website build`), which is the constraint
 * Cloudflare Pages imposes: it runs `pnpm install` at the repository root, then exactly one build
 * command, then serves `website/dist` as files. So there is no second step, no server runtime, and
 * no dependency on any `@ignifx/*` package — a fresh clone has not built them.
 *
 * The plugin does four things in `generateBundle`, once Rollup has named the JavaScript and CSS:
 *
 * 1. Reads the repository (facts, the skill tree) and renders every route to `<route>/index.html`.
 * 2. Emits the generated stylesheet (fonts + Shiki token classes) and the font files.
 * 3. Emits `sitemap.xml`, `404.html`, and the on-demand search index.
 * 4. Fails the build when an `llms.txt` URL has no page, or when a page links to something that is
 *    not in the output.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fontFaceCss, loadFonts } from "./fonts.ts";
import { createCodeHighlighter } from "./highlight.ts";
import { renderDocument, SITE_ORIGIN } from "./layout.ts";
import { galleryPage, notFoundPage } from "./pages-gallery.ts";
import { docsPage, gettingStartedPage } from "./pages-guides.ts";
import { featuresPage, homePage } from "./pages.ts";
import { readFacts } from "./repo.ts";
import { renderSkillPage } from "./skill-page.ts";
import { findSkillPages, llmsRoutes } from "./skill-tree.ts";
import type { Assets } from "./layout.ts";
import type { SearchEntry } from "./skill-page.ts";
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
 * `/features/` and `dist/skill/references/gotchas.html` at `/skill/references/gotchas`.
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
  return {
    name: "ignifx-site",
    apply: "build",
    // After `vite:css-post`, which emits the stylesheet asset in its own `generateBundle`.
    enforce: "post",
    async generateBundle(_options, bundle): Promise<void> {
      const facts = readFacts(repositoryRoot);
      const pages = findSkillPages(repositoryRoot);
      const highlighter = await createCodeHighlighter();

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
      const searchIndex: SearchEntry[] = [];
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
       * @param title - The `<title>` prefix.
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
        "A code-first game engine for WebGPU",
        "ignifx is a code-first TypeScript game engine for browsers and Electron, rendering exclusively through WebGPU via Babylon Lite. Version 0.x, not yet published.",
        homePage(facts, highlighter, repositoryRoot),
        "page-home",
      );
      add(
        "/features/",
        "Features",
        "The eleven ignifx subsystems — kernel, rendering, assets, input, 3D and 2D physics, the 2D and 3D toolkits, audio, UI, Electron, devtools — with their public API names.",
        featuresPage(),
      );
      add(
        "/getting-started/",
        "Getting started",
        "How to run ignifx today: clone the repository, install with pnpm, and start one of the four templates. The create-ignifx scaffolder waits on the first published release.",
        gettingStartedPage(facts, highlighter),
      );
      add(
        "/gallery/",
        "Gallery",
        "The four ignifx templates and two examples, shown with the golden screenshots the visual test suite compares against.",
        galleryPage(facts),
      );
      add(
        "/docs/",
        "Docs",
        "The ignifx documentation map: the Agent Skill rendered here, the architecture documents, the decision records, the constitution, and the engineering plan.",
        docsPage(repositoryRoot, pages),
      );

      for (const page of pages) {
        const source = readFileSync(page.file, "utf8");
        const rendered = renderSkillPage(page, pages, source, highlighter);
        searchIndex.push(rendered.index);
        add(rendered.route, rendered.title, rendered.description, rendered.main, "page-doc");
      }

      const notFound = renderDocument({
        route: "/404.html",
        title: "Page not found",
        description: "That ignifx page does not exist. The complete index is at /llms.txt.",
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
        fileName: "search-index.js",
        source: `window.ignifxSearchIndex=${JSON.stringify(searchIndex)};\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: sitemap(documents.map((document) => document.route)),
      });

      // The contract with `pnpm docs:llms`: every URL the generated index publishes is a page here.
      const emittedRoutes = new Set(documents.map((document) => document.route));
      const llms = readFileSync(path.join(websiteRoot, "public", "llms.txt"), "utf8");
      const missing = llmsRoutes(llms).filter((route) => !emittedRoutes.has(route));
      if (missing.length > 0) {
        this.error(
          `ignifx-site: website/public/llms.txt lists ${String(missing.length)} URL(s) the site does not serve: ${missing.join(", ")}. Run \`pnpm docs:llms\`.`,
        );
      }
      this.info(`ignifx-site: ${String(documents.length + 1)} pages, ${String(pages.length)} of them skill pages.`);
    },
  };
}
