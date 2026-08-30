# Edit-as-an-Operation (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route anchored (iteration) turns and placement re-renders through Ideogram's `/v1/edit` instruction-edit endpoint with native transparent output, deleting the Replicate + BiRefNet detour that loses alpha and re-expresses every refinement as a whole new scene.

**Architecture:** A new `editTransparent()` client in `src/lib/ideogram.ts` (downloads the R2 anchor, posts multipart to `/v1/edit` with `transparent_background: true`); the `ideogramGenerator` adapter routes anchored generations to it; `getOrCreatePlacementRender` (aspect-ratio re-renders) calls it directly; `generateAnchoredTransparent`/`generateImage` are deleted from `replicate.ts`. Cost becomes per-operation via `costFor(opts)` on the generator interface ($0.03 generate, $0.20 edit). The first-generation path (v3 `generate-transparent`) is deliberately unchanged.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Vitest, native `fetch`/`FormData`, Ideogram API v1.

**Spec:** `docs/async-generation-and-edit-plan.md` — section "Slice 1 — edit as an operation" is the binding text; its "Verified findings" section carries the API facts (re-verified against `developer.ideogram.ai/openapi.json` 2026-08-29).

## Global Constraints

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` must all pass before the branch is done. Run `npm run typecheck` explicitly — CI has caught agent PRs that skipped it.
- `@typescript-eslint/no-explicit-any` is `error` in product code, `off` in test files. Use `catch (err)` and narrow with `err instanceof Error ? err.message : String(err)`.
- `/v1/edit` facts (from the openapi, do not re-derive): `prompt` is the only required field; anchor goes in multipart `images` as bytes (`image_urls` accepts Ideogram-hosted URLs only — our anchors are R2 URLs, so bytes it is); `aspect_ratio` uses NxM strings (`"4x5"`, same mapping as v3); `magic_prompt` enum `AUTO|ON|OFF`; `transparent_background` boolean, default false; there is NO `negative_prompt` and NO `rendering_speed`. Response shape: `{ created, data: [{ url, ... }] }` — same `data[0].url` pattern as v3.
- Edit cost is `0.2` (dollars/image, secondhand pricing — the code tracks it; do not "correct" it to 0.03).
- The generate branch (no anchor → v3 `generate-transparent`) must NOT change behavior: same endpoint, same `magic_prompt: OFF`, same `negative_prompt` support.
- Do not touch `scripts/**` (excluded from lint/tsconfig). `removeBackground` in `replicate.ts` MUST survive — `scripts/check-bg-removal.ts` and `scripts/backfill-legacy-alpha.ts` import it.
- No new dependencies.

---

### Task 1: `editTransparent` client

**Files:**
- Modify: `src/lib/ideogram.ts`
- Test: `src/lib/__tests__/ideogram-edit.test.ts` (create)

**Interfaces:**
- Consumes: `withTimeout(label, ms, fn)` from `src/lib/timeout.ts` (already used by `replicate.ts`); module-private `toIdeogramAspect()` already in `ideogram.ts`.
- Produces: `editTransparent(prompt: string, anchorImageUrl: string, aspectRatio?: AspectRatio): Promise<string>` and `export const EDIT_COST_PER_IMAGE = 0.2;` — Tasks 2 and 3 import both.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/ideogram-edit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { editTransparent, EDIT_COST_PER_IMAGE } from "../ideogram";

const ANCHOR_URL = "https://pub-test.r2.dev/images/abc.png";
const ANCHOR_BYTES = new Uint8Array([137, 80, 78, 71]); // PNG magic

function mockFetchSequence(apiResponse: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  anchorOk?: boolean;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url) === ANCHOR_URL) {
      return new Response(apiResponse.anchorOk === false ? null : ANCHOR_BYTES, {
        status: apiResponse.anchorOk === false ? 404 : 200,
      });
    }
    return new Response(JSON.stringify(apiResponse.body ?? {}), {
      status: apiResponse.ok === false ? (apiResponse.status ?? 500) : 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("editTransparent", () => {
  beforeEach(() => {
    vi.stubEnv("IDEOGRAM_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts multipart to /v1/edit with anchor bytes, transparency on, magic prompt off", async () => {
    const { calls } = mockFetchSequence({
      body: { created: "now", data: [{ url: "https://ideogram.ai/out.png" }] },
    });

    const url = await editTransparent("make the bear larger", ANCHOR_URL, "4:5");

    expect(url).toBe("https://ideogram.ai/out.png");
    expect(calls[0].url).toBe(ANCHOR_URL);
    expect(calls[1].url).toBe("https://api.ideogram.ai/v1/edit");
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers["Api-Key"]).toBe("test-key");
    const fd = calls[1].init?.body as FormData;
    expect(fd.get("prompt")).toBe("make the bear larger");
    expect(fd.get("aspect_ratio")).toBe("4x5");
    expect(fd.get("magic_prompt")).toBe("OFF");
    expect(fd.get("transparent_background")).toBe("true");
    const image = fd.get("images");
    expect(image).toBeInstanceOf(Blob);
    expect((image as Blob).type).toBe("image/png");
  });

  it("defaults aspect ratio to 1x1", async () => {
    const { calls } = mockFetchSequence({
      body: { created: "now", data: [{ url: "https://ideogram.ai/out.png" }] },
    });
    await editTransparent("edit", ANCHOR_URL);
    const fd = calls[1].init?.body as FormData;
    expect(fd.get("aspect_ratio")).toBe("1x1");
  });

  it("throws when the anchor download fails", async () => {
    mockFetchSequence({ anchorOk: false });
    await expect(editTransparent("edit", ANCHOR_URL)).rejects.toThrow(/anchor/i);
  });

  it("throws with status on a non-OK API response", async () => {
    mockFetchSequence({ ok: false, status: 422, body: { error: "bad" } });
    await expect(editTransparent("edit", ANCHOR_URL)).rejects.toThrow(/422/);
  });

  it("throws when the response has no image URL", async () => {
    mockFetchSequence({ body: { created: "now", data: [] } });
    await expect(editTransparent("edit", ANCHOR_URL)).rejects.toThrow(/URL/i);
  });

  it("throws when IDEOGRAM_API_KEY is missing", async () => {
    vi.stubEnv("IDEOGRAM_API_KEY", "");
    mockFetchSequence({ body: {} });
    await expect(editTransparent("edit", ANCHOR_URL)).rejects.toThrow(/IDEOGRAM_API_KEY/);
  });

  it("exports the per-edit cost for accounting", () => {
    expect(EDIT_COST_PER_IMAGE).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/ideogram-edit.test.ts`
Expected: FAIL — `editTransparent` is not exported.

- [ ] **Step 3: Implement in `src/lib/ideogram.ts`**

Append to the file (reuse the existing `toIdeogramAspect`; add the `withTimeout` import at the top):

```typescript
import { withTimeout } from "./timeout";

const EDIT_ENDPOINT = "https://api.ideogram.ai/v1/edit";
const EDIT_TIMEOUT_MS = 120_000;

/** Rough internal $/image for instructional edits (secondhand pricing —
 *  verify against the first real bill; see the plan doc). */
export const EDIT_COST_PER_IMAGE = 0.2;

/**
 * Instruction-edit an existing image via Ideogram /v1/edit, preserving
 * transparency (`transparent_background: true` — RGBA out, no BiRefNet).
 * The anchor is downloaded and sent as multipart bytes: `image_urls` only
 * accepts Ideogram-hosted URLs, and ours live on R2.
 * Returns the URL of the edited image. Caller downloads the bytes
 * immediately — Ideogram URLs expire.
 */
export async function editTransparent(
  prompt: string,
  anchorImageUrl: string,
  aspectRatio: AspectRatio = "1:1"
): Promise<string> {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) throw new Error("IDEOGRAM_API_KEY missing");

  const anchorRes = await fetch(anchorImageUrl);
  if (!anchorRes.ok) {
    throw new Error(`Failed to download anchor image: ${anchorRes.status}`);
  }
  const anchorBytes = await anchorRes.arrayBuffer();

  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("aspect_ratio", toIdeogramAspect(aspectRatio));
  fd.append("magic_prompt", "OFF");
  fd.append("transparent_background", "true");
  fd.append("images", new Blob([anchorBytes], { type: "image/png" }), "anchor.png");

  const res = await withTimeout("editTransparent", EDIT_TIMEOUT_MS, () =>
    fetch(EDIT_ENDPOINT, {
      method: "POST",
      headers: { "Api-Key": apiKey },
      body: fd,
    })
  );

  if (!res.ok) {
    throw new Error(`Ideogram edit ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error(`No URL in Ideogram edit response: ${JSON.stringify(data)}`);
  return url;
}
```

Check `src/lib/timeout.ts` for the exact `withTimeout` signature before writing the call — `replicate.ts` uses `withTimeout("generateImage", REPLICATE_RUN_TIMEOUT_MS, () => …)`; match it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/ideogram-edit.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ideogram.ts src/lib/__tests__/ideogram-edit.test.ts
git commit -m "feat: editTransparent client for Ideogram /v1/edit (alpha-preserving instruction edit)"
```

---

### Task 2: Route anchored generations through edit; per-operation cost

**Files:**
- Modify: `src/lib/generators/types.ts`
- Modify: `src/lib/generators/ideogram-generator.ts`
- Modify: `src/app/design/actions.ts` (the `generator.generate` call region, ~lines 244-250, and the two `generator.costPerImage` reads at ~295 and ~321)
- Modify (test mocks only): `src/app/design/__tests__/generation-races.integration.test.ts`, `src/app/design/__tests__/fresh-start-seed.integration.test.ts`, `src/app/design/__tests__/conversation-close.integration.test.ts`, `src/app/designs/__tests__/delete-design.integration.test.ts`
- Test: `src/lib/generators/__tests__/ideogram-generator.test.ts` (create)

**Interfaces:**
- Consumes: `editTransparent`, `EDIT_COST_PER_IMAGE` from `../ideogram` (Task 1).
- Produces: `ImageGenerator.costFor(opts: GenerateOptions): number` replaces `costPerImage: number` — Task 3 does not use it, but every mock of a generator must now provide `costFor`.

- [ ] **Step 1: Write the failing adapter test**

Create `src/lib/generators/__tests__/ideogram-generator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const ideogram = {
  generateTransparent: vi.fn(async () => "https://out/generate.png"),
  editTransparent: vi.fn(async () => "https://out/edit.png"),
  EDIT_COST_PER_IMAGE: 0.2,
};
vi.mock("../../ideogram", () => ideogram);

import { ideogramGenerator } from "../ideogram-generator";

describe("ideogramGenerator routing", () => {
  beforeEach(() => {
    ideogram.generateTransparent.mockClear();
    ideogram.editTransparent.mockClear();
  });

  it("routes un-anchored generations to generateTransparent with negative prompt", async () => {
    const url = await ideogramGenerator.generate("a bear", {
      aspect: "1:1",
      negativePrompt: "smooth gradients",
    });
    expect(url).toBe("https://out/generate.png");
    expect(ideogram.generateTransparent).toHaveBeenCalledWith("a bear", "1:1", {
      negativePrompt: "smooth gradients",
    });
    expect(ideogram.editTransparent).not.toHaveBeenCalled();
  });

  it("routes anchored generations to editTransparent (negative prompt has no edit param)", async () => {
    const url = await ideogramGenerator.generate("make the bear larger", {
      aspect: "4:5",
      referenceImageUrl: "https://r2/anchor.png",
      negativePrompt: "ignored on edits",
    });
    expect(url).toBe("https://out/edit.png");
    expect(ideogram.editTransparent).toHaveBeenCalledWith(
      "make the bear larger",
      "https://r2/anchor.png",
      "4:5"
    );
    expect(ideogram.generateTransparent).not.toHaveBeenCalled();
  });

  it("prices generate at 0.03 and edit at 0.2", () => {
    expect(ideogramGenerator.costFor({ aspect: "1:1" })).toBe(0.03);
    expect(
      ideogramGenerator.costFor({ aspect: "1:1", referenceImageUrl: "https://r2/a.png" })
    ).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/generators/__tests__/ideogram-generator.test.ts`
Expected: FAIL — module still imports `generateAnchoredTransparent` from `../replicate`, and `costFor` doesn't exist.

- [ ] **Step 3: Update the interface**

In `src/lib/generators/types.ts`, replace the `costPerImage` member:

```typescript
  /** Rough internal $/image for accounting (not customer-facing).
   *  Per-operation: an anchored call is an instructional edit and costs
   *  more than a fresh generation. */
  costFor(opts: GenerateOptions): number;
```

(Delete `costPerImage: number;`.)

- [ ] **Step 4: Rewrite the adapter**

`src/lib/generators/ideogram-generator.ts` becomes:

```typescript
import type { ImageGenerator } from "./types";
import {
  generateTransparent,
  editTransparent,
  EDIT_COST_PER_IMAGE,
} from "../ideogram";

const GENERATE_COST_PER_IMAGE = 0.03;

/**
 * Ideogram adapter. Without a reference image, uses Ideogram's native
 * transparent generate endpoint. With one, this is an iteration: it routes
 * to /v1/edit (instruction edit, native RGBA out) — replacing the old
 * Replicate style-reference + BiRefNet detour that emitted RGB (#153) and
 * re-expressed every refinement as a whole new scene. /v1/edit has no
 * negative-prompt parameter, so negativePrompt applies to generates only.
 */
export const ideogramGenerator: ImageGenerator = {
  id: "ideogram",
  label: "Ideogram",
  costFor: (opts) =>
    opts.referenceImageUrl ? EDIT_COST_PER_IMAGE : GENERATE_COST_PER_IMAGE,
  adaptPrompt: (base) => base,
  generate: (prompt, { aspect, referenceImageUrl, negativePrompt }) =>
    referenceImageUrl
      ? editTransparent(prompt, referenceImageUrl, aspect)
      : generateTransparent(prompt, aspect, {
          negativePrompt: negativePrompt ?? undefined,
        }),
};
```

- [ ] **Step 5: Update `generateDesign`'s cost reads**

In `src/app/design/actions.ts`, the generate call currently builds options inline. Extract them so the same options price the operation:

```typescript
  const generateOpts = {
    aspect: "1:1" as const,
    referenceImageUrl: anchorUrl,
    negativePrompt: aiResponse.negativePrompt,
  };
  const generationCost = generator.costFor(generateOpts);

  let imageUrl: string;
  try {
    imageUrl = await generator.generate(generator.adaptPrompt(aiResponse.fluxPrompt), generateOpts);
```

Then replace both `generator.costPerImage` reads in the `db.batch` block with `generationCost`:
- `generationCost: generator.costPerImage,` → `generationCost,`
- `` generationCost: sql`${designTable.generationCost} + ${generator.costPerImage}`, `` → `` generationCost: sql`${designTable.generationCost} + ${generationCost}`, ``

- [ ] **Step 6: Update the four test mocks**

In each of `generation-races.integration.test.ts`, `fresh-start-seed.integration.test.ts`, `conversation-close.integration.test.ts` (all under `src/app/design/__tests__/`) and `delete-design.integration.test.ts` (under `src/app/designs/__tests__/`), the mocked generator object has `costPerImage: 0.03` — replace that line with:

```typescript
    costFor: () => 0.03,
```

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run src/lib/generators/__tests__/ideogram-generator.test.ts src/app/design/__tests__ src/app/designs/__tests__/delete-design.integration.test.ts`
Expected: PASS. Then `npm run typecheck` — expected clean (this is what catches any `costPerImage` reader the greps missed).

- [ ] **Step 8: Commit**

```bash
git add src/lib/generators/ src/app/design/actions.ts src/app/design/__tests__ src/app/designs/__tests__/delete-design.integration.test.ts
git commit -m "feat: anchored generations route to /v1/edit; per-operation cost via costFor"
```

---

### Task 3: Placement re-renders become edits; delete the Replicate app path

**Files:**
- Modify: `src/app/preview/actions.ts` (import at line 25; call at ~228; `COST_PER_GENERATION` const at 40 and reads at ~258/~275)
- Modify: `src/lib/replicate.ts` (delete `generateAnchoredTransparent` and `generateImage`; keep `removeBackground` + the retry/timeout helpers it uses)
- Modify (test mocks): `src/app/preview/__tests__/placement-render-anchor.integration.test.ts`

**Interfaces:**
- Consumes: `editTransparent`, `EDIT_COST_PER_IMAGE` from `@/lib/ideogram` (Task 1).
- Produces: nothing new. `removeBackground` remains exported from `replicate.ts` (ops scripts import it).

- [ ] **Step 1: Update the integration test's mocks first (this is the failing test)**

In `src/app/preview/__tests__/placement-render-anchor.integration.test.ts`, the `@/lib/replicate` mock provides `generateAnchoredTransparent`. Replace that mock with an `@/lib/ideogram` mock exposing `editTransparent` (same fake behavior — resolve a fixed URL) and `EDIT_COST_PER_IMAGE: 0.2`, and update every assertion that references `replicate.generateAnchoredTransparent` (`mockClear`, `not.toHaveBeenCalled`, call-arg assertions) to the new `editTransparent` mock. The test's semantics — cache hits never call the model, cache misses call it anchored on the primary — are unchanged; only the mocked module moves. Keep any other `@/lib/replicate` mock ONLY if the file still imports something from it after Step 2 (it should not).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/preview/__tests__/placement-render-anchor.integration.test.ts`
Expected: FAIL — `preview/actions.ts` still calls `generateAnchoredTransparent`, which is now unmocked/absent.

- [ ] **Step 3: Swap the call in `preview/actions.ts`**

- Replace the import `import { generateAnchoredTransparent } from "@/lib/replicate";` with `import { editTransparent, EDIT_COST_PER_IMAGE } from "@/lib/ideogram";`
- Delete `const COST_PER_GENERATION = 0.03;` and replace its two reads with `EDIT_COST_PER_IMAGE` (a placement re-render IS an edit now, and is priced like one).
- Replace the generation call:

```typescript
    imageUrl = await editTransparent(prompt, primary.imageUrl, targetAspect);
```

(The surrounding try/catch, logging, and everything after stays as is.)

- [ ] **Step 4: Delete the dead Replicate path**

In `src/lib/replicate.ts`, delete `generateAnchoredTransparent` and `generateImage` entirely. Keep `removeBackground`, `withReplicate429Retry`, the timeout const, and the module header — rewrite the header comment to say the module now exists only for BiRefNet background removal used by ops scripts (`scripts/check-bg-removal.ts`, `scripts/backfill-legacy-alpha.ts`); the generation path no longer touches Replicate.

Then verify nothing else imports the deleted functions:

```bash
grep -rn "generateAnchoredTransparent\|from \"@/lib/replicate\"\|generateImage" src --include="*.ts" --include="*.tsx"
```

Expected: only `removeBackground`-related hits in `replicate.ts` itself (scripts/ hits are fine — they import `removeBackground`, which survives).

- [ ] **Step 5: Run the suites**

Run: `npx vitest run src/app/preview/__tests__ && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/preview/actions.ts src/lib/replicate.ts src/app/preview/__tests__/placement-render-anchor.integration.test.ts
git commit -m "feat: placement re-renders via /v1/edit; delete Replicate generation path"
```

---

### Task 4: Prompt construction — refinements become edit instructions

**Files:**
- Modify: `src/lib/ai.ts` (the `Refinements:` section at the bottom of `GENERATE_SYSTEM_PROMPT`, ~lines 116-118)

**Interfaces:**
- Consumes/Produces: nothing typed — `constructFluxPrompt`'s envelope (`message`, `fluxPrompt`, `negativePrompt`, `referenceImage`) is unchanged. Only the instructions for what `fluxPrompt` should CONTAIN when `referenceImage` is set change.

- [ ] **Step 1: Rewrite the Refinements section**

Replace the current two-bullet `Refinements:` block with:

```
Refinements — edits, not regenerations:
- When the user is refining a previous design, set "referenceImage" to its # — that image is sent to an instruction-edit model together with your fluxPrompt.
- In that case fluxPrompt must be the EDIT INSTRUCTION, not a full scene description: state what should change and what must stay ("make the bear larger; keep the lettering, colors, and composition unchanged"). Do not re-describe the whole design.
- Unlike fresh generations, the edit model handles removal instructions directly: "remove the lettering under the figure" is correct here — do not translate removals into scene re-descriptions.
- The positive-only rule above applies to fresh generations (referenceImage null) only.
- negativePrompt is ignored on refinements — fold any push-away into the instruction itself ("flatten the gradient to solid ink" rather than a negative).
```

Read the surrounding prompt before editing: the "Negations — fluxPrompt must be POSITIVE-ONLY" section earlier in the prompt now conflicts with edit turns, so add one clause to ITS first line scoping it: "The image model does not subtract" → prefix the section header line with "(fresh generations)" or equivalent minimal scoping so the two sections cannot contradict. Keep the change minimal — do not rewrite unrelated prompt sections, and follow the C voice (plain, no hyperbole) for any wording.

- [ ] **Step 2: Run the existing AI suite**

Run: `npx vitest run src/lib/__tests__/ai.test.ts src/lib/__tests__/design-prompt.test.ts`
Expected: PASS (these test envelope parsing and guards, not prompt text). Prompt EFFICACY is explicitly not testable here — that is what the spec's slice 4 (eval harness) exists for; note this in the commit body.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai.ts
git commit -m "feat: refinement turns emit edit instructions, not re-expressed scenes

Efficacy is judged by the slice-4 eval harness; envelope shape unchanged."
```

---

### Task 5: Full gates + spec status note

**Files:**
- Modify: `docs/async-generation-and-edit-plan.md` (append a short "Slice 1 status" subsection under the slice-1 paragraph)

- [ ] **Step 1: Run every gate**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all green. Fix anything that isn't (and if a fix touches product code, re-run the full set).

- [ ] **Step 2: Append the status note to the spec**

Under the "Slice 1 — edit as an operation" paragraph in `docs/async-generation-and-edit-plan.md`, add:

```
Slice 1 status (2026-08-29): built. `editTransparent` in ideogram.ts
(anchor uploaded as multipart bytes; transparent_background true;
magic_prompt OFF); adapter routes anchored turns to it; placement
re-renders in preview/actions.ts use it directly and are priced as edits;
`generateAnchoredTransparent`/`generateImage` deleted, `removeBackground`
kept for ops scripts. Cost is per-operation via `costFor` (0.03 / 0.20 —
secondhand price, verify against the first bill). Refinement prompts are
edit instructions now. Not done here: v4 generate swap (slice 2),
variation classification (slice 2), any UI change.
```

- [ ] **Step 3: Commit**

```bash
git add docs/async-generation-and-edit-plan.md
git commit -m "docs: slice 1 status note"
```
