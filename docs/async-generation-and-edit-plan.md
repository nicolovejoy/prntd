# Async generation + edit-as-an-operation — plan

Status: revised 2026-08-29 after adversarial review (openapi re-verified
fresh; waitUntil durability researched against current Vercel docs; design
attacked against the codebase by a second reviewer). Slice order flipped to
edit-first. Open questions at the end gate the async slice only — the edit
slice is buildable now.

Companion doc: `docs/prntd-image-generation-2026-architecture.md` (ChatGPT's
2026 survey). This plan takes some of it, defers most of it, and corrects
four points — see "Deltas from the survey doc".

## Why

Two motivations, one structural and one product.

**Product.** Nico wants to work three or four shirt ideas at once. Today a
generation holds an open server action for its duration and the result is
written at the end of that request, so navigating away is at best undefined
and at worst loses the render. The desired experience: start a generation,
leave the thread, work on another idea or browse the Shop, come back and
it's there.

**Structural.** Every follow-up turn currently becomes a fresh
style-anchored generation rather than an edit. That single fact is upstream
of a large part of the backlog: near-duplicate generations sitting as peers
in the thread (#136), the flower render (#137 — a "make it again but…" turn
had to be re-expressed as a whole scene), and the historical alpha loss
(#153 — anchoring forces us off `generate-transparent` onto Replicate +
BiRefNet). The structural fix (edit) now ships first; the product fix
(async) rides on top of it.

## Verified findings

Pulled from `https://developer.ideogram.ai/openapi.json` on 2026-08-29 and
independently re-verified the same day. This is the same check run on
2026-07-20, which concluded v4 had no transparency support. That has changed.

New since July:

```
/v1/ideogram-v4/generate-transparent
/v1/ideogram-v4/async/generate-transparent
/v1/ideogram-v4/async/generate
/v1/generations/{generation_id}          poll
/v1/edit
```

Four things follow from the schemas:

1. **`/v1/edit` takes `transparent_background: true`**, up to 10 reference
   images (`images` or `image_urls`), no mask required. This is an
   instruction edit that keeps the alpha channel — the exact gap that forces
   the current BiRefNet detour.
2. **`/v1/ideogram-v4/remix` has no transparency flag.** Remix is not the
   iteration path; edit is.
3. **There is no async variant of `/v1/edit`.** Provider-side async covers
   first generation only (an unrelated `/v1/async/text-to-image/p-image-ideogram`
   also exists; nothing edit-shaped). Once edit lands, iteration is the
   majority of turns — so a provider-async architecture would leave the two
   most common operations on two different completion mechanisms.
4. **`webhook_url` exists only on the v2 tools** (`/v2/tool/colorways`,
   `/v2/tool/material-swap`). The v4 async generate endpoints are
   **poll-only** via `/v1/generations/{generation_id}`. The survey doc's
   "signed webhook delivery" for Ideogram 4 generation is contradicted by
   the spec — its provider-webhook Phase 1 isn't buildable even for the
   generate case.

(3) and (4) are why this plan owns the job rather than leaning on the
provider.

Pricing: Replicate lists ideogram-v4-turbo at $0.03, balanced $0.06, quality
$0.10 — turbo is cost-neutral with current v3 turbo. Secondhand source;
`costPerImage` is hardcoded $0.03 in `ideogram-generator.ts` — **confirm
native-API pricing for both `/v1/ideogram-v4/generate-transparent` and
`/v1/edit` during the edit slice, before shipping it**, and set cost per
operation.

Incidental, noted not planned: `/v1/ideogram-v3/layerize-text` and
`/v1/layerize-logos` (relevant to the parked text-as-layer phase),
`/v2/tool/colorways` (recolor artwork per shirt color).

## Approach

One durable job row plus a background continuation. No webhook endpoint, no
provider-async coupling.

```
POST generate
  check quota
  server-side concurrency check (count running jobs for user)
  classify turn; clarification exits return BEFORE any job row is created
  reserve generation number
  insert image_generation row (status = running; carries day key, ip,
    minted image id + R2 key, resolved anchor image id)
  return job id immediately
  after():  provider call -> R2 upload -> db.batch -> conditional
    status transition running -> succeeded
```

### Durability, stated honestly

Use **`after()` from `next/server`**, not `waitUntil` — Vercel's explicit
recommendation for Next ≥15.1; on Vercel it is implemented via the same
`waitUntil` primitive and works in server actions. Already proven in this
codebase (`preview/actions.ts` uses it).

The real semantics, per current Vercel docs:

- The budget is **one shared clock**: `maxDuration` covers request +
  response + `after()` work. Hobby is 300s, no extension. A 10–120s job
  fits with margin; a future QUALITY tier eats into it. Export
  `maxDuration` explicitly from the /design page (server actions inherit
  the rendering route's segment config, not an API route's).
- What kills a continuation, ranked: **(1) a new deployment** — old
  deployments drain for an undocumented window; **(2) an unhandled
  rejection anywhere on the shared Fluid instance** stops the process;
  (3) `maxDuration`. Scale-down handling of background-only work is
  undocumented. Since prntd auto-deploys on push to main and generation
  traffic is "Nico at the keyboard", **kill events correlate positively
  with usage**: expect single-digit-percent losses during active dev
  sessions, ~zero otherwise. Acceptable because no money is at stake and
  quota is refundable — but the continuation must never be the only thing
  that can mark a job failed.
- Locally there is no `waitUntil`, so `after()` blocks under `next start`:
  the e2e harness (compiled build) will see synchronous completion. Fine,
  but expected — don't chase it as a bug.
- Do **not** enable `supportsCancellation` in vercel.json while this
  design is live (client disconnect would become a kill source).
- Errors thrown inside `after()` reach `instrumentation.ts`'s
  `onRequestError` and land in `/admin/errors` — part of the durability
  story, not an accident.

### Hardening contract (the review findings, as rules)

1. **Status transitions are conditional.** Every writer uses
   `UPDATE image_generation SET status=? WHERE id=? AND status='running'`
   and checks the affected-row count. Same shape as #37's paid-claim.
2. **Quota refund fires only when that transition reports one row** —
   never unconditionally. `refundGenerationQuota` today is a bare
   decrement with two additional defects for a detached writer: it
   computes the day key at refund time (a sweep after midnight UTC refunds
   the wrong day's row) and it needs an `ip` that only request headers
   provide. The job row therefore carries **day key and ip** at insert,
   and refund reads them from the row.
3. **The job row carries the minted image id / R2 key and the resolved
   anchor image id.** The anchor must be persisted as an image id, not the
   positional index `constructFluxPrompt` returns — positions are only
   stable inside one synchronous span. The R2 key lets recovery reclaim an
   orphaned object (PR #52's in-request cleanup survives the move, but
   process death between upload and batch now strands `images/{id}.png`
   with nothing else to reclaim it).
4. **Recovery is lazy, not daily.** A stale `running` row (started_at older
   than ~5 min) is marked failed + refunded **on read** — any thread,
   /designs, or header load sweeps its own overdue rows, so recovery
   latency is seconds. The continuation also self-fails against
   `getDeadline()`. The daily cron remains as backstop only, and is the
   place that deletes orphaned R2 objects. (The 24h retry-fulfillment
   ceiling pattern does NOT transfer — applied here it would strand jobs
   in `running` forever.)
5. **Concurrency is capped server-side.** #98's one-at-a-time is a single
   client ref (`design-client.tsx`); two tabs already defeat it. The cap
   becomes a count of `status='running'` rows per user, checked at job
   insert. Cap value: open question 3 (recommend 3).
6. **Clarification exits create no job row.** They fire after quota is
   consumed but before any provider call; under the new flow they must
   return before the insert, or the sweeper reads rows that were never
   going to render.

### Concurrent-completion writes

With more than one job in flight, the completing batch can no longer write
thread state unconditionally:

- `primaryImageId` today is written by every completing generation;
  last-writer-wins by provider latency is wrong once jobs race, and the
  client turn-tracker isn't there to guard a detached completion. Rule:
  a completing job sets `primaryImageId` only if it is still the newest
  submitted job for the thread (or leave primary untouched on background
  completions — decide in the slice).
- `parentImageId` is snapshot-time, so concurrent jobs become siblings off
  the same parent. That is the intended semantics; state it, don't
  inherit it by accident.
- Generation numbers move from completion-order to submit-order, and
  `generation_count` changes meaning to "attempts" — swept jobs leave
  gaps. #147's "#N labels are creation-ordered" contract survives
  (submit order IS creation order), but the strip must tolerate gaps.
- `generationCost` keeps incrementing on success only; a failed job's
  real provider cost is recorded on the job row (`actual_cost`), not on
  the design.

### How the UI learns a job finished

There is currently **no** refresh mechanism anywhere in `src/app` — no
polling, no `router.refresh()`. "Passive" still requires:

- a `getRunningJobs(designId)`-shaped action the thread polls while it
  knows a job is in flight (interval only-while-running, backoff);
- a refetch on `visibilitychange`/focus — phone-first means app-switch is
  the main journey;
- `getHeaderState` extended with a running count for the header badge;
- the thread revisit cache (10-min TTL, hydrates before the server
  payload) will flash the stale snapshot on exactly the leave-and-return
  journey — the cache write-back needs to be job-aware or the flash
  accepted explicitly.

Tradeoff accepted, restated honestly: if the function is killed
mid-generation the render is lost; lazy sweep catches it in seconds-to-
minutes, quota refunded, R2 object reclaimed by the cron. Kills cluster
around deploys. `/v1/ideogram-v4/async/*` + polling remains adoptable
later for the generate case specifically if this bites.

Side effect worth planning for: async makes latency cheap, which makes
quality purchasable. TURBO is currently forced by someone watching a
spinner. Not in scope — see open question 4.

## Slices

Order: **edit → spec → async → eval**. The previous draft put async first
on the claim that async and edit "both rewrite `generateDesign`" — that
was wrong: they touch disjoint parts (async rewrites the frame — quota,
try/catch, return shape, where the batch runs; edit rewrites the middle —
classification, the one provider call, the adapter). The only shared line
is `generator.generate(...)`. Edit-first wins because:

- it is the slice with direct product payoff, retiring three live defect
  classes (#136 near-dup peers, #137's re-express-the-scene failure mode,
  #153's alpha mechanism), while async *adds* a failure class;
- it proves `/v1/edit` on real prompts before the durability investment;
- `/v1/edit` on turbo should beat today's two sequential Replicate runs,
  so it likely lowers median latency — useful before committing to async;
- edit and DesignSpec are coupled (the operation classifier is most of the
  spec's intent layer), so they ship adjacent.

If "three ideas at once, right now" becomes the priority, the async slice
can be pulled forward — but that is a product call trading affordance now
for defect classes later, not a technical dependency.

**Slice 1 — edit as an operation.** Route anchored turns (the existing
`referenceImage` signal — null means generate, set means edit; a richer
generate/edit/variation classifier waits for slice 2) to `/v1/edit` with
the parent image and `transparent_background: true`. **The generate branch
stays on v3 `generate-transparent` for now** — two schema facts rule the
v4 swap out of this slice: v4's `text_prompt` force-enables magic prompt
(we run with it OFF today) and v4 has no `negative_prompt`, so a plain-text
v4 swap is an uncontrolled prompt-behavior change with no eval harness to
measure it; v4's `json_prompt` (which disables magic prompt) is exactly
DesignSpec's target, so the v4 upgrade rides slice 2. Two `/v1/edit`
implementation facts: `image_urls` accepts Ideogram-hosted URLs only, so
the R2 anchor must be downloaded and attached as multipart `images` bytes;
and third-party pricing puts instructional edit at **~$0.20/image** vs
$0.03 generate — accepted at prntd volume, tracked per-operation in the
cost accounting, verify against the first real bill. `/v1/edit` has no
`negative_prompt` either; the edit path ignores it and the system prompt
folds edit intent into the positive instruction. Delete
`generateAnchoredTransparent` and BiRefNet from the generation path. **Scope includes the second caller
the previous draft missed:** `getOrCreatePlacementRender`
(`preview/actions.ts`) uses the same anchored+BiRefNet mechanism for
aspect-ratio placement re-renders — same #153 alpha exposure. Placement
renders move onto `/v1/edit` too ("same artwork, different canvas" is an
edit); only then does `replicate.ts` actually leave the image path. Ops
scripts (`check-bg-removal.ts`, `backfill-legacy-alpha.ts`) keep importing
`removeBackground` — leave the helper, or retire the scripts explicitly.
Confirm native v4 + `/v1/edit` pricing and set per-operation cost before
shipping. `hasTransparency` in `product-compose.ts` is already a real
probe (PR #155) under a warn-not-block policy; what this slice changes is
that the probed value becomes reliably true.

Slice 1 status (2026-08-29): built. `editTransparent` in ideogram.ts
(anchor uploaded as multipart bytes; transparent_background true;
magic_prompt OFF); adapter routes anchored turns to it; placement
re-renders in preview/actions.ts use it directly and are priced as edits;
`generateAnchoredTransparent`/`generateImage` deleted, `removeBackground`
kept for ops scripts. Cost is per-operation via `costFor` (0.03 / 0.20 —
secondhand price, verify against the first bill). Refinement prompts are
edit instructions now. Not done here: v4 generate swap (slice 2),
variation classification (slice 2), any UI change.

**Slice 2 — DesignSpec, and the v4 upgrade.** Claude emits a typed spec (subject, style,
typography, palette, shirtColor, printStyle, background) instead of a
prompt string; adapters render it per provider. Ideogram's `json_prompt`
takes it almost directly (structured `high_level_description` /
`style_description` / `compositional_deconstruction`, magic-prompt
disabled). The argument is bug classes, not portability: a spec with a
required `subject` cannot be subjectless, which is #137 made
unrepresentable rather than guarded against.

Slice 2 status (2026-08-29): built. `design-spec.ts` (typed spec, subject +
elements required — #137 unrepresentable), `constructDesignBrief` emits
clarify/generate/edit; generates go to v4 generate-transparent via
json_prompt (magic prompt disabled by contract, TURBO, $0.03), edits
unchanged from slice 1. Deleted: constructFluxPrompt, the v3 generate
client, isClarificationOnly/isSubjectlessPrompt (operation is explicit
now). negativePrompt retired with v3 — affirmative style fields replace
it. "variation" folds into generate (v4 generate-transparent takes no
seed; no mechanical difference). image.prompt stores renderSpecSummary()
for generates, the edit instruction for edits; the structured spec is not
persisted (slice 3's job table gets design_spec_json). Not done: bbox
layout control, quality tiers, any UI change.

**Slice 3 — durable generation job.** New `image_generation` table +
migration (next is 0011; standing rules — manual `prntd-preview` migrate
before the Vercel preview works, prod migrate manual after
`turso db create prntd-backup-<date> --from-db prntd`). `generateDesign`
returns a job id; `after()` continuation does provider call / upload /
write under the hardening contract above. Lazy stale-sweep on read; cron
backstop reclaims R2 orphans. Server-side concurrency cap. UI polling +
focus refetch + header badge. Expect to **rewrite**
`generation-races.integration.test.ts` (it pins the invariants this slice
changes), and to retire most of `turn-tracker.ts` — its whole job is
deciding whether a settling server action may touch composer state, and
there is no settling action any more; cancel becomes a job-status concept
(decide: does a cancelled job's image still get written? today yes).

**Slice 4 — eval harness, scoped as regression safety.** We currently
cannot tell whether a prompt change made output better or worse; #137's
fix is pinned to one verbatim repro string, which is a unit test, not
evidence the system improved. Replay ~15 historical threads (52 real
conversations with full `chat_message` history are available) through old
and new pipelines, render side by side locally, rate better/worse/same.
Provider comparison falls out later as a second use of the same tool.

## Deltas from the survey doc

Taken: intent classification (generate/edit/variation/finalize),
DesignSpec, the v4 upgrade, the eval harness idea.

**Async is right, but its Phase 1 shape is not buildable.** The doc
proposes provider webhooks with signature verification and a polling
fallback. Finding (3): no async edit. Finding (4): no webhooks on v4
generate either — the spec offers polling only. Self-managed job +
`after()` covers both operations uniformly and is a fraction of the
surface.

**Not doing the five-provider abstraction.** Multi-generator existed and
was deliberately removed in #56 for adding UX complexity with no benefit.
Rebuilding it before evidence a second provider is better repeats that.
The existing `ImageGenerator` interface is enough for now.

**Two table corrections.** GPT-Image-2 transparency is preview-only,
absent from the Responses API tool and absent on Replicate — "Yes"
overstates it. Gemini is listed as transparency "not primary strength"; it
is nonexistent — flat RGB, no alpha, across the whole Nano Banana family.
For artwork printed on colored shirts that rules Gemini out as an edit
provider absent a two-render difference hack.

**Half solved, half new.** The doc proposes deferring `image` row creation
to fix orphan cleanup; the row is already created atomically in the batch
and #40 / PR #52 cleans the R2 object on batch failure. What async makes
NEW is the orphaned R2 object when the process dies between upload and
batch — handled by hardening rule 3 + the cron backstop, not by the
survey's row-deferral.

Deferred indefinitely: dynamic provider routing, Recraft/vector output,
provider webhooks.

## Touch points

- `src/app/design/actions.ts` — `generateDesign`, quota, clarification
  exits, `reserveGenerationNumbers`
- `src/app/preview/actions.ts` — `getOrCreatePlacementRender` (slice 1)
- `src/lib/generators/ideogram-generator.ts` — the two-branch split collapses
- `src/lib/ideogram.ts`, `src/lib/replicate.ts` — Replicate leaves the image path (slice 1, both callers)
- `src/lib/ai.ts` — `constructFluxPrompt` retires into DesignSpec (slice 2)
- `src/lib/design-prompt.ts` — intent guards become the intent classifier
- `src/lib/generation-quota.ts` — refund becomes row-scoped + conditional (slice 3)
- `src/lib/turn-tracker.ts` — mostly retires (slice 3)
- `src/app/design/design-client.tsx` — concurrency ref, revisit cache, polling (slice 3)
- `src/lib/product-compose.ts` — `hasTransparency` probe value becomes reliable
- `src/app/design/__tests__/generation-races.integration.test.ts` — rewrite in slice 3

## Open questions (gate the async slice only)

1. **Is "three or four ideas" three or four separate conversations, or
   variants inside one thread?** Separate threads puts the in-flight
   indicator on /designs and the global header. Variants-in-one-thread
   makes it a strip inside the thread view and a much smaller change.
   Assumption: separate threads.

2. **How does the user learn it's done?** Passive (badge/spinner noticed
   on return + focus refetch), a toast if still in the app, or push/email.
   Phone-first argues for something surviving app-switching, but that's a
   scope jump. Recommendation: start passive (which still costs the
   polling + focus-refetch machinery above — it is not free).

3. **What is the concurrency cap?** Server-side count of running jobs per
   user. Recommendation: 3 in flight, within the daily quota.

4. **Expose a quality tier, or defer?** Recommendation: ship async on
   TURBO, treat "spend two minutes for a better render" as a separate
   decision once the new pacing has been felt. Note the 300s shared clock
   before ever enabling QUALITY inside a continuation.
