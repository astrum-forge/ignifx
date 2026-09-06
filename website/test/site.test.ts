import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FONTS } from "../scripts/fonts.ts";
import { slugify, stripFrontmatter } from "../scripts/markdown.ts";
import { fileNameForRoute } from "../scripts/site.ts";
import { resolveSkillLink } from "../scripts/skill-page.ts";
import { llmsRoutes } from "../scripts/skill-tree.ts";
import type { SkillPage } from "../scripts/skill-tree.ts";

const websiteRoot = path.resolve(import.meta.dirname, "..");
const dist = path.join(websiteRoot, "dist");

/** Per-route budget for HTML + CSS + JS, gzipped (`DESIGN.md`, "Performance"). */
const ROUTE_BUDGET_BYTES = 120 * 1024;

/**
 * The two generated API-reference barrels cannot meet the route budget: their Markdown sources are
 * 609 KB and 1.6 MB, which gzip to 139 KB and 313 KB before a single tag is added. They are served
 * in full because `llms.txt` publishes their URLs, they ship uncoloured and anchor-free (see
 * `LARGE_PAGE_BYTES`), and their weight is pinned here so it cannot grow unnoticed.
 */
const LARGE_PAGE_CEILINGS: Readonly<Record<string, number>> = {
  "skill/references/api/ignifx.html": 480 * 1024,
  "skill/references/api/core.html": 215 * 1024,
};

/** Total font budget, latin subsets only. */
const FONT_BUDGET_BYTES = 120 * 1024;

/** Total client JavaScript budget. */
const SCRIPT_BUDGET_BYTES = 20 * 1024;

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
const documents = new Map(htmlFiles.map((file) => [file, readFileSync(path.join(dist, file), "utf8")]));
const cssFiles = files.filter((file) => file.endsWith(".css"));
const gzipped = (text: string | Buffer): number => gzipSync(text, { level: 9 }).byteLength;
const sharedBytes =
  cssFiles.reduce((total, file) => total + gzipped(readFileSync(path.join(dist, file))), 0) +
  files
    .filter((file) => file.endsWith(".js") && file !== "search-index.js")
    .reduce((total, file) => total + gzipped(readFileSync(path.join(dist, file))), 0);

describe("routing", () => {
  it("maps routes onto the files Cloudflare Pages serves", () => {
    expect(fileNameForRoute("/")).toBe("index.html");
    expect(fileNameForRoute("/features/")).toBe("features/index.html");
    expect(fileNameForRoute("/skill/2d/")).toBe("skill/2d/index.html");
    expect(fileNameForRoute("/skill/references/gotchas")).toBe("skill/references/gotchas.html");
  });

  it("serves every URL that llms.txt publishes", () => {
    const routes = llmsRoutes(readFileSync(path.join(dist, "llms.txt"), "utf8"));
    expect(routes.length).toBeGreaterThan(40);
    const missing = routes.filter((route) => !documents.has(fileNameForRoute(route)));
    expect(missing).toEqual([]);
  });

  it("lists every prerendered route in sitemap.xml", () => {
    const sitemap = readFileSync(path.join(dist, "sitemap.xml"), "utf8");
    const listed = [...sitemap.matchAll(/<loc>https:\/\/ignifx\.com(?<route>[^<]*)<\/loc>/gu)].map(
      (match) => match.groups?.["route"] ?? "",
    );
    const listedFiles = new Set(listed.map((route) => fileNameForRoute(route)));
    // 404.html is deliberately absent: it is an error document, not a page to crawl.
    const expected = htmlFiles.filter((file) => file !== "404.html");
    expect([...listedFiles].toSorted()).toEqual(expected.toSorted());
  });

  it("resolves every internal link to a file in dist", () => {
    const known = new Set(files);
    const broken: string[] = [];
    // A route may legitimately contain a dot (`/skill/references/formats/ignifx.scene`), so a real
    // file is recognised by its extension rather than by "has a dot in the last segment".
    const fileExtension = /\.(?:css|js|json|png|svg|txt|woff2|xml|html)$/u;
    for (const [file, html] of documents) {
      for (const match of html.matchAll(/(?:href|src)="(?<url>\/[^"#?]*)/gu)) {
        const url = match.groups?.["url"] ?? "";
        const target = fileExtension.test(url) ? url.slice(1) : fileNameForRoute(url);
        if (!known.has(target)) {
          broken.push(`${file} → ${url}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("rewrites links between skill files to site routes and everything else to GitHub", () => {
    const pages: readonly SkillPage[] = [
      {
        route: "/skill/",
        file: "",
        repoPath: "skills/ignifx/SKILL.md",
        section: "entry",
        label: "ignifx",
      },
      {
        route: "/skill/references/concepts/assets",
        file: "",
        repoPath: "skills/ignifx/references/concepts/assets.md",
        section: "concepts",
        label: "assets",
      },
      { route: "/skill/2d/", file: "", repoPath: "packages/2d/skills/2d/SKILL.md", section: "extensions", label: "2d" },
    ];
    const from = "skills/ignifx/SKILL.md";
    expect(resolveSkillLink("references/concepts/assets.md", from, pages)).toBe("/skill/references/concepts/assets");
    expect(resolveSkillLink("references/concepts/assets.md#loading", from, pages)).toBe(
      "/skill/references/concepts/assets#loading",
    );
    expect(resolveSkillLink("../../packages/2d/skills/2d/SKILL.md", from, pages)).toBe("/skill/2d/");
    expect(resolveSkillLink("../../CONSTITUTION.md", from, pages)).toBe(
      "https://github.com/astrum-forge/ignifx/blob/main/CONSTITUTION.md",
    );
    expect(resolveSkillLink("https://example.com/x", from, pages)).toBe("https://example.com/x");
    expect(resolveSkillLink("#anchor", from, pages)).toBe("#anchor");
  });

  it("slugs headings the way GitHub does, so anchors written in the skill keep working", () => {
    expect(slugify("Adding extensions")).toBe("adding-extensions");
    expect(slugify("`createApp` options")).toBe("createapp-options");
    expect(slugify("IGX-0701: no WebGPU")).toBe("igx-0701-no-webgpu");
  });

  it("strips YAML frontmatter from a SKILL.md", () => {
    expect(stripFrontmatter("---\nname: x\n---\n\n# Title\n")).toBe("# Title\n");
    expect(stripFrontmatter("# Title\n")).toBe("# Title\n");
  });
});

describe("no third-party requests (CONSTITUTION.md §9.1)", () => {
  it("loads no subresource from another origin", () => {
    const offenders: string[] = [];
    for (const [file, html] of documents) {
      for (const match of html.matchAll(/<(?:link|script|img|source|iframe|video|audio)\b[^>]*>/gu)) {
        const tag = match[0];
        // `rel="canonical"` names the page's own absolute URL; it fetches nothing.
        if (tag.includes('rel="canonical"')) {
          continue;
        }
        const url = /\b(?:href|src)="(?<url>[^"]*)"/u.exec(tag)?.groups?.["url"] ?? "/";
        if (!url.startsWith("/") && !url.startsWith("data:")) {
          offenders.push(`${file} → ${url}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("references no off-origin URL from CSS", () => {
    const offenders: string[] = [];
    for (const file of cssFiles) {
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

  it("has no inline script and no style attribute, which is what the CSP forbids", () => {
    for (const [file, html] of documents) {
      expect(html, file).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]/u);
      expect(html, file).not.toMatch(/<style[\s>]/u);
      expect(html, file).not.toMatch(/\sstyle="/u);
      expect(html, file).not.toMatch(/\son[a-z]+="/u);
    }
  });
});

describe("headers and redirects", () => {
  const headersFile = readFileSync(path.join(dist, "_headers"), "utf8");
  // Comments explain the policy and name the directives it leaves out, so the assertions below run
  // against the rules only.
  const headers = headersFile
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const redirects = readFileSync(path.join(dist, "_redirects"), "utf8");

  it("parses as Cloudflare Pages expects: a path line, then indented `Name: value` lines", () => {
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
      expect(line.trim()).toMatch(/^[A-Za-z-]+:\s?.+$/u);
    }
    expect(sawPath).toBe(true);
  });

  it("sets the security headers the site relies on", () => {
    expect(headers).toContain("script-src 'self'");
    expect(headers).toContain("style-src 'self'");
    expect(headers).toContain("connect-src 'none'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).not.toContain("unsafe-inline");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    expect(headers).toMatch(/Permissions-Policy:.*camera=\(\)/u);
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/u);
  });

  it("writes redirects as `from to status`", () => {
    for (const line of redirects.split("\n")) {
      if (line.trim() === "" || line.startsWith("#")) {
        continue;
      }
      const parts = line.trim().split(/\s+/u);
      expect(parts.length, line).toBe(3);
      expect(parts[0], line).toMatch(/^\//u);
      expect(parts[1], line).toMatch(/^\//u);
      expect(parts[2], line).toMatch(/^30[12]$/u);
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
    }
  });

  it("declares color-scheme and defines both palettes outside a media query", () => {
    const tokens = readFileSync(path.join(websiteRoot, "src", "styles", "tokens.css"), "utf8");
    expect(tokens).toMatch(/:root\s*\{[^}]*color-scheme: light/u);
    expect(tokens).toMatch(/:root\[data-theme="dark"\]/u);
    expect(tokens).toMatch(/:root:not\(\[data-theme="light"\]\)/u);
  });

  it("gives every image alt text, an intrinsic size, and lazy loading", () => {
    for (const [file, html] of documents) {
      for (const match of html.matchAll(/<img\b[^>]*>/gu)) {
        const tag = match[0];
        expect(tag, file).toMatch(/\balt="[^"]+"/u);
        expect(tag, file).toMatch(/\bwidth="\d+"/u);
        expect(tag, file).toMatch(/\bheight="\d+"/u);
        expect(tag, file).toMatch(/\bloading="lazy"/u);
      }
    }
  });

  it("keeps every text pair in DESIGN.md above the AA threshold in both themes", () => {
    const tokens = readFileSync(path.join(websiteRoot, "src", "styles", "tokens.css"), "utf8");
    const palettes = ["light", "dark"] as const;
    const values = new Map<string, Map<string, string>>();
    // `:root { … }` is the light palette; `:root[data-theme="dark"] { … }` is the dark one.
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
  it("keeps every route inside the budget, apart from the two recorded API barrels", () => {
    const over: string[] = [];
    for (const [file, html] of documents) {
      const total = gzipped(html) + sharedBytes;
      const ceiling = LARGE_PAGE_CEILINGS[file] ?? ROUTE_BUDGET_BYTES;
      if (total > ceiling) {
        over.push(`${file}: ${String(Math.round(total / 1024))} KB gz > ${String(Math.round(ceiling / 1024))} KB`);
      }
    }
    expect(over).toEqual([]);
  });

  it("ships at most 20 KB of JavaScript and 120 KB of fonts", () => {
    const scripts = files
      .filter((file) => file.endsWith(".js") && file !== "search-index.js")
      .reduce((total, file) => total + gzipped(readFileSync(path.join(dist, file))), 0);
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

  it("names the search index global the same way in the emitted script and in the client", () => {
    const emitted = readFileSync(path.join(dist, "search-index.js"), "utf8");
    const client = readFileSync(path.join(websiteRoot, "src", "search.ts"), "utf8");
    const global = /^window\.(?<name>[A-Za-z\d_$]+)=/u.exec(emitted)?.groups?.["name"] ?? "";
    expect(global).not.toBe("");
    expect(client).toContain(`window.${global}`);
  });

  it("never asks a grid track to be wider than a 320 px viewport", () => {
    // `minmax(21rem, 1fr)` makes a 336 px column mandatory and scrolls the body sideways on a small
    // phone; `minmax(min(21rem, 100%), 1fr)` does not. Verified in Chromium at 320/390/768/1920 px.
    for (const file of cssFiles) {
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
