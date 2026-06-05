# Multi-generator image generation

Status: spec — 2026-06-03

## Why

Today PRNTD has one generation strategy hard-wired: Claude builds an Ideogram prompt, then either Ideogram's native transparent endpoint (first pass) or Ideogram-via-Replicate + BiRefNet (anchored refinement) runs it. Two problems surfaced:

1. **White interior fills don't drop out.** A black-line cartoon on a colored shirt keeps opaque white face/shirt/paper, because raster output + subject matting treat interior white as part of the subject. The user wants the garment to show through ("keep the ink, drop the paper").
2. **No way to compare models.** Different styles favor different models (Ideogram for text, vector models for line art). The user wants to pick the generator per design and compare on the same design — no blind switch from one fixed model to another.

The resync (`see chat 2026-06-03`) concluded: don't replace Ideogram, make the generator a per-design choice behind a clean abstraction, and let the vector adapter solve the white-fill problem structurally rather than with a post-process hack.

## Decisions (all confirmed with the user)

- **Outcome A** for the white problem: the garment shows through white areas. Solved by routing line-art designs to a **vector** generator (Recraft), whose line art has genuinely empty/transparent fills — not by a luminance knockout. The stale "white background, isolated design" prompt instruction is removed as hygiene regardless.
- **Adapter abstraction**: one `ImageGenerator` interface, one file per model. All model-specific behavior is sealed inside the adapter; the flow / UI / data model only handle a generator id and a transparent PNG.
- **Default single-model + opt-in Compare**: plain Generate uses the design's active model (one image). Compare runs the same prompt through all v1 adapters and shows both, tagged.
- **Active generator sticks to the design**: adopting a compared image sets the design's active generator; subsequent Generates use it until changed.
- **v1 adapters**: `ideogram` (current behavior) + `recraft` (vector/line-art).
- **Phasing**: v1 is generation-only. Per-model prompt tuning (`adaptPrompt`) and an editing axis (Nano Banana–style "remove the glasses") are later, and the interface is shaped now so they drop in without restructuring.

## Architecture

New `src/lib/generators/`:

```
interface ImageGenerator {
  id: string                  // "ideogram" | "recraft"
  label: string               // "Ideogram" | "Recraft"
  adaptPrompt(base: string): string                       // v1: identity. Later: per-model prompt shaping, sealed here.
  generate(prompt: string, opts: {
    aspect: AspectRatio,
    referenceImageUrl?: string                            // optional continuity anchor for refinements
  }): Promise<string>                                     // returns a transparent-PNG URL/bytes, normalized
}
```

- `registry.ts` — `GENERATORS: Record<string, ImageGenerator>`, `DEFAULT_GENERATOR_ID = "ideogram"`, `getGenerator(id)` (falls back to default for unknown/null ids).
- `ideogram.ts` adapter — wraps today's two endpoints. Without `referenceImageUrl` → native transparent endpoint. With one → the Replicate + BiRefNet style-ref path. Both sealed inside; the divergent top-level branch in `generateDesign` goes away. Owns transparency normalization (drops the stale white-bg instruction; native transparency or BiRefNet as today).
- `recraft.ts` adapter — calls Recraft's API for vector/line-art transparent output. New env var `RECRAFT_API_KEY`. Normalizes to a transparent raster PNG at the requested aspect (the rest of the app stays raster; vector is an internal advantage, not a new downstream format in v1).

Anchoring (refine continuity) becomes the optional `referenceImageUrl` arg — each adapter does continuity its own way; the separate BiRefNet path stops being a top-level concept.

## Prompt layer

Extract prompt construction from the `ai.ts` system-prompt blob into its own unit (e.g. `src/lib/generators/prompt.ts` or keep in `ai.ts` but as a focused function). The shared Claude-built prompt is produced once and passed to each selected adapter's `generate` (via `adaptPrompt`, identity in v1). Remove the "Always include 'white background, isolated design'" instruction.

## Data model

- `design_image.generator` — nullable text. Provenance: which adapter id made the image. Null = historical (pre-feature).
- `design.active_generator_id` — nullable text, resolves to `DEFAULT_GENERATOR_ID` when null. The thread's current model.

Both pushed to Turso via `db:push`.

## Flow changes (`src/app/design/actions.ts`)

- `generateDesign(designId, userMessage?)` — unchanged signature/behavior, but image generation routes through `getGenerator(design.activeGeneratorId).generate(...)` instead of the inline `generateTransparent` / `generateAnchoredTransparent` branch. Records `generator` on the new `design_image`.
- New `compareGenerators(designId, userMessage?)` — builds the prompt once, runs every registry adapter's `generate` in parallel, inserts one `design_image` per result (each tagged with its `generator`), appends one assistant chat message summarizing the comparison. Does **not** change the active generator. Returns the set of new images.
- New `adoptGenerator(designId, imageId)` — sets `design.active_generator_id` to that image's `generator` and `primary_image_id` to the image. Owner-auth, same pattern as other design actions.

## UX (phone-first)

- `chat-panel` generate bar: keep **Generate** (active model, one image); add **Compare** beside it.
- Compare calls `compareGenerators`, the resulting images land in the existing gallery, each card shows a small model tag (from `generator`).
- Tapping a compared image's "Use this" (or the existing select affordance) calls `adoptGenerator` → it becomes active + primary. A subtle indicator shows the current active model near Generate.

## Testing

- Pure: `getGenerator` fallback (unknown/null → default); registry shape.
- Pure: `adaptPrompt` identity for v1 adapters.
- Adapter normalization is integration-ish (hits APIs) — keep those behind thin wrappers and unit-test the pure parts (prompt assembly, option mapping). No live API calls in the test suite.
- Action-level logic (which generator resolved, provenance recorded, active-generator set on adopt) tested with mocked adapters/db where the existing tests do.

## Out of scope (v1)

- Per-model prompt tuning beyond the `adaptPrompt` seam (later).
- Editing axis / instruction edits (later, separate effort).
- Vector/SVG as a downstream print format (v1 normalizes Recraft to raster PNG).
- More than two adapters.
- Changing the compare UX to a multi-select (only needed at 3+ models).

## Open items to verify during build

- Confirm Recraft's API produces transparent fill-free line art for the line-drawing case (the core outcome-A claim). If it doesn't cleanly, fall back to prompt-fill-free + luminance knockout inside the Recraft (or Ideogram) adapter — sealed, no architecture change.
- Recraft aspect-ratio + transparent-PNG options and exact endpoint/pricing against official docs.
