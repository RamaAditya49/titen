# README assets

Four self-contained SVGs used by the repository root [`README.md`](../../../README.md).

This file describes what is actually in these bytes. An earlier draft of this
note claimed the assets used "CSS keyframes + SMIL only" and that "each one
honours `prefers-reduced-motion`" — neither was true of the files it shipped
with. Verify any claim here against the files before repeating it; the
`grep` commands that check each one are listed below.

## The files

| File | Canvas | Used in | Motion |
| --- | --- | --- | --- |
| `titen-hero.svg` | 1280×360 | top of `README.md` | 4 keyframe animations, all inside `@media (prefers-reduced-motion: no-preference)` |
| `titen-levels.svg` | 1280×360 | under "Memory for a team, not a chatbot" | 2 keyframe animations, same `no-preference` gate |
| `titen-flow.svg` | 1280×620 | end of "You author the claims" | 2 keyframe animations across 3 animated classes, disabled by a `(prefers-reduced-motion: reduce)` guard |
| `titen-benchmark.svg` | 1280×815 | under "Measured against the field" | **none** — the file is deliberately static |

Two different reduced-motion patterns are in use and both are correct:

- **`no-preference` gate** (hero, levels). The base state is the finished
  frame; animation is additive. A renderer that ignores CSS animation entirely
  still shows complete content. This is the safer pattern — prefer it.
- **`reduce` guard** (flow). Elements settle from a small `translateY`.
  Nothing animates opacity up from `0`, so a static rasterisation shows every
  card and connector; the worst case is catching it mid-settle by a few pixels.

`titen-benchmark.svg` carries a `reduce` guard over an empty set on purpose: a
chart whose bars grow on load can be screenshotted mid-flight and misread, so it
has no animation at all, and the guard is there so that stays true under edits.

## Facts that hold for all four

- One `<style>` block per file declaring `.f` (system sans) and `.m` (system
  mono) explicitly. GitHub renders these in an `<img>`, so `@font-face` and web
  fonts never load — an SVG with no `font-family` falls back to a serif face.
  The system stacks are copied from [`../brand/titen-readme-hero.svg`](../brand/titen-readme-hero.svg),
  which is the working reference for this repository.
- No SMIL (`<animate>`), no `<script>`, no `<image>`, no `@font-face`, no
  external `href`. The only absolute URL in any file is the SVG `xmlns`.
- No class is dangling: every `class="…"` in each file resolves in its own
  `<style>` block.
- All four parse as well-formed XML.

Check all of that in one pass:

```sh
cd docs/assets/readme
for f in *.svg; do
  echo "== $f"
  grep -c '<style' "$f"                                   # must be 1
  grep -oE '<animate|<script|<image|@font-face[[:space:]]*\{' "$f" | wc -l   # must be 0
  grep -o 'https\?://[^"]*' "$f" | grep -v w3.org | sort -u      # must be empty
  python3 -c "import xml.dom.minidom;xml.dom.minidom.parse('$f')"
done
```

## Referencing them from README.md

Use the **absolute raw URL on `main`**, never a relative path:

```
https://raw.githubusercontent.com/RamaAditya49/titen/main/docs/assets/readme/<file>.svg
```

`files` in `package.json` is an allowlist —
`["SECURITY.md","src/core","src/runtime/bun","src/sdk.ts","dist/npm"]` — so
`docs/` never reaches the npm tarball. A relative path renders on github.com and
shows a broken image on npmjs.com and on every mirror.

Every `<img>` needs a real `alt` that carries the content, not the filename.
The benchmark and hero alts must name the condition of any figure they mention
(see claim discipline below).

## Re-rendering and re-verifying

**An SVG that has not been rendered and looked at is not done.** GitHub serves
these inside an `<img>`, which is the context that exposes serif fallback,
clipped geometry, and gradients that paint nothing. Rendering the file by
opening it as a document does *not* reproduce that context.

Render every asset the way GitHub does, using the repo's own Playwright:

```js
// scratch script, keep it out of the repo
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'docs/assets/readme';
const browser = await chromium.launch();
for (const f of readdirSync(dir).filter((n) => n.endsWith('.svg'))) {
  const uri = 'data:image/svg+xml;base64,' + readFileSync(`${dir}/${f}`).toString('base64');
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0"><img id="a" src="${uri}"></body>`);
  await page.waitForFunction(() => document.getElementById('a').complete);
  await page.waitForTimeout(2500);              // let entrance animations land
  await page.locator('#a').screenshot({ path: `/tmp/${f}.png` });
  await page.close();
}
await browser.close();
```

Then **open the PNGs**. Also render at `style="width:640px"` — that is a narrow
GitHub column, and it is where small type stops being readable.

Three failure modes that are invisible in the source and only appear in a render:

1. A CSS `transform` from an animation class **replaces** an element's SVG
   `transform` attribute instead of composing with it. An animated
   `<g transform="translate(…)">` collapses to the origin. Put the translate on
   a plain outer `<g>` and the animated class on an inner one.
2. An `objectBoundingBox` `linearGradient` on a perfectly horizontal or vertical
   path paints **nothing** — that bounding box has zero height. Use
   `gradientUnits="userSpaceOnUse"`.
3. Ink `#0B0908` body text on the `#8A5A34` and `#A9552A` accent fills is about
   2.6:1 and unreadable. Use cream `#F7F2E9` on those fills.

For a chart, do not eyeball the bars. Rasterise the rendered `<img>` to a canvas,
walk each bar row to find its right edge, and convert that pixel back to a score
**through the panel's own printed axis**. The pre-repair mockup passed visual
inspection while every bar overstated its score by ~9 points, because the file
passed the bar's *end x-coordinate* as its `width` attribute.

## Numbers to re-check at each release

`titen-benchmark.svg` and `titen-hero.svg` hardcode measured figures. Nothing in
`titen-flow.svg` or `titen-levels.svg` is a measurement — flow carries route
strings only, levels quotes `README.md`'s own four-row table — so those two go
stale only when the API or the product model changes.

**`titen-benchmark.svg`**, two panels with two independent axes. Each bar group
carries its formula as a comment directly above it:

| Panel | Axis | Bar geometry |
| --- | --- | --- |
| A, per-instance (scoped) | 0.75 → x=300, 1.00 → x=1150 | `width = (score − 0.75) × 3400`, from `x=300` |
| B, pooled 19,829 | 0.00 → x=300, 0.30 → x=1150 | `width = score × 2833.333`, from `x=300` |

The `width` attribute is a **width**, not an end coordinate. Get that wrong and
every bar silently overstates itself against the axis printed beside it.

Figures to re-verify, with their source of truth:

| Figure | Source |
| --- | --- |
| Per-instance 0.900 / 0.880 / 0.854 / 0.804, and the 35/12/453, 44/31/425, 27/17/456 sign tests | [`docs/testing/EVALS.md`](../../testing/EVALS.md) |
| Answer-accuracy null, best p = 0.41 | [`docs/testing/EVALS.md`](../../testing/EVALS.md) |
| Pooled 0.246 / 0.212 / 0.182 / 0.174 / 0.164 / 0.124, the 86/25/389 and 76/35/389 sign tests, the −63.4 tax, compile p95 864.9 ms | [`docs/testing/2026-08-07-pooled-store.md`](../../testing/2026-08-07-pooled-store.md) |
| Hero's scoped 0.880 and the pooled curve 0.524 / 0.364 / 0.308 / 0.246 at 1k / 5k / 10k / 19,829 | [`docs/testing/2026-08-07-pooled-store.md`](../../testing/2026-08-07-pooled-store.md) |
| 7.2–16.8 points below FTS-only across three embedding families | [`docs/testing/2026-08-08-pooled-improvements.md`](../../testing/2026-08-08-pooled-improvements.md) |

If a release changes any of those, the image and the README prose both change.
The images are not a separate source of truth and must never disagree with
`docs/testing/`.

## Claim discipline applies to images

The [claim-discipline list](../../testing/EVALS.md#claim-discipline) binds these
files exactly as it binds prose. In particular:

- **Never put a LongMemEval-S figure on an image without naming its condition** —
  per-instance (scoped) or pooled. Both panel headings and the hero's chip and
  footnote do this.
- **Never show the FTS-only lane above a ~10³-session store shape without the
  pooled degradation curve beside it.** That is why the hero carries the
  0.880 → 0.524 / 0.364 / 0.308 / 0.246 footnote rather than a bare 0.880.
- **Never imply the vector arm helps without naming the condition.** It is +2.0
  points per-instance at p = 0.174 (unproven) and −3.4 points pooled.
- **Losses get the same prominence as wins.** The benchmark's caveat block
  carries the two fired falsifiers and the flat answer-accuracy null at the same
  type size as the leaderboard. Do not shrink it to make room for a bar.

An image is quoted far more often than the paragraph under it, and it travels
without that paragraph. Anything that cannot be quoted bare does not belong on
one.
