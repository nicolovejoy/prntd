# Multi-generator — test checklist

Branch: `feat/multi-generator` (unmerged as of 2026-06-03). Spec `docs/image-gen-multi-generator.md`, plan `docs/image-gen-multi-generator-plan.md`.

## Preconditions
- [x] Schema pushed (`design_image.generator`, `design.active_generator_id` — `db:push` already done; "No changes detected" confirms).
- [x] Replicate + Anthropic local keys valid (probed 200 OK).
- [ ] **Local `IDEOGRAM_API_KEY` is stale (401)** — refresh from ideogram.ai → API, update `.env.local`, restart dev. This is the only thing blocking local testing. (Prod's Ideogram key is 30 days old and presumed valid; verify with one generation on prntd.org if unsure.)
- Run on the `feat/multi-generator` branch (not deployed to prod).

## Smoke test (`/design`)
- [ ] Plain **Generate** works → one image, active model defaults to Ideogram. (Proves the rewire didn't break the existing path.)
- [ ] **Compare** → two gallery images, tagged `ideogram` and `recraft` (bottom-left badge).
- [ ] Open a compared image in the lightbox → **"Use recraft"** → it becomes selected; active model sticks.
- [ ] Plain Generate again → now uses the adopted model.
- [ ] Watch for a **Recraft/Replicate error** on first Compare — the `recraft-ai/recraft-v3` input params (`style: "vector_illustration"`, `size`) were written best-effort; if it errors, check replicate.com/recraft-ai/recraft-v3/api for the exact input field names.

## The decisive question
- [ ] **Does Recraft fix the white-fill bug?** Compare a line drawing (e.g. the Bill Gates one). Is the white interior transparent (garment shows through) or still opaque?
  - If still opaque → the deferred **luminance white-knockout** goes in (sealed, ~one change inside the Recraft adapter — architecture is ready).

## Then decide
- [ ] Cost OK? Compare runs both models (~$0.03 Ideogram + ~$0.08 Recraft internal, opt-in only).
- [ ] Merge call: keep iterating on branch, or PR/merge `feat/multi-generator` → main. (Recommend: don't merge until the Recraft white verdict is in.)

## Known follow-ups
- `ai.ts:91` still suggests "isolated subject on white background" as a negation rephrase — minor prompt cleanup, fold into white-fix work.
- Per-model `adaptPrompt` tuning + an editing axis (Nano Banana–style "remove the glasses") are intentionally out of v1 scope; the interface is shaped for them.
