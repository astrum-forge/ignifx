import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CATALOGUE, CATEGORIES } from "../examples/catalogue.ts";
import { exampleDirectories, exampleHref, POSTER_FORMATS, sourceRoot } from "../scripts/examples.ts";
import { FONTS } from "../scripts/fonts.ts";
import { STATS_TITLE } from "../scripts/frame.ts";
import { JSON_LD, jsonLdHash } from "../scripts/layout.ts";
import { slugify, stripFrontmatter } from "../scripts/markdown.ts";
import { resolveGuideLink } from "../scripts/repo-content.ts";
import { fileNameForRoute } from "../scripts/site.ts";
import { findSkillPages, llmsUrls, repoPathOf } from "../scripts/skill-tree.ts";
import { readText } from "../scripts/text.ts";
import { site } from "../site.config.ts";

const websiteRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(websiteRoot, "..");
const dist = path.join(websiteRoot, "dist");

/** Per-route budget for HTML + CSS + site JS, gzipped (`06-engineering.md` §2.4). */
const ROUTE_BUDGET_BYTES = 120 * 1024;

/** Total font budget, latin subsets only. */
const FONT_BUDGET_BYTES = 120 * 1024;

/** Total client JavaScript budget: the enhancement module, the theme script and the viewer chunk. */
const SCRIPT_BUDGET_BYTES = 30 * 1024;

/** Per-format poster budget (`06` §2.4). */
const POSTER_BUDGET_BYTES = 120 * 1024;

/**
 * Lists every file under a directory, relative to it.
 *
 * @param directory - Absolute path.
 * @param prefix - Accumulated relative prefix.
 * @returns Relative paths, with `/` separators.
 */
function walk(directory: string, prefix = ""): readonly string[] {
  const out: string[] = [];
  for (const name of readdirSync(directory)) {
    const absolute = path.join(directory, name);
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(absolute).isDirectory()) {
      out.push(...walk(absolute, relative));
    } else {
      out.push(relative);
    }
  }
  return out;
}

if (!existsSync(dist)) {
  throw new Error("website/dist is missing. Run `pnpm --filter @ignifx/website build` before the tests.");
}

const files = walk(dist);
const htmlFiles = files.filter((file) => file.endsWith(".html"));

/** A run page is an example's own build, not a site page: it has no shell and no landmarks. */
const isRunPage = (file: string): boolean => /^examples\/[^/]+\/run\//u.test(file);

/** Every page the site itself renders, by path inside `dist`. */
const documents = new Map(
  htmlFiles.filter((file) => !isRunPage(file)).map((file) => [file, readFileSync(path.join(dist, file), "utf8")]),
);
/** Every emitted HTML file, run pages included; the no-third-party scan covers all of them. */
const allDocuments = new Map(htmlFiles.map((file) => [file, readFileSync(path.join(dist, file), "utf8")]));

/** The site's own stylesheets and scripts: `assets/*` plus the unhashed `theme.js`. */
const siteCss = files.filter((file) => file.startsWith("assets/") && file.endsWith(".css"));
const siteJs = files.filter((file) => file === "theme.js" || (file.startsWith("assets/") && file.endsWith(".js")));

const gzipped = (text: string | Buffer): number => gzipSync(text, { level: 9 }).byteLength;
const sharedBytes = [...siteCss, ...siteJs].reduce(
  (total, file) => total + gzipped(readFileSync(path.join(dist, file))),
  0,
);

const headersFile = readFileSync(path.join(dist, "_headers"), "utf8");
const redirects = readFileSync(path.join(dist, "_redirects"), "utf8");

/**
 * The header lines of one `_headers` rule.
 *
 * @param pattern - The rule's path pattern, exactly as the file writes it.
 * @returns The indented lines under it, trimmed, or an empty array when the rule is absent.
 */
function headerBlock(pattern: string): readonly string[] {
  const lines = headersFile.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === pattern);
  if (start === -1) {
    return [];
  }
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || (!line.startsWith(" ") && !line.startsWith("\t"))) {
      break;
    }
    block.push(line.trim());
  }
  return block;
}

/** The expected route list (`01-strategy-and-ia.md` §7, grown by the catalogue and the recipes). */
const expectedRoutes = [
  "/",
  "/features/",
  "/examples/",
  ...CATALOGUE.map((entry) => `/examples/${entry.slug}/`),
  "/examples/attribution/",
  "/docs/",
  "/docs/getting-started/",
  "/docs/guides/",
  "/docs/browser-support/",
  "/press/",
];

describe("routing", () => {
  it("maps routes onto the files Cloudflare Pages serves", () => {
    expect(fileNameForRoute("/")).toBe("index.html");
    expect(fileNameForRoute("/features/")).toBe("features/index.html");
    expect(fileNameForRoute("/examples/pbr-model/")).toBe("examples/pbr-model/index.html");
    expect(fileNameForRoute("/docs/guides/load-a-model/")).toBe("docs/guides/load-a-model/index.html");
  });

  it("renders every route the plan lists, plus one page per guide", () => {
    for (const route of expectedRoutes) {
      expect(documents.has(fileNameForRoute(route)), route).toBe(true);
    }
    expect(existsSync(path.join(dist, "404.html"))).toBe(true);
    const guides = [...documents.keys()].filter(
      (file) => file.startsWith("docs/guides/") && file !== "docs/guides/index.html",
    );
    expect(guides.length).toBe(16);
  });

  it("serves no skill page, because the skill lives in the repository (ADR-0020)", () => {
    expect([...documents.keys()].filter((file) => file.startsWith("skill/"))).toEqual([]);
    for (const [file, html] of documents) {
      expect(html, file).not.toMatch(/href="\/skill\//u);
    }
  });

  it("has a run page for every catalogue slug", () => {
    const missing = CATALOGUE.filter(
      (entry) => !existsSync(path.join(dist, "examples", entry.slug, "run", "index.html")),
    );
    expect(missing.map((entry) => entry.slug)).toEqual([]);
  });

  it("lists every prerendered route in sitemap.xml", () => {
    const sitemap = readFileSync(path.join(dist, "sitemap.xml"), "utf8");
    const listed = [...sitemap.matchAll(/<loc>https:\/\/ignifx\.com(?<route>[^<]*)<\/loc>/gu)].map(
      (match) => match.groups?.["route"] ?? "",
    );
    const listedFiles = new Set(listed.map((route) => fileNameForRoute(route)));
    // 404.html is deliberately absent: it is an error document, not a page to crawl. So are the run
    // pages, which are applications rather than documents to index.
    const expected = [...documents.keys()].filter((file) => file !== "404.html");
    expect([...listedFiles].toSorted()).toEqual(expected.toSorted());
  });

  it("resolves every internal link to a file in dist", () => {
    const known = new Set(files);
    const broken: string[] = [];
    const fileExtension = /\.(?:avif|css|ico|js|json|png|svg|txt|webp|woff2|xml|html|zip)$/u;

    /**
     * Records one referenced URL.
     *
     * @param file - The page it was found on.
     * @param url - The site-root-relative URL.
     */
    const check = (file: string, url: string): void => {
      const target = fileExtension.test(url) ? url.slice(1) : fileNameForRoute(url);
      if (!known.has(target)) {
        broken.push(`${file} → ${url}`);
      }
    };
    for (const [file, html] of allDocuments) {
      for (const match of html.matchAll(/(?:href|src)="(?<url>\/[^"#?]*)/gu)) {
        check(file, match.groups?.["url"] ?? "");
      }
      // `srcset` is how the brand mark ships its 2× source, so its candidates resolve too.
      for (const match of html.matchAll(/\bsrcset="(?<set>[^"]*)"/gu)) {
        for (const candidate of (match.groups?.["set"] ?? "").split(",")) {
          const url = candidate.trim().split(/\s+/u)[0] ?? "";
          if (url.startsWith("/")) {
            check(file, url);
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("falls back to a category section, then to the gallery, for a slug that is not built yet", () => {
    // The copy in `03-pages-and-copy.md` names every example the catalogue will hold; the catalogue
    // grows one wave at a time, and a "See it" link must never 404 (`08-execution.md` §3).
    expect(exampleHref("pbr-model", "Rendering")).toBe("/examples/pbr-model/");
    expect(exampleHref("/docs/getting-started/#desktop", "Platform")).toBe("/docs/getting-started/#desktop");
    const populated = CATALOGUE[0]?.category ?? "Basics";
    expect(exampleHref("not-built-yet", populated)).toBe(
      `/examples/#${populated.toLowerCase().replaceAll(/[^a-z\d]+/gu, "-")}`,
    );
    // Once every category holds an example the gallery hop is unreachable; assert it only while a
    // category is still empty, so this test describes the catalogue rather than a snapshot of it.
    const empty = CATEGORIES.find((category) => !CATALOGUE.some((entry) => entry.category === category));
    if (empty !== undefined) {
      expect(exampleHref("not-built-yet", empty)).toBe("/examples/");
    }
  });

  it("reads repository text with CRLF normalised, so a Windows checkout parses like a Linux one", () => {
    // CI's `windows-latest` checks files out with CRLF; every parser here matches at line starts.
    const file = path.join(tmpdir(), `ignifx-crlf-${String(process.pid)}.md`);
    writeFileSync(file, "## First app\r\n\r\n```ts\r\nconst x = 1;\r\n```\r\n");
    try {
      expect(readText(file)).toBe("## First app\n\n```ts\nconst x = 1;\n```\n");
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("rewrites a recipe's links to guide routes and everything else to GitHub", () => {
    expect(resolveGuideLink("load-a-model.md")).toBe("/docs/guides/load-a-model/");
    expect(resolveGuideLink("load-a-model.md#assets")).toBe("/docs/guides/load-a-model/#assets");
    expect(resolveGuideLink("README.md")).toBe("/docs/guides/");
    expect(resolveGuideLink("../concepts/assets.md")).toBe(`${site.blob}/skills/ignifx/references/concepts/assets.md`);
    expect(resolveGuideLink("../../../../CONSTITUTION.md")).toBe(`${site.blob}/CONSTITUTION.md`);
    expect(resolveGuideLink("https://example.com/x")).toBe("https://example.com/x");
    expect(resolveGuideLink("#anchor")).toBe("#anchor");
  });

  it("slugs headings the way GitHub does, so anchors written in a recipe keep working", () => {
    expect(slugify("Adding extensions")).toBe("adding-extensions");
    expect(slugify("`createApp` options")).toBe("createapp-options");
    expect(slugify("IGX-0701: no WebGPU")).toBe("igx-0701-no-webgpu");
  });

  it("strips YAML frontmatter from a SKILL.md", () => {
    expect(stripFrontmatter("---\nname: x\n---\n\n# Title\n")).toBe("# Title\n");
    expect(stripFrontmatter("# Title\n")).toBe("# Title\n");
  });
});

describe("examples", () => {
  it("commits a poster in three formats, each inside its budget", () => {
    const problems: string[] = [];
    for (const entry of CATALOGUE) {
      for (const format of POSTER_FORMATS) {
        const file = path.join(websiteRoot, "public", "examples", `${entry.slug}.${format}`);
        if (!existsSync(file)) {
          problems.push(`${entry.slug}.${format} is missing`);
          continue;
        }
        const bytes = statSync(file).size;
        if (bytes > POSTER_BUDGET_BYTES) {
          problems.push(`${entry.slug}.${format} is ${String(Math.round(bytes / 1024))} KB`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("has one catalogue entry per example directory and one directory per entry", () => {
    const slugs = new Set(CATALOGUE.filter((entry) => entry.template === undefined).map((entry) => entry.slug));
    expect(exampleDirectories(websiteRoot).filter((name) => !slugs.has(name))).toEqual([]);
    const withoutDirectory = CATALOGUE.filter((entry) => !existsSync(sourceRoot(repositoryRoot, entry).absolute));
    expect(withoutDirectory.map((entry) => entry.slug)).toEqual([]);
  });

  it("has no slug that the /examples/*run/ headers rule would catch", () => {
    // Cloudflare allows one splat per pattern, so the frame policy is matched by suffix; a slug
    // ending in `run` would take the relaxed policy on its viewer page.
    expect(CATALOGUE.filter((entry) => entry.slug.endsWith("run")).map((entry) => entry.slug)).toEqual([]);
  });

  it("shows the hero scene alone and keeps the panel on the viewer page", () => {
    // `02-design-system.md` §4.1: the hero is the running scene. The parameter panel is part of the
    // example, so it is turned off with the kit's flag rather than hidden by the site.
    const heroFrame = /<iframe[^>]*data-frame[^>]*>/u.exec(documents.get("index.html") ?? "")?.[0] ?? "";
    expect(heroFrame).toContain('src="/examples/pbr-model/run/?nopanel=1"');
    const viewer =
      /<iframe[^>]*data-frame[^>]*>/u.exec(documents.get("examples/pbr-model/index.html") ?? "")?.[0] ?? "";
    expect(viewer).toContain('src="/examples/pbr-model/run/"');
    // "Open standalone" always opens the whole example, flags and all.
    expect(documents.get("index.html")).toContain('href="/examples/pbr-model/run/"');
  });

  it("labels the live figure as engine CPU, which is what the kit reports", () => {
    // `website/examples/_kit/bridge.ts`: `frameMs` is the sum of the frame's phase CPU samples,
    // median of the last 30 frames — not wall-clock frame time and not GPU time.
    for (const file of ["index.html", "examples/pbr-model/index.html"]) {
      const stats = /<p[^>]*data-frame-stats[^>]*>/u.exec(documents.get(file) ?? "")?.[0] ?? "";
      expect(stats, file).toContain(`title="${STATS_TITLE}"`);
    }
    const client = readFileSync(path.join(websiteRoot, "src", "viewer.ts"), "utf8");
    expect(client).toContain("ms engine CPU · ");
  });

  it("gives every run page a title and a language", () => {
    for (const [file, html] of allDocuments) {
      if (!isRunPage(file)) {
        continue;
      }
      expect(html, file).toMatch(/<html[^>]*\slang="en"/u);
      expect(html, file).toMatch(/<title>[^<]+<\/title>/u);
    }
  });
});

describe("no third-party requests (CONSTITUTION.md §9.1)", () => {
  it("loads no subresource from another origin, on a site page or inside an example frame", () => {
    const offenders: string[] = [];
    for (const [file, html] of allDocuments) {
      for (const match of html.matchAll(/<(?:link|script|img|source|iframe|video|audio)\b[^>]*>/gu)) {
        const tag = match[0];
        // `rel="canonical"` names the page's own absolute URL; it fetches nothing.
        if (tag.includes('rel="canonical"')) {
          continue;
        }
        const url = /\b(?:href|src|srcset)="(?<url>[^"]*)"/u.exec(tag)?.groups?.["url"] ?? "/";
        if (!url.startsWith("/") && !url.startsWith("data:")) {
          offenders.push(`${file} → ${url}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("references no off-origin URL from CSS", () => {
    const offenders: string[] = [];
    for (const file of files.filter((name) => name.endsWith(".css"))) {
      const css = readFileSync(path.join(dist, file), "utf8");
      for (const match of css.matchAll(/url\(\s*["']?(?<url>[^"')]+)/gu)) {
        const url = match.groups?.["url"] ?? "";
        if (!url.startsWith("/") && !url.startsWith("data:")) {
          offenders.push(`${file} → ${url}`);
        }
      }
      expect(css).not.toMatch(/@import\s+url\(\s*["']?https?:/u);
    }
    expect(offenders).toEqual([]);
  });

  it("carries exactly one inline script per page, the JSON-LD block, and no inline style", () => {
    for (const [file, html] of documents) {
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gu)].map((match) => match[0]);
      expect(inline, file).toEqual(['<script type="application/ld+json">']);
      expect(html, file).not.toMatch(/<style[\s>]/u);
      expect(html, file).not.toMatch(/\sstyle="/u);
      expect(html, file).not.toMatch(/\son[a-z]+="/u);
    }
  });

  it("writes the same structured-data block on every page", () => {
    for (const [file, html] of documents) {
      const block = /<script type="application\/ld\+json">(?<json>[\s\S]*?)<\/script>/u.exec(html)?.groups?.["json"];
      expect(block, file).toBe(JSON_LD);
    }
    // It must parse, or a crawler ignores it.
    expect(() => JSON.parse(JSON_LD) as unknown).not.toThrow();
  });
});

describe("headers and redirects", () => {
  it("parses as Cloudflare Pages expects: a path line, then indented `Name: value` or `! Name` lines", () => {
    let sawPath = false;
    for (const line of headersFile.split("\n")) {
      if (line.trim() === "" || line.trimStart().startsWith("#")) {
        continue;
      }
      if (!line.startsWith(" ") && !line.startsWith("\t")) {
        expect(line, "a path rule starts with /").toMatch(/^\/\S*$/u);
        sawPath = true;
        continue;
      }
      expect(sawPath, "a header line must follow a path rule").toBe(true);
      expect(line.trim()).toMatch(/^(?:![ ][A-Za-z-]+|[A-Za-z-]+:\s?.+)$/u);
    }
    expect(sawPath).toBe(true);
  });

  it("locks the site down and carries the JSON-LD hash the pages actually use", () => {
    const block = headerBlock("/*").join("\n");
    expect(block).toContain("script-src 'self' 'sha256-");
    expect(block).toContain("style-src 'self';");
    expect(block).toContain("connect-src 'none'");
    expect(block).toContain("frame-ancestors 'none'");
    expect(block).not.toContain("unsafe-inline");
    expect(block).toContain("X-Content-Type-Options: nosniff");
    expect(block).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    expect(block).toMatch(/Permissions-Policy:.*camera=\(\)/u);

    const emitted = /'sha256-[A-Za-z\d+/=]+'/u.exec(block)?.[0] ?? "";
    expect(emitted).toBe(jsonLdHash());
    const home = documents.get("index.html") ?? "";
    const inline =
      /<script type="application\/ld\+json">(?<json>[\s\S]*?)<\/script>/u.exec(home)?.groups?.["json"] ?? "";
    expect(emitted).toBe(`'sha256-${createHash("sha256").update(inline, "utf8").digest("base64")}'`);
  });

  it("relaxes only styles, and only inside an example frame", () => {
    for (const pattern of ["/examples/*run/", "/examples/*run/index.html"]) {
      const block = headerBlock(pattern).join("\n");
      expect(block, pattern).toContain("! Content-Security-Policy");
      expect(block, pattern).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(block, pattern).toContain("style-src 'self' 'unsafe-inline'");
      expect(block, pattern).toContain("frame-ancestors 'self'");
      expect(block, pattern).toContain("worker-src 'self' blob:");
      // Recast's WebAssembly is inlined as a `data:` URL that Emscripten fetches (ADR-0020).
      expect(block, pattern).toContain("connect-src 'self' data:");
      // Scripts are never allowed inline, not even in a frame.
      expect(block, pattern).not.toContain("script-src 'self' 'unsafe-inline'");
    }
  });

  it("lets other sites hot-link the badges and caches the hashed assets for a year", () => {
    const badges = headerBlock("/press/badges/*").join("\n");
    expect(badges).toContain("Access-Control-Allow-Origin: *");
    expect(badges).toContain("Cache-Control: public, max-age=86400");
    for (const pattern of ["/assets/*", "/examples/assets/*"]) {
      const block = headerBlock(pattern).join("\n");
      expect(block, pattern).toContain("! Cache-Control");
      expect(block, pattern).toContain("Cache-Control: public, max-age=31536000, immutable");
    }
    // `/brand/*` is unhashed — it changes only when the brand does (`08-execution.md` §9).
    const brand = headerBlock("/brand/*").join("\n");
    expect(brand).toContain("! Cache-Control");
    expect(brand).toContain("Cache-Control: public, max-age=86400");
  });

  it("writes redirects as `from to status`, with absolute repository targets", () => {
    let sawAbsolute = false;
    for (const line of redirects.split("\n")) {
      if (line.trim() === "" || line.startsWith("#")) {
        continue;
      }
      const parts = line.trim().split(/\s+/u);
      expect(parts.length, line).toBe(3);
      expect(parts[0], line).toMatch(/^\//u);
      expect(parts[1], line).toMatch(/^(?:\/|https:\/\/github\.com\/astrum-forge\/ignifx\/)/u);
      expect(parts[2], line).toMatch(/^30[12]$/u);
      sawAbsolute = sawAbsolute || (parts[1] ?? "").startsWith("https://");
    }
    expect(sawAbsolute).toBe(true);
  });

  it("redirects the retired routes, one line per skill file", () => {
    expect(redirects).toMatch(/^\/gallery\/\s+\/examples\/\s+301$/mu);
    expect(redirects).toMatch(/^\/getting-started\/\s+\/docs\/getting-started\/\s+301$/mu);
    expect(redirects).toMatch(/^\/docs\/skill\/\*\s+\/skill\/:splat\s+301$/mu);
    const pages = findSkillPages(repositoryRoot);
    expect(pages.length).toBeGreaterThan(40);
    for (const page of pages) {
      expect(redirects, page.route).toContain(`${site.blob}/${page.repoPath}`);
    }
    // The nine subsystem skills each get their own line (`06-engineering.md` §2.3).
    const subsystems = [...redirects.matchAll(/^\/skill\/[a-z\d-]+\/\s+https:/gmu)];
    expect(subsystems.length).toBe(pages.filter((page) => /^\/skill\/[a-z\d-]+\/$/u.test(page.route)).length);
  });
});

describe("llms.txt", () => {
  const llms = readFileSync(path.join(websiteRoot, "public", "llms.txt"), "utf8");

  it("is the one agent entry point and is served as a file", () => {
    expect(existsSync(path.join(dist, "llms.txt"))).toBe(true);
    expect(documents.get("index.html")).toContain('href="/llms.txt"');
  });

  it("links only at files that exist in the working tree", () => {
    const urls = llmsUrls(llms);
    expect(urls.length).toBeGreaterThan(40);
    const broken = urls.filter((url) => {
      const repoPath = repoPathOf(url, site.blob);
      return repoPath === null || !existsSync(path.join(repositoryRoot, repoPath));
    });
    expect(broken).toEqual([]);
  });

  it("points at no site route", () => {
    expect(llms).not.toMatch(/\]\(\//u);
  });
});

describe("release gating (03-pages-and-copy.md §8)", () => {
  it("links to npm only once the packages are published", () => {
    const linking: string[] = [];
    for (const [file, html] of documents) {
      if (html.includes("npmjs.com")) {
        linking.push(file);
      }
    }
    if (site.published) {
      expect(linking.length).toBeGreaterThan(0);
    } else {
      expect(linking).toEqual([]);
    }
  });

  it("shows the pre-release install surface while `published` is false", () => {
    // Shiki splits a command across one `<span>` per token, so the assertion runs over the text.
    const home = (documents.get("index.html") ?? "").replaceAll(/<[^>]*>/gu, "");
    if (site.published) {
      expect(home).toContain("npm create ignifx@latest");
    } else {
      expect(home).toContain("npm · soon");
      expect(home).toContain("git clone https://github.com/astrum-forge/ignifx.git");
      expect(home).not.toContain("npm create ignifx@latest");
    }
  });
});

/**
 * The sRGB-to-linear transfer function of WCAG 2.1's relative-luminance formula.
 *
 * @param value - One 0-255 channel.
 * @returns The linearised channel.
 */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

describe("accessibility", () => {
  it("gives every page one h1, a language, landmarks and a skip link", () => {
    for (const [file, html] of documents) {
      expect([...html.matchAll(/<h1[\s>]/gu)].length, file).toBe(1);
      expect(html, file).toContain('<html lang="en">');
      expect(html, file).toContain('href="#main"');
      expect(html, file).toMatch(/<main id="main"/u);
      expect(html, file).toMatch(/<header class="masthead"/u);
      expect(html, file).toMatch(/<nav class="nav" aria-label="Main"/u);
      expect(html, file).toMatch(/<footer class="site-foot"/u);
      expect(html, file).toMatch(/<title>[^<]+<\/title>/u);
      expect(html, file).toMatch(/<meta name="description" content="[^"]+"/u);
      expect(html, file).toMatch(/<link rel="canonical" href="https:\/\/ignifx\.com/u);
      expect(html, file).toMatch(/<meta property="og:image" content="[^"]+"/u);
    }
  });

  it("declares color-scheme and defines both palettes outside a media query", () => {
    const tokens = readFileSync(path.join(websiteRoot, "src", "styles", "tokens.css"), "utf8");
    expect(tokens).toMatch(/:root\s*\{[^}]*color-scheme: light/u);
    expect(tokens).toMatch(/:root\[data-theme="dark"\]/u);
    expect(tokens).toMatch(/:root:not\(\[data-theme="light"\]\)/u);
  });

  it("gives every image alt text, an intrinsic size and a loading hint", () => {
    for (const [file, html] of documents) {
      let eager = 0;
      for (const match of html.matchAll(/<img\b[^>]*>/gu)) {
        const tag = match[0];
        expect(tag, file).toMatch(/\balt="/u);
        expect(tag, file).toMatch(/\bwidth="\d+"/u);
        expect(tag, file).toMatch(/\bheight="\d+"/u);
        // The brand mark is the one raster in the site's chrome (`02` §2.1). It is decorative — the
        // lockup's link is labelled and the wordmark is real text beside it — and it is above the
        // fold wherever it appears, so it carries an empty `alt`, `aria-hidden` and no loading hint.
        if (/\bclass="mark\b/u.test(tag)) {
          expect(tag, file).toContain('alt=""');
          expect(tag, file).toContain('aria-hidden="true"');
          expect(tag, file).not.toMatch(/\bloading=/u);
          continue;
        }
        expect(tag, file).toMatch(/\balt="[^"]+"/u);
        expect(tag, file).toMatch(/\bloading="(?:lazy|eager)"/u);
        eager += tag.includes('loading="eager"') ? 1 : 0;
      }
      // Only the one above-the-fold poster may load eagerly.
      expect(eager, file).toBeLessThanOrEqual(1);
    }
  });

  it("ships the favicon set the new raster mark needs (08-execution.md §9)", () => {
    for (const asset of ["favicon.ico", "favicon-16.png", "favicon-32.png", "apple-touch-icon.png"]) {
      expect(existsSync(path.join(dist, asset)), asset).toBe(true);
    }
    // The retired single-path favicon must not come back: it is not the mark any more.
    expect(existsSync(path.join(dist, "favicon.svg"))).toBe(false);
    const home = documents.get("index.html") ?? "";
    expect(home).toContain('<link rel="icon" href="/favicon.ico" sizes="48x48">');
    expect(home).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    expect(home).not.toContain("favicon.svg");
  });

  it("names every example frame so a screen reader announces what it is", () => {
    for (const [file, html] of documents) {
      for (const match of html.matchAll(/<iframe\b[^>]*>/gu)) {
        expect(match[0], file).toMatch(/\btitle="Interactive example: [^"]+"/u);
      }
    }
  });

  it("keeps every text pair in the design system above the AA threshold in both themes", () => {
    const tokens = readFileSync(path.join(websiteRoot, "src", "styles", "tokens.css"), "utf8");
    const palettes = ["light", "dark"] as const;
    const values = new Map<string, Map<string, string>>();
    const lightBlock = /:root \{(?<body>[\s\S]*?)\n\}/u.exec(tokens)?.groups?.["body"] ?? "";
    const darkBlock = /:root\[data-theme="dark"\] \{(?<body>[\s\S]*?)\n\}/u.exec(tokens)?.groups?.["body"] ?? "";
    for (const [name, block] of [
      ["light", lightBlock],
      ["dark", darkBlock],
    ] as const) {
      const map = new Map<string, string>();
      for (const match of block.matchAll(/--(?<key>[a-z\d-]+): (?<value>#[\da-f]{6});/gu)) {
        map.set(match.groups?.["key"] ?? "", match.groups?.["value"] ?? "");
      }
      values.set(name, map);
    }

    const luminance = (hex: string): number => {
      const n = Number.parseInt(hex.slice(1), 16);

      return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
    };
    const ratio = (a: string, b: string): number => {
      const [low, high] = [luminance(a), luminance(b)].toSorted((x, y) => x - y);
      return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
    };

    // `--ok` and `--warn` join the table for `--surface` only: that is the ground the support pill
    // is drawn on (`src/styles/shell.css`), and `--ok` at `#1B7F3B` does not clear 4.5:1 on `--bg`.
    const pairs = [
      ["ink", "bg"],
      ["ink", "surface"],
      ["ink", "sunk"],
      ["ink-2", "bg"],
      ["ink-2", "surface"],
      ["ink-2", "sunk"],
      ["flame", "bg"],
      ["flame", "surface"],
      ["flame", "sunk"],
      ["cool", "bg"],
      ["cool", "surface"],
      ["cool", "sunk"],
      ["ok", "surface"],
      ["warn", "surface"],
    ] as const;
    for (const palette of palettes) {
      const map = values.get(palette);
      expect(map?.size, `${palette} palette`).toBeGreaterThan(6);
      for (const [foreground, background] of pairs) {
        const front = map?.get(foreground) ?? "";
        const back = map?.get(background) ?? "";
        expect(ratio(front, back), `${palette}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("weight", () => {
  it("keeps every route inside the budget", () => {
    const over: string[] = [];
    for (const [file, html] of documents) {
      const total = gzipped(html) + sharedBytes;
      if (total > ROUTE_BUDGET_BYTES) {
        over.push(`${file}: ${String(Math.round(total / 1024))} KB gz`);
      }
    }
    expect(over).toEqual([]);
  });

  it("ships at most 30 KB of JavaScript and 120 KB of fonts", () => {
    const scripts = siteJs.reduce((total, file) => total + gzipped(readFileSync(path.join(dist, file))), 0);
    expect(scripts).toBeLessThanOrEqual(SCRIPT_BUDGET_BYTES);

    const fonts = files.filter((file) => file.endsWith(".woff2"));
    expect(fonts.length).toBe(FONTS.length);
    const fontBytes = fonts.reduce((total, file) => total + statSync(path.join(dist, file)).size, 0);
    expect(fontBytes).toBeLessThanOrEqual(FONT_BUDGET_BYTES);
  });

  it("ships one licence per font and links them from the footer", () => {
    for (const font of FONTS) {
      const licence = path.join(dist, "licenses", `${font.slug}-OFL.txt`);
      expect(existsSync(licence), licence).toBe(true);
      expect(readFileSync(licence, "utf8")).toContain("SIL OPEN FONT LICENSE");
      expect(documents.get("index.html")).toContain(`/licenses/${font.slug}-OFL.txt`);
    }
  });

  it("never asks a grid track to be wider than a 320 px viewport", () => {
    // `minmax(21rem, 1fr)` makes a 336 px column mandatory and scrolls the body sideways on a small
    // phone; `minmax(min(21rem, 100%), 1fr)` does not. Verified in Chromium at 320/390/768/1920 px.
    for (const file of siteCss) {
      const css = readFileSync(path.join(dist, file), "utf8");
      const bare = [...css.matchAll(/minmax\(\s*(?<track>[\d.]+rem)/gu)].map((match) => match[0]);
      expect(bare, file).toEqual([]);
    }
  });

  it("points crawlers at the sitemap", () => {
    expect(readFileSync(path.join(dist, "robots.txt"), "utf8")).toContain("Sitemap: https://ignifx.com/sitemap.xml");
  });

  it("preloads exactly the faces that are above the fold", () => {
    const home = documents.get("index.html") ?? "";
    const preloads = [...home.matchAll(/<link rel="preload" as="font"[^>]*href="(?<url>[^"]+)"/gu)];
    expect(preloads.length).toBe(FONTS.filter((font) => font.preload).length);
  });
});
