# Model review

A check, about every two months, of whether a better image model or design-brief model exists than the ones prntd uses. Nico asked for it on 2026-11-04. A scheduled cloud routine repeats the research and opens a GitHub issue. Each run adds a dated section at the top of "Reviews" (newest first) through a PR.

## What prntd needs from an image model

1. A transparent-background PNG, because the print is a cut-out on a coloured shirt. Native alpha is best. A separate background-removal step works only if it keeps hard edges and lettering clean.
2. Lettering. Many designs are slogans or logo-style type, and Ideogram was chosen for this.
3. An edit endpoint that keeps both the design and the transparency (the Studio's follow-up turns are edits).
4. Resolution for a 12×16 in DTG front. About 3000 px on the long side, or an upscale step.
5. Price and latency per generate and per edit.
6. Commercial terms that allow printing the output on merchandise sold to customers.

## What prntd uses (verify in the code each run)

- Generate: Ideogram v4 `generate-transparent` at `rendering_speed=TURBO` (`src/lib/ideogram.ts`, endpoint `https://api.ideogram.ai/v1/ideogram-v4/generate-transparent`), billed as $0.03 in `costFor()`.
- Edit: Ideogram `https://api.ideogram.ai/v1/edit` with `transparent_background`, billed as $0.20 in `costFor()`. That price has never been checked against a bill.
- Generator plumbing: `src/lib/generators/` (registry, Ideogram generator).
- Design brief: Claude `claude-sonnet-4-6` in `src/lib/ai.ts` (`constructDesignBrief` and the order and publish naming calls).

## Reviews

### 2026-11-04 (first review, a Sonnet research agent, web only)

Much of this came from secondary sources. Ideogram's API pricing tab renders client-side, and OpenAI's pricing section was truncated when read.

Ideogram:
- Ideogram 4.5 launched 2026-09-30. It is edit-focused, with a "precise edit" endpoint (mask optional, up to 4 references).
- A v2 API exists (`/v2/image/generate/ideogram-4-5`, `/v2/image/precise-edit/ideogram-4-5`, `/v2/image/remove-background/ideogram-1`). The overview says v1 "keeps working", and no deprecation is announced. https://developer.ideogram.ai/ideogram-api/api-overview
- The v2 docs mention no `generate-transparent`. Native alpha for 4.x is "planned". https://ideogram.ai/models/4.0/
- v4 generate tiers: Turbo $0.03, Default $0.06, Quality $0.10 (Ideogram's model page). The edit price is unverified: one third party lists $0.20, and 4.5's announcement gives 0.8 to 22 cents by tier.
- On Artificial Analysis's text-to-image leaderboard, Ideogram 4.0 (Quality) is 30th and 4.5 is 40th. That board ranks general quality, not lettering or print art.

Candidates:
- OpenAI GPT Image 2.5 (Flare for generating, Sunburst for edit precision).
  - It leads both Artificial Analysis boards (text-to-image and editing).
  - The API has `background: transparent`, and a third party saw real alpha.
  - It has an edit endpoint; whether an edit keeps transparency is unverified.
  - Price is roughly $0.05 to $0.21 per image by quality; unverified against OpenAI's page. Maximum resolution is unverified.
- Google Nano Banana 2.1 (launched 2026-10-06). 4th for text-to-image, 5th for editing. About $0.034 at 1K, $0.050 at 2K, $0.076 at 4K (reseller reports). Native transparency is unconfirmed.
- FLUX 3 Image. About $0.048 at 1K, up to 4K, edits with references. No transparency found.
- Recraft V4 / V4.1. Native SVG (vector $0.08, raster about $0.04). Good with short text. Transparent PNG is unconfirmed. SVG would scale cleanly to the print size.
- Qwen-Image-2.1. RGBA output, but the open weights carry a research license; check commercial terms before considering it.
- Seedream 5.0 Pro (about $0.09) and Midjourney (no API found, unverified) were not looked at closely.

Conclusion: Ideogram is still a reasonable fit. Nothing found shows a rival beating it on lettering for print art. Worth a bake-off on about 20 real prompts: GPT Image 2.5 (check alpha edges, check that an edit keeps transparency, and cost), and Nano Banana 2.1 through a background-removal step. Recraft V4.1 is a third option if SVG output matters. Before the bake-off, read Ideogram's real per-call prices from the billing page. Separately, `claude-sonnet-4-6` is two generations behind the current Claude family. Compare briefs from the current Sonnet on the same prompts before switching.
