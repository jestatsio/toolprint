# toolprint branding

![The toolprint fingerprint guardian](assets/mascot.png)

The mascot is an original fingerprint-ridge guardian checking a tool's identity card with a
magnifying glass, padlock in hand — the product in one picture: fingerprint, verify, lock.
Its palette is toolprint's existing one from the README banner: deep navy `#050B18`, emerald
`#34D399` and teal `#2DD4BF` grading to cyan `#22D3EE`, cream `#FAF9F5`, with a small brass
accent on the padlock. Host brand color is `#0D9488`.

## Assets and host integration

- `assets/mascot.png`: original 1024 × 1024 RGBA PNG with genuine transparent corners. The
  canonical copy lives at the repository root in `assets/`; `docs/assets/` carries a copy for
  this site.
- `assets/icon.svg`: the fingerprint-and-padlock seal from the banner, as a standalone app
  icon. Used as this site's logo and favicon.
- `assets/install-claude.svg`, `assets/install-code.svg`, `assets/install-codex.svg`: the
  install buttons used in the README and on this site, drawn to the same 52 px pattern as the
  other JEStats plugins.
- Claude Desktop: the MCPB `icon` points to the bundled mascot PNG.
- Codex: `logo`, `logoDark`, and `composerIcon` point to the mascot PNG; `brandColor` is teal.
- Claude Code: its manifest has no custom icon field; the mascot ships in the package and
  heads the README.

`test/packaging.test.ts` checks that every manifest references files that exist and that the
mascot stays a square PNG of at least 512 px. Those checks verify configuration; how each
host renders the icon still deserves a visual check after install.

## Generation prompt

The mascot was created with an image-generation tool from this brief, then keyed from its
white background to transparency, trimmed, and square-padded. The wording matters: it is why
the artwork reads at 48 px and carries no stray text.

```text
Use case: logo-brand.
Asset type: original transparent mascot logo for "toolprint", a security scanner for AI agent
tools, used as plugin icons, README art, and docs site mascot.
Primary request: an original friendly fingerprint guardian character checking the identity of
a small robot tool.
Subject: one compact, charming character whose round head and body are formed by bold
concentric fingerprint ridges — thick curved teal-and-cyan ridge lines wrapping a friendly
face with two alert dark eyes and a subtle confident closed-mouth smile. It sits upright
holding a small brass padlock in one stubby hand and a magnifying glass in the other,
inspecting a simple cream-colored ID card that shows one plain wrench silhouette and a green
checkmark.
Style/medium: premium contemporary flat mascot logo illustration, crisp clean vector-like
contours, substantial dark-navy outlines, simple confident shapes, restrained two-tone
shading, no realistic texture. Professional and personable. Strong silhouette that stays
readable as a 48px app icon.
Composition/framing: square, one centered mascot fills approximately 80 percent of the frame,
generous consistent transparent padding on all sides. Whole character, padlock, magnifying
glass, and ID card fully visible, no cropping. No wordmark, no border, no background badge.
Color palette: deep navy #0B1526 outlines and pupils, emerald #34D399 and teal #2DD4BF
fingerprint ridges grading to cyan #22D3EE, warm cream #FAF9F5 for the ID card, small brass
#D9A441 accent on the padlock only. Avoid neon clutter and purple.
Constraints: genuinely transparent background; one complete original logo only, no sheet of
variations, no mockup, no watermark, no text or letters anywhere. Keep small-icon details
simple and high contrast.
```
