# UI fixture attribution

The files in this directory back the `@ignifx/ui` test suite: one third-party font, redistributed
under the licence recorded below with the copyright line its upstream project requires
(`CONSTITUTION.md` §11.3), and one original document. Nothing here is published in an `@ignifx/*`
package.

Downloaded 2026-09-06 for Phase 8. Re-download with the command in [Provenance](#provenance) and
compare the SHA-256 digest before replacing the file.

---

## `ShareTechMono-Regular.ttf` — 43 272 bytes

A single-weight monospaced TrueType face, version 1.003. It is the font every text test shapes
with. Monospace is deliberate: a uniform advance makes a glyph's pixel address arithmetic rather
than a measurement, which is what lets the `HudText` browser test assert on exact pixels instead of
on a stored image. At 42 KB it is also the smallest complete Latin face that satisfies the fixture
budget.

- **Licence:** [SIL Open Font License 1.1](https://openfontlicense.org) — the font's own `name`
  table, entry 13, reads: "This Font Software is licensed under the SIL Open Font License, Version
  1.1. This license is available with a FAQ at: http://scripts.sil.org/OFL"
- **Copyright:** Copyright (c) 2012, Carrois Type Design, Ralph du Carrois
  (post@carrois.com www.carrois.com), with Reserved Font Name 'Share'
- **Reserved Font Name:** `Share`. The OFL forbids distributing a _modified_ version of this file
  under a name containing "Share"; this file is byte-identical to upstream and is not modified.
- **Source:** <https://github.com/google/fonts/tree/main/ofl/sharetechmono>
- **SHA-256:** `9ceab1f87414829af259c0f537573ae03ef7dd3147c0b27a36a1a0beb6732677`

## `strings.i18n.json` — 668 bytes

An `ignifx.i18n` translation document with two locales (`en`, `fr`), `{name}` interpolation, and
ICU-style plurals including an `=0` exact match. An **original work created for this repository**
by Astrum Forge Studios, covered by the repository's Apache-2.0 licence.

---

## Note on the SIL Open Font License

`docs/standards/coding-standards.md` §13 lists the licences ignifx accepts **for dependencies**
(Apache-2.0, MIT, BSD-2/3, ISC, 0BSD, Unlicense, Zlib). OFL-1.1 is not on that list. This font is a
test fixture rather than a dependency, and `CONSTITUTION.md` §11.3 asks only that a sample asset be
licensed for redistribution with its attribution recorded — which this file does. Two conditions of
the OFL travel with the file and are worth stating explicitly, because they would bind anyone who
copied it further: the font may not be sold on its own, and a _modified_ copy may not carry the
reserved name "Share". Shipping it inside a **template** produced by `create-ignifx` is a separate
decision that needs the owner's sign-off, because the attribution requirement would then travel to
every game made from that template.

## Provenance

```sh
curl -L -o ShareTechMono-Regular.ttf \
  https://raw.githubusercontent.com/google/fonts/main/ofl/sharetechmono/ShareTechMono-Regular.ttf
shasum -a 256 ShareTechMono-Regular.ttf
```

The copyright and licence lines above were read out of the downloaded file's own `name` table
(entries 0, 13 and 14), not from a second source.
