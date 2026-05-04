# Chroma-Key Background Removal — Design Doc

A different agent is being asked to sanity-check this proposal before implementation. Push back, suggest alternatives, or flag pitfalls if you see them.

## Context

PRNTD is an AI-powered t-shirt designer (live at prntd.org). The pipeline:

1. User chats with Claude (Sonnet 4.6).
2. Claude constructs an Ideogram v3 Turbo prompt.
3. Replicate runs Ideogram → returns an RGB PNG with whatever background Ideogram chose (usually flat white or near-white).
4. Server runs a bg-removal model on Replicate to produce an RGBA PNG with transparent background.
5. Final PNG is shipped to Printful for printing on t-shirts, phone cases, etc.

The transparent background matters because:
- Designs go on multiple shirt colors. White-bg designs print as a hard white block on dark/colored shirts.
- One product is a *clear* iPhone case. Any opaque bg shows as a visible rectangle on the case glass.

## Problem

We've cycled through two bg-removal models and confirmed today neither works for designs with rendered text:

- **Bria (`bria/remove-background`)** — silently returned the un-removed image for hand-painted / soft-edge designs. We caught the un-removed output downstream but had no signal to retry.
- **BiRefNet (`851-labs/background-remover`)** — succeeds at removing flat backgrounds with crisp edges. But for any design where Ideogram renders standalone text (a "STOP PLATE TECTONICS!" caption under a figure, a "WORDS ARE BIASED" tagline, etc.), BiRefNet classifies the text region as background and strips it entirely. Threshold tuning doesn't help — at threshold 0 (soft alpha) the text becomes washed-out / see-through; at threshold 0.5 (hard segmentation) it's gone.

Today's stop-gap was a heuristic in `src/app/design/actions.ts` and `src/app/preview/actions.ts`: detect quoted strings in the Ideogram prompt as a "this design has rendered text" signal, and skip bg-removal entirely when present. Confirmed working but trades transparency for text — text-bearing designs ship with whatever flat bg Ideogram drew, which prints as a visible block on dark shirts and clear cases.

The user wants both — text preserved AND transparent background.

## Root cause

Matting models (Bria, BiRefNet, rembg, etc.) are trained on single-subject portrait/object data — humans, animals, products, single connected blobs of pixels. They don't reliably handle multi-region foregrounds where one region (a figure) is connected and another region (a caption) is detached. Detached secondary elements get classified as background.

This is a model-class problem. Tuning thresholds, swapping between matting models, or trying different ones is unlikely to fix the underlying behavior.

## Proposed solution: chroma-key removal

Instead of relying on a matting model to *infer* what's foreground, *tell* Ideogram to use a specific known background color, then post-process by replacing that color with transparency.

This is the green-screen technique from film, applied to design generation.

### Pipeline

1. **Prompt construction** (`src/lib/ai.ts:constructFluxPrompt`): when generating a design, append explicit bg-color instruction to the Ideogram prompt. Magic color: `#FF00FF` (neon magenta) or `#00FF00` (chroma green). Magenta is rare in real designs; green is more common but more reliable in matting research. Pick one and stick with it.
   - Prompt addition: `"flat solid #FF00FF magenta background, no shadows, no gradients, subject and any text fully isolated against this exact background color"`.

2. **Generation** (`src/lib/replicate.ts:generateImage`): unchanged. Ideogram returns RGB PNG with magenta background.

3. **Chroma-key removal** (new function, replaces `removeBackground`): server-side pixel op using `sharp`:
   - Load image as raw RGBA buffer.
   - For each pixel: compute color distance to the magic color in HSL space (HSL is more perceptually meaningful than RGB for chroma matching).
   - If distance < HARD_THRESHOLD → alpha = 0 (full transparent).
   - If distance < SOFT_THRESHOLD → alpha decays linearly from 0 to 255 across the band (preserves anti-aliased edges).
   - Else → alpha = 255 (fully opaque), and optionally desaturate any residual magenta tint to reduce color spill.
   - Save as PNG with alpha.

4. **Validation** (post-removal sanity check): sample the four corners of the resulting alpha channel. If most corner pixels are still opaque → Ideogram didn't comply with the bg color, fall back to BiRefNet OR ship the original.

### Why this should work

- **Deterministic** — pixel-level color matching, no model inference. No silent failures.
- **Foreground complexity is irrelevant** — text, fine lines, multi-region subjects, any of it: as long as it's not magenta, it stays.
- **Cheap** — replaces one Replicate API call with a local CPU op. Faster, cheaper, no 429 risk.
- **Anti-aliasing handled** — soft tolerance band gives smooth edges.

## Risks and open questions

### Risk 1: Ideogram doesn't comply with bg color request

Ideogram's prompt-following is decent but not perfect. It might generate a slightly off-magenta, or ignore the request entirely.

- Mitigation A: tolerance is wide enough (HSL distance of 0.15–0.25?) to catch off-magenta variants.
- Mitigation B: validation step detects non-compliance and falls back to BiRefNet (with the existing skip-when-text heuristic).
- Open: how often does Ideogram ignore explicit bg color? Need empirical data — probably <10% based on prior experience but unknown.

### Risk 2: Subject contains the magic color

If a customer asks for "magenta lettering" or the design legitimately uses magenta, those pixels become transparent.

- Mitigation A: pick the rarest possible color. Some pure RGB triplets are essentially never used in design (e.g., #FF00FF, #00FF00 pure neon). Pure greens are also rare in stylized illustration.
- Mitigation B: if a user explicitly requests the magic color in their prompt, swap to a backup magic color (e.g., neon green if magenta is requested).
- Open: is it worth detecting this case automatically, or accept it as an edge case?

### Risk 3: Color spill at edges

Anti-aliased edges between subject and bg have pixels that are 50/50 mixes (e.g., the edge of black text on magenta bg has reddish-purple anti-alias pixels). Without spill suppression, the edges keep a magenta tint.

- Mitigation: spill suppression — for any pixel within tolerance band but with alpha > 0, subtract the magenta component from its color (clamping to 0). Standard chroma-key practice.

### Risk 4: Compression artifacts

Ideogram returns PNG (lossless), so no JPEG noise around bg color. But internal model dithering might still introduce variance.

- Already covered by the soft tolerance band. Probably not a real problem.

### Risk 5: Existing designs in R2

All historical designs in R2 (~15+ printed orders) were generated under the old pipeline (white background → matting). They will keep showing as today. Only new generations get chroma-key.

- Acceptable. No backfill needed.

## Implementation plan (rough)

1. Add `sharp` if not already in deps (likely already installed via Next image — verify in `package.json`).
2. New function `src/lib/chroma-key.ts:removeChromaKey(imageUrl, magicColor, options)`. Returns a buffer or new R2 URL.
3. Update `src/lib/ai.ts:constructFluxPrompt` to append magic-bg-color instruction to all generated prompts.
4. Update `src/app/design/actions.ts:generateDesign` and `src/app/preview/actions.ts:regenerateForPlacement`:
   - Replace `removeBackground` call with `removeChromaKey`.
   - Remove the existing skip-when-text heuristic (no longer needed — chroma-key handles text fine).
   - Keep validation: if chroma-key removed nothing (compliance failure), fall back to BiRefNet with the skip-when-text heuristic as second-line defense.
5. Test against:
   - "STOP PLATE TECTONICS!" ogre design (the failing case from today)
   - "WORDS ARE BIASED" scale design (the failing case from earlier today)
   - A purely visual design with no text (verify chroma-key still produces clean transparency for the easy case)
6. Ship behind a feature flag or with the BiRefNet fallback so a regression doesn't kill all generation.

## Comparison to the alternatives I considered

| Option | Effort | Reliability | Cost per design | Notes |
|---|---|---|---|---|
| Try `lucataco/remove-bg` | 30 min | Unknown — probably same matting-model problem | +1 model call | Quick test but unlikely fix |
| Composite preserve (BiRefNet + text overlay from original) | 4-6 hrs | Medium — depends on text detection | +1 model call | Complex, fragile |
| Two-stage generation (subject + text separately) | 1-2 days | High but architecturally heavy | +2 model calls | Major rewrite of prompt construction |
| **Chroma-key** | **1-2 hrs** | **High if Ideogram complies** | **-1 model call** | **This proposal** |
| Switch to a transparent-PNG generator (Flux variants) | 2 days exploration | Unknown, model-dependent | Varies | Big swap, kills Ideogram's text quality |

## Questions for the reviewing agent

1. Is there a known-better magic color than #FF00FF / #00FF00 for design contexts? Some chroma keying research suggests a specific cyan or a custom unique color. Worth picking based on data?
2. Is the spill-suppression formula above (subtract magenta component) sufficient, or should we use a more sophisticated unmix (e.g., despill maps)?
3. Should we run chroma-key in HSL or LAB color space? HSL is simpler and probably sufficient; LAB is more perceptually uniform but more code.
4. Does Ideogram v3 Turbo specifically have known issues with following bg-color instructions? Any prior art / community reports?
5. Is there a concern about Printful's mockup generator handling alpha PNGs — do they composite cleanly onto the product surface, or do they have artifacts at edges?
6. Is there a smarter image-generation model that natively outputs transparent backgrounds that I should consider before going down this path?

## Out of scope

- Multi-placement (front + back of shirt) — separate Phase 4 work.
- Switching away from Ideogram — Ideogram's text rendering is the best in class, so we want to keep it.
- Backfill of historical designs — small dataset, no business need.
