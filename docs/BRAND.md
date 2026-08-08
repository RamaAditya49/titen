# Titen brand guide

Status: contributor reference derived from the supplied Titen identity system.
The repository SVG files are canonical for the current mark geometry.

## Brand idea

Titen is quiet infrastructure that helps agents remember, verify, and
coordinate. The identity should feel precise, dependable, culturally grounded,
and lightweight—not like a generic glowing AI product.

Primary descriptor:

> Collaborative memory for AI agents.

Supporting line:

> Evidence-grounded context. Safe parallel work.

Use lowercase `titen` in the wordmark and ordinary title case in prose.

## Logo system

### Kawung mark

The primary mark is a four-petal Kawung construction. The petals represent
`tenant · subject · agent · run` meeting at one evidence core. They touch at the
center but do not overlap.

Canonical assets:

- [square mark](./assets/brand/titen-mark.svg);
- [README hero](./assets/brand/titen-readme-hero.svg).
- [Social preview](./assets/brand/titen-social-preview.png) — the card GitHub
  shows when the repository link is shared. GitHub has **no API for it**: upload
  it by hand at Settings → General → Social preview. Re-render it from the hero
  whenever that asset's copy changes, at 2x on a 1280x640 frame so the ink
  ground fills the slot:

  ```js
  // from the repo root, with @playwright/test resolvable
  await page.setViewportSize({ width: 1280, height: 640 });
  // …render docs/assets/brand/titen-readme-hero.svg centred on #171310, screenshot at deviceScaleFactor 2
  ```

Rules:

- lead with the Kawung mark for repository, product, avatar, and favicon use;
- keep its orientation fixed;
- preserve the exact petal geometry and tangent center;
- use one-color or Ink/Gading with one Soga accent;
- keep clear space of at least 20% of the mark's width on every side;
- at less than 24 px, remove the inner core ring and use solid petals;
- minimum rendered size is 16 px;
- do not add gradients, bevels, glow, drop shadows, gaps, or overlapping petals.

Do not recreate the mark from a font or substitute a flower icon.

### Wordmark

The wordmark is lowercase `titen` in Bricolage Grotesque, weight 600. Use the
Kawung mark to its left for the primary horizontal lockup. The descriptor uses
Instrument Sans; small technical labels use JetBrains Mono.

Do not stretch, outline, italicize, or typeset the wordmark in all caps.

## Mascot: Cak

Cak is a house gecko: small, observant, and present at the edge rather than the
center. It is a secondary character for:

- documentation headers;
- empty-memory states;
- page-edge moments;
- 404/error illustrations;
- stickers and community material.

Cak never appears inside the primary logo lockup, avatar, or favicon. Reuse the
approved watching, climbing, resting, or peeking poses when mascot artwork is
added; do not invent a new mascot style for each surface.

## Color

| Token      | Hex       | Role                                    |
| ---------- | --------- | --------------------------------------- |
| Ink        | `#171310` | primary text, dark surfaces, logo base  |
| Soga       | `#A9552A` | attention, status, links, mascot detail |
| Soga light | `#C97A44` | accent on Ink backgrounds               |
| Wedel      | `#223A57` | runtime and infrastructure information  |
| Gading     | `#F7F2E9` | paper background and light mark         |
| Warm gray  | `#8A7F72` | secondary labels                        |
| Border     | `#CFC4B2` | light-surface boundaries                |

Soga and Wedel are distinct semantic accents. Do not apply both to one element.
Use color sparingly and preserve accessible text contrast.

## Typography

| Use                  | Typeface            | Weight  |
| -------------------- | ------------------- | ------- |
| display and wordmark | Bricolage Grotesque | 600–800 |
| body and interface   | Instrument Sans     | 400–600 |
| code, badges, labels | JetBrains Mono      | 400–700 |
| Javanese accent      | Noto Sans Javanese  | 600     |

For GitHub-hosted SVGs or environments where brand fonts cannot load, use a
stable system sans-serif/monospace fallback. Never convert long body text to
outlines.

## Layout and imagery

- Prefer Ink or Gading surfaces, thin rules, clear grids, and generous negative
  space.
- Use one strong idea per composition.
- A tiled Kawung pattern may appear at 6–14% opacity on dark hero surfaces only,
  never behind body text.
- Product imagery should show believable context, provenance, runtime, or agent
  coordination—not humanoid robots, random nodes, neon gradients, or fake dense
  dashboards.
- Keep README and social graphics honest: status and runtime labels must reflect
  implemented, verified state.

## Badge style

Badges are flat, compact, and monospace. Use neutral Ink labels; reserve Soga for
status requiring attention and Wedel for verified runtime information.

Do not publish badges for version, MCP readiness, dependency count, bundle size,
coverage, or runtime support until the corresponding artifact or measurement
exists.

## Voice

Titen's writing is direct, calm, and technical:

- explain evidence and limits before aspiration;
- distinguish implemented behavior from target design;
- prefer concrete verbs such as observe, verify, compile, hand off, and restore;
- avoid “revolutionary,” “magical,” “human-like memory,” and benchmark hype;
- use “agent” for software identity and “human” for a person, not “user” for
  both when authority matters.

## Asset changes

Logo geometry, primary colors, or mascot role are durable brand decisions. A
change should update this guide, the canonical SVGs, README application, and any
generated social assets in one pull request.
