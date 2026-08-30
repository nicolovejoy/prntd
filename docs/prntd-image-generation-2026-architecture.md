# PRNTD Image Generation — 2026 Architecture Update

## Current State

PRNTD currently generates T-shirt artwork through this flow:

```text
User chats on /design
        ↓
Claude Sonnet interprets conversation
        ↓
Claude produces an Ideogram-oriented image prompt
        ↓
Ideogram v3 Turbo renders image
        ↓
Transparent PNG produced or background removed
        ↓
Upload to Cloudflare R2
        ↓
Create image + conversation_image rows
```

### Key files

- `src/lib/ai.ts`
  - `chatAboutDesign`
    - Returns JSON envelope including `readyToGenerate`
  - `assessReadiness`
    - Haiku-based ~1s readiness pre-check
  - `constructFluxPrompt`
    - Builds image-generation prompt
    - Returns empty on failure instead of falling back to generic style boilerplate

- `src/lib/design-prompt.ts`
  - Pure guards for:
    - generation-intent triggers
    - `isClarificationOnly`

- `src/lib/generators/ideogram-generator.ts`
  - Currently the only image generator
  - No reference image:
    - Ideogram native `generate-transparent`
    - native RGBA output
  - With reference image:
    - Ideogram v3 Turbo via Replicate
    - BiRefNet background removal

- `src/lib/ideogram.ts`
  - Native Ideogram API path
  - 120s timeout

- `src/lib/replicate.ts`
  - Replicate API path
  - 120s timeout

- `src/app/design/actions.ts`
  - `generateDesign`
  - quota check
  - `reserveGenerationNumbers()` atomically reserves generation numbers and R2 keys
  - generates image
  - uploads to R2
  - performs one `db.batch`
  - refunds quota and deletes orphan R2 objects on failure

- `src/lib/r2.ts`
  - Uploads image bytes verbatim to:
    - `images/{imageId}.png`

### Current constraints

- Target generation cost: approximately `$0.03/image`
- Cost accumulates on the design row
- Generation cost is not directly charged to the customer
- Daily quota enforced per identity + per IP via `generation_usage`
- Transparency is important because artwork is printed on colored shirts

---

# What Has Changed in the Image-Generation Market

The major change is that PRNTD should no longer be architected around one hard-coded image provider.

Several current APIs are now competitive for different parts of the workflow:

| Provider / model | Best PRNTD use | Approx. cost | Native transparency | Editing / reference support |
|---|---|---:|---|---|
| Ideogram 4 Turbo | Default T-shirt design generation | ~$0.03 | Yes | Yes |
| Recraft V4.1 | Graphic design / print / vector output | ~$0.035 raster | Strong | Yes |
| Recraft V4.1 Vector | Final vector artwork | ~$0.08 | SVG-native | Yes |
| Gemini 3.1 Flash Lite Image | Cheap conversational edits / variants | ~$0.034 standard, lower in batch | Not primary strength | Very good |
| GPT-Image-2 | High-quality instruction following and edits | Variable | Yes | Very good |
| FLUX Kontext / fal | Image-to-image editing | ~$0.04 region | Usually ancillary | Excellent |

The recommendation is **not** to replace Ideogram with one new winner.

The recommendation is to make PRNTD provider-agnostic.

---

# Recommended Default Provider

## Ideogram 4 Turbo

The easiest immediate upgrade is:

```text
Ideogram v3 Turbo
        ↓
Ideogram 4 Turbo
```

Reasons:

- ~$0.03/image, matching PRNTD's current budget
- native transparent-background generation
- higher-resolution output options
- stronger reference/remix support
- async generation endpoints
- polling support
- signed webhook delivery

The native Ideogram 4 workflow may allow PRNTD to remove the current:

```text
Replicate
+
BiRefNet
```

path for normal image iterations.

This should be tested, especially around whether transparency remains reliable after remix/edit operations.

---

# Recraft Is the Most Important Alternative to Benchmark

Recraft is especially relevant because PRNTD is a **graphic-design / apparel-printing product**, not merely an image-generation product.

Recraft supports:

- raster generation
- image-to-image
- inpainting
- background removal
- vectorization
- native vector generation
- stronger explicit design controls

The most interesting capability is direct SVG/vector output.

For designs such as:

```text
1970s national-park badge
3 colors
bear silhouette
curved lettering
```

a vector artifact is potentially much better than a raster diffusion image.

Advantages:

- clean edges
- resolution independent
- easily recolored
- natural transparency
- better print production characteristics

Benchmark at least:

```text
Ideogram 4 Turbo
vs
Recraft V4.1 raster
vs
Recraft V4.1 Vector
```

on real PRNTD prompts.

---

# Gemini, OpenAI, and FLUX

## Gemini

Gemini image models are interesting primarily for conversational edits.

Example:

```text
[current design]

"Keep everything exactly the same except
make the road sign larger and remove
the wording under the figure."
```

This may be superior to having Claude reconstruct a full diffusion prompt for every edit.

Potential use:

```text
Ideogram → initial generation
Gemini   → conversational edits
```

## GPT-Image-2

Worth testing for:

- instruction-following
- localized edits
- preserving an existing composition while changing one detail
- transparent output

Potential use:

```text
selected image
+
specific edit instruction
→ high-fidelity revision
```

## FLUX Kontext / fal

Still useful for image-to-image editing.

fal also has a useful async job model:

```text
submit
→ request ID
→ poll or webhook
→ result
```

Do not hard-code FLUX or Replicate concepts into the domain model.

---

# Major Architecture Change: Make Generation Asynchronous

The current architecture allows an HTTP request to remain open for up to 120 seconds.

This should change.

Image generation should become a persistent background job.

## New request flow

```text
POST /design/generate
        ↓
check quota
        ↓
create image_generation row
        ↓
reserve generation number
        ↓
submit provider job
        ↓
store provider job ID
        ↓
return immediately
```

The user should be free to:

- continue chatting
- navigate away
- reload the page
- close the browser
- return later

without canceling generation.

## Completion flow

Prefer provider webhooks where supported:

```text
Provider
   ↓
signed webhook
   ↓
PRNTD webhook endpoint
   ↓
verify signature
   ↓
retrieve/download result
   ↓
validate artifact
   ↓
upload to R2
   ↓
create image row
   ↓
create conversation_image row
   ↓
mark image_generation succeeded
   ↓
update UI
```

Polling can be a fallback.

Ideogram 4 natively supports async generation, polling, and signed webhooks.

---

# New Domain Model

Introduce an explicit persistent generation entity.

Suggested schema:

```text
image_generation

id
design_id
conversation_id
generation_number

provider
model
operation

provider_job_id

source_image_id
prompt
design_spec_json

status

cost_estimate
actual_cost

reserved_at
submitted_at
completed_at

error_code
error_message
```

Suggested `operation` values:

```text
generate
edit
variation
vectorize
finalize
```

Suggested `status` values:

```text
queued
submitted
running
succeeded
failed
```

## Important semantic change

Do **not** create an `image` row before an actual image exists.

Instead:

```text
image_generation
     ↓
provider succeeds
     ↓
artifact saved to R2
     ↓
image row created
```

This eliminates much of the current orphan-image cleanup problem.

The existing `reserveGenerationNumbers()` concept is still useful and should probably remain.

---

# Provider Abstraction

Replace:

```text
ideogram-generator.ts = the generator
```

with something like:

```text
src/lib/generators/
    types.ts
    ideogram.ts
    recraft.ts
    gemini.ts
    openai.ts
    fal.ts
```

Example interface:

```ts
interface ImageGenerator {
  generate(spec: DesignSpec): Promise<GenerationHandle>;

  edit(
    source: ImageRef,
    spec: EditSpec
  ): Promise<GenerationHandle>;

  getStatus(
    handle: GenerationHandle
  ): Promise<GenerationStatus>;
}
```

Suggested handle:

```ts
type GenerationHandle = {
  provider: string;
  providerJobId: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed";
};
```

Provider-specific implementation details should not leak into the PRNTD domain layer.

---

# Replace Provider-Specific Prompt Construction with DesignSpec

`constructFluxPrompt()` should no longer be the central abstraction.

Claude should interpret the customer's intent into a normalized intermediate representation.

Example:

```ts
type DesignSpec = {
  subject: string;
  composition?: string;

  visualStyle?: string;

  typography?: {
    text?: string[];
    style?: string;
    placement?: string;
  };

  palette?: string[];

  shirtColor?: string;

  placement?: string;

  detailLevel?: string;

  background: "transparent";

  printStyle:
    | "screenprint"
    | "illustration"
    | "photographic"
    | "vector";
};
```

Then:

```text
Claude
  ↓
DesignSpec
  ├─ Ideogram adapter → Ideogram prompt / structured request
  ├─ Recraft adapter  → Recraft request
  ├─ Gemini adapter   → native image-edit instruction
  ├─ OpenAI adapter   → native image/edit instruction
  └─ fal adapter      → FLUX/Kontext request
```

Claude's responsibility should be:

```text
understand customer design intent
```

not:

```text
understand customer
+
understand vendor-specific prompt tricks
```

---

# Distinguish Generation Operations

Today almost every follow-up effectively becomes a reference-image generation.

Instead, classify user intent.

## New direction

Example:

```text
"Actually, let's do something completely different."
```

Operation:

```text
generate
```

## Revision

Example:

```text
"Make the lettering bigger."
```

Operation:

```text
edit
```

## Variant

Example:

```text
"Show me three versions with different bears."
```

Operation:

```text
variation
```

## Production final

Example:

```text
"I love it. Make the final."
```

Operation:

```text
finalize
```

Potential final steps:

```text
higher-resolution render
vectorization
upscale
print validation
```

The existing `isClarificationOnly` and generation-intent guards provide a good starting point for this richer intent classifier.

---

# Cost Strategy

Do not require every API call to cost <= $0.03.

Manage **average generation cost per design**.

Possible mix:

```text
70% normal generation
Ideogram 4 Turbo
~$0.030

15% cheap experimentation
Gemini / batch / inexpensive tier
~$0.017–0.034

10% difficult revisions
Recraft / Kontext
~$0.04

5% production finals
higher-quality generation/vectorization
$0.08–0.15+
```

Only spend premium-generation money after the user has selected a design they like.

Concept generation and production rendering should be separate phases.

---

# Suggested Product Flow

```text
conversation
    ↓
Claude interprets design
    ↓
DesignSpec
    ↓
intent classification
    ↓

generate ───────────────→ default provider
edit ───────────────────→ best edit provider
variation ──────────────→ provider / parallel jobs
finalize ───────────────→ production-quality provider

    ↓
image_generation rows
    ↓
async provider jobs
    ↓
webhooks
    ↓
R2
    ↓
image rows
    ↓
conversation_image
```

---

# Benchmark Before Dynamic Routing

Do not choose providers from public leaderboards.

Build a small evaluation harness using approximately 50 real historical PRNTD requests.

For each representative request, generate comparable outputs from:

```text
Ideogram 4 Turbo
Recraft V4.1
Recraft V4.1 Vector where applicable
Gemini image model
GPT-Image-2
FLUX Kontext for editing cases
```

Blind-rate outputs on:

```text
prompt fidelity
looks good on a shirt
typography
composition
transparent-edge quality
edit fidelity
printability
latency
cost
```

Separate evaluation sets for:

```text
initial generation
localized editing
style changes
text-heavy designs
logo/badge designs
illustration
few-color screenprint
vector-suitable artwork
```

Store evaluation results so provider routing can eventually be data-driven.

---

# Recommended Migration Order

## Phase 1 — Async generation

Refactor `generateDesign` so it creates a persistent `image_generation` job and returns immediately.

Use provider webhook completion.

This is the highest-confidence architecture improvement.

---

## Phase 2 — Upgrade Ideogram

Move:

```text
Ideogram v3 Turbo
→
Ideogram 4 Turbo
```

Keep Ideogram as the default provider initially.

Use:

- native transparency
- native async jobs
- webhook completion
- remix/reference capabilities

Test whether Replicate + BiRefNet can be removed.

---

## Phase 3 — Introduce DesignSpec

Move Claude output away from provider-specific prompt text.

Create:

```text
conversation
→ DesignSpec
→ provider adapter
```

Rename or retire `constructFluxPrompt`.

---

## Phase 4 — Provider abstraction

Implement the common provider interface.

Start with:

```text
Ideogram
Recraft
```

Then add:

```text
Gemini
OpenAI
fal / FLUX
```

only as needed.

---

## Phase 5 — Evaluation harness

Run real historical PRNTD cases through multiple providers.

Use results to decide:

- default provider
- best edit provider
- best text-heavy provider
- best vector provider
- best production-final provider

---

## Phase 6 — Intelligent routing

Only after benchmark data exists, consider routing automatically.

Example:

```text
simple graphic tee
→ Ideogram 4 Turbo

vector badge / logo
→ Recraft Vector

localized edit
→ Gemini / GPT-Image / Kontext

high-value selected final
→ higher-quality render / vectorization
```

Avoid premature routing complexity before the benchmark exists.

---

# Recommended Near-Term Target Architecture

The working hypothesis should be:

```text
Claude
   ↓
DesignSpec
   ↓
intent classifier
   ↓
provider abstraction
   ↓
persistent async image_generation
   ↓
provider webhook
   ↓
artifact validation
   ↓
R2
   ↓
image
   ↓
conversation_image
```

Default provider initially:

```text
Ideogram 4 Turbo
```

First serious alternative:

```text
Recraft V4.1
```

The biggest immediate improvements are:

1. eliminate long blocking image-generation requests
2. upgrade Ideogram v3 → Ideogram 4
3. make image generation provider-agnostic
4. replace provider-specific prompts with `DesignSpec`
5. distinguish generate/edit/variation/finalize operations
6. benchmark Recraft, Gemini, OpenAI, and FLUX against real PRNTD requests
7. investigate vector-native output for print production
8. optimize average cost per successful design rather than cost per individual call
