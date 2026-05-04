# Ideogram Native Transparent — Swap Plan

Status as of 2026-05-03 evening: empirical test confirmed Ideogram's
direct-API `generate-transparent` endpoint produces clean RGBA PNGs
with text rendered correctly on the two designs that broke under
the old matting-model pipeline (ogre with "STOP PLATE TECTONICS!"
caption, scale with "WORDS ARE BIASED" lettering). Quality is on
par with Replicate v3 Turbo aesthetically; alpha channels are
genuinely transparent (51–86% transparent pixels in the test outputs).

The decision is to swap the entire image pipeline to Ideogram direct
API and delete bg-removal entirely. This document is the implementation
plan to execute in a fresh session after `/clear`.

## Pre-flight (Nico, before /clear)

- [ ] Verify `IDEOGRAM_API_KEY` is in `.env.local` (already done, value pulled from 1Password item `IdeogramAPI`).
- [ ] Note the per-image cost for `generate-transparent` from https://ideogram.ai/manage-api so we know our $20/mo math.

## Implementation steps (Claude, in fresh session)

### 1. Wire `generateTransparent` into the generation flow

`src/lib/ideogram.ts` already exists (committed in the swap-plan
prep). It exposes `generateTransparent(prompt, aspectRatio, { seed?, negativePrompt? })`
returning a URL.

In `src/app/design/actions.ts:generateDesign`:
- Replace `generateImage(...)` + `removeBackground(...)` block with a
  single `generateTransparent(aiResponse.fluxPrompt, "1:1", { negativePrompt: aiResponse.negativePrompt })` call.
- Delete the skip-when-text heuristic (regex on `aiResponse.fluxPrompt`)
  and the `promptHasText` variable. No longer needed.
- Remove the `removeBackground` import.

In `src/app/preview/actions.ts:regenerateForPlacement`:
- Same swap. Call `generateTransparent(lastPrompt, targetAspect)`
  instead of `generateImage` + `removeBackground`.
- Delete the same skip-when-text heuristic block.

In `src/lib/replicate.ts`:
- Keep the file; bg-removal code stays until we confirm the swap holds.
- After ~1 week of clean operation, delete `removeBackground` and the
  Replicate-based `generateImage` (Phase 2 of the swap, separate commit).

### 2. Reference image handling

The current flow passes a previous generation as `style_reference_images`
to Ideogram via Replicate. Verify the direct API supports this — if
it does, add a `referenceImages` option to `generateTransparent` and
thread it through. If it doesn't (the docs I pulled didn't mention
it for the transparent endpoint), accept the loss for now and note
as a follow-up.

### 3. Type-check, lint, build

```
npx tsc --noEmit
npm run lint
npm run build
```

Fix anything new. Pre-existing `printful.test.ts` mock-typing error
stays as-is (separate issue).

### 4. Local dev test

Restart dev server. Generate three test designs:

- One with a quoted text caption (the case that was failing pre-swap)
- One purely visual (no text)
- One that switches products mid-flow to trigger
  `regenerateForPlacement` — verify it calls `generateTransparent` too

For each, confirm:
- Image renders cleanly in /design gallery on both Dark and Light
  toggles (no white halo on Dark)
- /preview Printful mockup looks right on the chosen color
- /order checkout page shows the mockup
- Console logs show no Replicate `removeBackground` calls

### 5. Vercel env (Nico)

Add `IDEOGRAM_API_KEY` to Vercel for production, preview, and development:

```
op item get IdeogramAPI --vault dev-secrets --fields credential --reveal | vercel env add IDEOGRAM_API_KEY production
```

Repeat for `preview` and `development`. Use the `vercel env rm ... --yes`
+ `vercel env add` pattern from earlier in the session if there's an
existing value to replace.

### 6. Commit + push

Single commit titled along the lines of:

```
swap to Ideogram native transparent generation

Drop the matting-model bg-removal pipeline (Bria → BiRefNet) in favor
of Ideogram's direct API generate-transparent endpoint. Returns RGBA
PNGs natively, no second model call, no text-stripping failure mode.

Removes the skip-when-text heuristic from design/actions.ts and
preview/actions.ts (no longer needed). Replicate-based generateImage
and removeBackground left in src/lib/replicate.ts for one release as
a fallback option, removed in a follow-up commit.

Requires IDEOGRAM_API_KEY env var; pulled from 1Password item
IdeogramAPI in dev, set on Vercel for production/preview/development.
```

### 7. Production smoke test

After Vercel auto-deploys:
- Generate one new design in prod
- Verify the image is RGBA (download and check, or open in a viewer
  that shows transparency clearly)
- If anything looks off, revert by reverting the commit — code is
  still capable of running the old path because we left the Replicate
  functions intact.

## Out of scope for this swap

- Removing the Replicate bg-removal code (Phase 2 cleanup, after
  ~1 week of clean operation)
- Changing the `magic_prompt` setting from OFF to AUTO (might improve
  output quality but changes baseline behavior; separate experiment)
- Multi-placement generation (Phase 4 of print-targets, unrelated)
- Backfilling historical designs with transparent versions (no business
  need; existing designs in R2 stay as-is)

## Rollback plan

If production output is materially worse than expected:

1. Revert the swap commit.
2. Vercel auto-deploys the revert.
3. Old matting + skip-when-text path is back, including today's
   text-stripping limitation.

The revert is clean because `src/lib/replicate.ts:generateImage` and
`removeBackground` are not deleted in this swap.

## Background context

- Test output: `/tmp/ideogram-test/` — three PNGs from the empirical test.
- Test script: `scripts/test-ideogram-transparent.ts` — re-runnable with `node --env-file=.env.local --import tsx scripts/test-ideogram-transparent.ts`.

## Cost note

User ceiling: $20/month on Ideogram direct API. At Ideogram's typical
v3-class pricing ($0.05–0.10/image) that's 200–400 images/month
headroom — well above current PRNTD volume. Worth double-checking
the exact `generate-transparent` price on the manage-api dashboard
once the user has it in front of them.
