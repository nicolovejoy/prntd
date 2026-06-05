# Multi-generator Image Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the image generator a per-design choice behind a clean adapter interface, with a default single-model Generate and an opt-in Compare that runs the same prompt through every adapter.

**Architecture:** A new `src/lib/generators/` package defines one `ImageGenerator` interface and a registry. Each model is one adapter file that seals all model-specific behavior (endpoints, transparency, prompt shaping). The design row carries an `active_generator_id`; `generateDesign` routes through it; a new `compareGenerators` fans out; `adoptGenerator` sets the active model. The existing inline `generateTransparent`/`generateAnchoredTransparent` branch in `generateDesign` collapses into the Ideogram adapter.

**Tech Stack:** Next.js 16 App Router, Drizzle + Turso, Ideogram API, Recraft API, Replicate (BiRefNet), Vitest.

Spec: `docs/image-gen-multi-generator.md`.

---

## File Structure

Created:
- `src/lib/generators/types.ts` — `ImageGenerator` interface, `GeneratorId` type.
- `src/lib/generators/registry.ts` — `GENERATORS`, `DEFAULT_GENERATOR_ID`, `getGenerator`.
- `src/lib/generators/ideogram-generator.ts` — Ideogram adapter (wraps `lib/ideogram.ts` + `lib/replicate.ts`).
- `src/lib/generators/recraft-generator.ts` — Recraft adapter (calls Recraft v3 via Replicate).
- `src/lib/generators/__tests__/registry.test.ts` — registry + adapter purity tests.

Recraft runs through the existing `lib/replicate.ts` (official Replicate model `recraft-ai/recraft-v3`, reuses `REPLICATE_API_TOKEN` + the timeout/429-retry wrappers). No new credential, no new low-level client file.

Modified:
- `src/lib/db/schema.ts` — `design_image.generator`, `design.active_generator_id`.
- `src/lib/ai.ts` — drop the stale white-background instruction.
- `src/lib/design-images.ts` — `insertDesignImage` accepts `generator`; `getDesignSourceImages` returns `generator`.
- `src/app/design/actions.ts` — `generateDesign` routes through active generator; add `compareGenerators`, `adoptGenerator`.
- `src/app/design/page.tsx` — Compare wiring, active-model indicator, gallery `generator` passthrough.
- `src/app/design/chat-panel.tsx` — Compare button.
- `src/app/design/image-gallery.tsx` — per-card model tag.

---

## Task 1: Schema — generator columns

**Files:**
- Modify: `src/lib/db/schema.ts:55` (design), `src/lib/db/schema.ts:106` (design_image)
- Test: `src/lib/__tests__/design-publish.test.ts` (schema-columns describe block)

- [ ] **Step 1: Add the failing schema test**

In `src/lib/__tests__/design-publish.test.ts`, inside the existing `describe("schema columns", ...)` block, add:

```ts
  it("design_image.generator is nullable", () => {
    expect(designImage.generator.notNull).toBe(false);
  });

  it("design.activeGeneratorId is nullable", () => {
    expect(design.activeGeneratorId.notNull).toBe(false);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/lib/__tests__/design-publish.test.ts`
Expected: FAIL — `designImage.generator` / `design.activeGeneratorId` undefined.

- [ ] **Step 3: Add the columns**

In `src/lib/db/schema.ts`, in the `design` table after line 64 (`forkedFromImageId`):

```ts
  // Multi-generator: the thread's active image generator (adapter id).
  // Null resolves to DEFAULT_GENERATOR_ID. Set when the user adopts a
  // compared image.
  activeGeneratorId: text("active_generator_id"),
```

In the `designImage` table after line 106 (`backgroundColor`):

```ts
  // Multi-generator: which adapter produced this image ("ideogram",
  // "recraft"). Null on historical rows (pre-feature).
  generator: text("generator"),
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- src/lib/__tests__/design-publish.test.ts`
Expected: PASS.

- [ ] **Step 5: Push schema to Turso**

Run: `npm run db:push`
Expected: two `ALTER TABLE ... ADD COLUMN` applied. (Both nullable — no backfill needed.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/__tests__/design-publish.test.ts
git commit -m "feat: add generator + active_generator_id columns"
```

---

## Task 2: Adapter interface + registry

**Files:**
- Create: `src/lib/generators/types.ts`, `src/lib/generators/registry.ts`
- Test: `src/lib/generators/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/generators/__tests__/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getGenerator, DEFAULT_GENERATOR_ID, GENERATORS } from "../registry";

describe("getGenerator", () => {
  it("returns the default for a null id", () => {
    expect(getGenerator(null).id).toBe(DEFAULT_GENERATOR_ID);
  });

  it("returns the default for an unknown id", () => {
    expect(getGenerator("nope").id).toBe(DEFAULT_GENERATOR_ID);
  });

  it("returns the requested adapter when known", () => {
    expect(getGenerator("recraft").id).toBe("recraft");
  });

  it("every adapter's adaptPrompt is identity in v1", () => {
    for (const g of Object.values(GENERATORS)) {
      expect(g.adaptPrompt("hello world")).toBe("hello world");
    }
  });

  it("the default id is a registered adapter", () => {
    expect(GENERATORS[DEFAULT_GENERATOR_ID]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- src/lib/generators/__tests__/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the interface**

`src/lib/generators/types.ts`:

```ts
import type { AspectRatio } from "../products";

export type GeneratorId = "ideogram" | "recraft";

export type GenerateOptions = {
  aspect: AspectRatio;
  /** Optional continuity anchor for refinements. Adapters that can't
   *  use a style reference ignore it. */
  referenceImageUrl?: string;
};

export interface ImageGenerator {
  id: GeneratorId;
  label: string;
  /** Rough internal $/image for accounting (not customer-facing). */
  costPerImage: number;
  /** v1: identity. Later: per-model prompt shaping, sealed in the adapter. */
  adaptPrompt(base: string): string;
  /** Returns a transparent-PNG URL. Caller downloads bytes immediately. */
  generate(prompt: string, opts: GenerateOptions): Promise<string>;
}
```

- [ ] **Step 4: Create the registry**

`src/lib/generators/registry.ts`:

```ts
import type { GeneratorId, ImageGenerator } from "./types";
import { ideogramGenerator } from "./ideogram-generator";
import { recraftGenerator } from "./recraft-generator";

export const DEFAULT_GENERATOR_ID: GeneratorId = "ideogram";

export const GENERATORS: Record<GeneratorId, ImageGenerator> = {
  ideogram: ideogramGenerator,
  recraft: recraftGenerator,
};

/** Resolve an adapter by id, falling back to the default for null or
 *  unknown ids (historical rows, removed adapters). */
export function getGenerator(id: string | null | undefined): ImageGenerator {
  if (id && id in GENERATORS) return GENERATORS[id as GeneratorId];
  return GENERATORS[DEFAULT_GENERATOR_ID];
}
```

(Tasks 3 and 4 create the two imported adapters; this test passes after them. To keep Task 2 green in isolation, implement adapters next before re-running.)

- [ ] **Step 5: Commit after Tasks 3–4 make it pass** (see Task 4 Step 6).

---

## Task 3: Ideogram adapter

**Files:**
- Create: `src/lib/generators/ideogram-generator.ts`
- Modify: `src/lib/ai.ts:64-66` (drop stale white-bg instruction)

- [ ] **Step 1: Create the adapter**

`src/lib/generators/ideogram-generator.ts`:

```ts
import type { ImageGenerator } from "./types";
import { generateTransparent } from "../ideogram";
import { generateAnchoredTransparent } from "../replicate";

/**
 * Ideogram adapter. Without a reference image, uses Ideogram's native
 * transparent endpoint (single call). With one, routes to the Replicate
 * style-reference path + BiRefNet (the transparent endpoint doesn't accept
 * style refs). Both transparency mechanisms are sealed here.
 */
export const ideogramGenerator: ImageGenerator = {
  id: "ideogram",
  label: "Ideogram",
  costPerImage: 0.03,
  adaptPrompt: (base) => base,
  generate: (prompt, { aspect, referenceImageUrl }) =>
    referenceImageUrl
      ? generateAnchoredTransparent(prompt, referenceImageUrl, aspect)
      : generateTransparent(prompt, aspect),
};
```

- [ ] **Step 2: Drop the stale white-background instruction**

In `src/lib/ai.ts`, the `GENERATE_SYSTEM_PROMPT` print-specifications block (around lines 62-67), replace:

```
- DTG printing, 12" x 16" print area
- Design renders on a plain white background (background will be removed before printing)
- Always include "white background, isolated design" in the prompt
- Favor open, breathable compositions — avoid dense block prints (technical: ink coverage matters for DTG)
- Output must be a flat graphic / artwork only — NEVER a picture of a t-shirt. Never include "t-shirt" or "shirt" or "mockup" in the prompt. Use "graphic design", "illustration", "artwork", "print design", or the user's stated medium.
```

with:

```
- DTG printing, 12" x 16" print area
- The design is generated on a transparent background automatically — do NOT mention backgrounds, "white background", or "isolated design" in the prompt.
- Favor open, breathable compositions — avoid dense block prints (technical: ink coverage matters for DTG)
- Output must be a flat graphic / artwork only — NEVER a picture of a t-shirt. Never include "t-shirt" or "shirt" or "mockup" in the prompt. Use "graphic design", "illustration", "artwork", "print design", or the user's stated medium.
```

Also update the two hardcoded fallbacks in `constructFluxPrompt` (around lines 297 and 320): change `"graphic design illustration, white background, isolated design, high quality, printable"` to `"graphic design illustration, high quality, printable"` (both occurrences).

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head` (or rely on Task 4 build). Expected: no errors referencing these files. (Registry import of `recraftGenerator` still missing until Task 4 — that's expected; don't run the registry test yet.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/generators/ideogram-generator.ts src/lib/ai.ts
git commit -m "feat: Ideogram adapter; drop stale white-background prompt"
```

---

## Task 4: Recraft adapter (via Replicate)

**Files:**
- Modify: `src/lib/replicate.ts` (add `generateRecraftTransparent`)
- Create: `src/lib/generators/recraft-generator.ts`
- No new env var — uses the existing `REPLICATE_API_TOKEN`.

- [ ] **Step 1: Add the Recraft generation function to `replicate.ts`**

First Read `src/lib/replicate.ts` to confirm `withReplicate429Retry`, `withTimeout`, `REPLICATE_RUN_TIMEOUT_MS`, `removeBackground`, and the `replicate` client are in scope (they are). Append:

```ts
import type { AspectRatio } from "./products";

// recraft-v3 takes a WxH size string. 1:1 is the only aspect chat
// generations use today; the others map to the nearest supported size.
function toRecraftSize(aspect: AspectRatio): string {
  switch (aspect) {
    case "4:5":
      return "1024x1280";
    case "1:2":
      return "1024x2048";
    default:
      return "1024x1024";
  }
}

/**
 * Generate via Recraft v3 on Replicate (official model — warm, stable,
 * reuses REPLICATE_API_TOKEN). vector_illustration style for clean
 * line/graphic art. Recraft has no native transparent output, so BiRefNet
 * drops the background afterward.
 *
 * NOTE: BiRefNet is subject matting — interior white can stay opaque (the
 * open white-fill risk). Verify on a line-drawing case; if it fails, swap
 * the removeBackground call for a luminance knockout here (sealed; no
 * change anywhere else). Confirm the exact input field names on
 * https://replicate.com/recraft-ai/recraft-v3/api during this step.
 */
export async function generateRecraftTransparent(
  prompt: string,
  aspect: AspectRatio = "1:1"
): Promise<string> {
  const rgbUrl = await withReplicate429Retry("generateRecraftTransparent", async () => {
    const output = await withTimeout("generateRecraftTransparent", REPLICATE_RUN_TIMEOUT_MS, () =>
      replicate.run("recraft-ai/recraft-v3", {
        input: {
          prompt,
          style: "vector_illustration",
          size: toRecraftSize(aspect),
        },
      })
    );
    return String(output);
  });
  return await removeBackground(rgbUrl);
}
```

(If `AspectRatio` is already imported at the top of `replicate.ts`, don't duplicate the import — it is, via `import type { AspectRatio } from "./products"` on line 2. Drop the import line above and just add the functions.)

- [ ] **Step 2: Create the adapter**

`src/lib/generators/recraft-generator.ts`:

```ts
import type { ImageGenerator } from "./types";
import { generateRecraftTransparent } from "../replicate";

/**
 * Recraft adapter — vector_illustration output via Replicate, background
 * removed. A second generator for style variety in Compare. v1 ignores
 * referenceImageUrl (no style-ref continuity yet); refinements regenerate
 * from the prompt.
 */
export const recraftGenerator: ImageGenerator = {
  id: "recraft",
  label: "Recraft",
  costPerImage: 0.08,
  adaptPrompt: (base) => base,
  generate: (prompt, { aspect }) => generateRecraftTransparent(prompt, aspect),
};
```

- [ ] **Step 3: Run the registry test**

Run: `npm test -- src/lib/generators/__tests__/registry.test.ts`
Expected: PASS (all 5).

- [ ] **Step 4: Commit**

```bash
git add src/lib/replicate.ts src/lib/generators/recraft-generator.ts src/lib/generators/types.ts src/lib/generators/registry.ts src/lib/generators/__tests__/registry.test.ts
git commit -m "feat: Recraft adapter via Replicate + generator registry"
```

---

## Task 5: Route generateDesign through the active generator

**Files:**
- Modify: `src/lib/design-images.ts:77-107` (insertDesignImage), `getDesignSourceImages`
- Modify: `src/app/design/actions.ts:121-162` (generateDesign body)

- [ ] **Step 1: Add `generator` to insertDesignImage**

In `src/lib/design-images.ts`, add `generator?: string | null;` to the `insertDesignImage` params type, and `generator: params.generator ?? null,` to the `db.insert(...).values({...})` object.

- [ ] **Step 2: Return `generator` from getDesignSourceImages**

In `getDesignSourceImages` (around line 259-286), add `generator: designImageTable.generator` to the select and `generator: r.generator` to the mapped return; add `generator: string | null;` to its return type.

- [ ] **Step 3: Route generation through the adapter**

In `src/app/design/actions.ts` `generateDesign`, replace the image-generation block (lines 121-145, the `anchorUrl` resolution + the `try { imageUrl = anchorUrl ? generateAnchoredTransparent(...) : generateTransparent(...) }`) with:

```ts
  const anchorUrl =
    aiResponse.referenceImage != null
      ? images.find((img) => img.number === aiResponse.referenceImage)?.url
      : undefined;

  const generator = getGenerator(found.activeGeneratorId);

  let imageUrl: string;
  try {
    imageUrl = await generator.generate(generator.adaptPrompt(aiResponse.fluxPrompt), {
      aspect: "1:1",
      referenceImageUrl: anchorUrl,
    });
  } catch (err) {
    console.error("generateDesign image generation failed:", err);
    throw new Error("Image generation failed");
  }
```

Add import at top: `import { getGenerator } from "@/lib/generators/registry";`. Remove the now-unused `import { generateTransparent } from "@/lib/ideogram";` and `import { generateAnchoredTransparent } from "@/lib/replicate";` (the adapters own those now).

- [ ] **Step 4: Record provenance + real cost on the insert**

In the same function, the `insertDesignImage({ ... })` call (line 156): add `generator: generator.id,` and change `generationCost: COST_PER_GENERATION` to `generationCost: generator.costPerImage`. In the subsequent `designTable` update (line 179), change `generationCost: found.generationCost + COST_PER_GENERATION` to `generationCost: found.generationCost + generator.costPerImage`. (Leave `COST_PER_GENERATION` defined — other paths like preview placement renders still use it.)

- [ ] **Step 5: Type-check + run existing design tests**

Run: `npm run build 2>&1 | grep -iE "error|generateDesign" | head` then `npm test`
Expected: build compiles; all tests pass. (`found.activeGeneratorId` exists after Task 1.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/design-images.ts src/app/design/actions.ts
git commit -m "feat: route generateDesign through active generator + record provenance"
```

---

## Task 6: compareGenerators action

**Files:**
- Modify: `src/app/design/actions.ts` (new export)

- [ ] **Step 1: Add the action**

Append to `src/app/design/actions.ts`:

```ts
/**
 * Run the same Claude-built prompt through every registered generator and
 * insert one design_image per result, tagged with its generator. Does NOT
 * change the design's active generator — that happens on adoptGenerator.
 * Returns the new images (id + url + generator) newest-last.
 */
export async function compareGenerators(designId: string, userMessage?: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await getOrCreateDesign(designId, session.user.id);
  const messages = await getDesignMessages(designId);
  const images = await getDesignImagesForAIContext(designId);
  const messagesForPrompt: ChatMessage[] = userMessage
    ? [...messages, { id: "pending", designId, role: "user", content: userMessage, imageId: null, createdAt: new Date() }]
    : messages;

  let aiResponse;
  try {
    aiResponse = await constructFluxPrompt(messagesForPrompt, images, userMessage);
  } catch (err) {
    console.error("compareGenerators constructFluxPrompt failed:", err);
    throw new Error("Failed to construct prompt");
  }

  const anchorUrl =
    aiResponse.referenceImage != null
      ? images.find((img) => img.number === aiResponse.referenceImage)?.url
      : undefined;

  const results = await Promise.all(
    Object.values(GENERATORS).map(async (g, i) => {
      try {
        const url = await g.generate(g.adaptPrompt(aiResponse.fluxPrompt), {
          aspect: "1:1",
          referenceImageUrl: anchorUrl,
          negativePrompt: aiResponse.negativePrompt,
        });
        const response = await fetch(url);
        const buffer = Buffer.from(await response.arrayBuffer());
        // Distinct generation number per adapter so parallel uploads don't
        // collide on the R2 key (designs/{id}/{generation}.png).
        const generation = found.generationCount + 1 + i;
        const r2Url = await uploadDesignImage(designId, generation, buffer);
        const imageId = await insertDesignImage({
          designId,
          imageUrl: r2Url,
          aspectRatio: "1:1",
          prompt: aiResponse.fluxPrompt,
          generationCost: g.costPerImage,
          generator: g.id,
        });
        return { imageId, imageUrl: r2Url, generator: g.id, cost: g.costPerImage };
      } catch (err) {
        console.error(`compareGenerators ${g.id} failed:`, err);
        return null;
      }
    })
  );

  const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (ok.length === 0) throw new Error("All generators failed");

  if (userMessage) {
    await insertChatMessage({ designId, role: "user", content: userMessage });
  }
  await insertChatMessage({
    designId,
    role: "assistant",
    content: `Compared ${ok.length} generators — tap one to keep working with it.`,
  });

  await db
    .update(designTable)
    .set({
      generationCount: found.generationCount + ok.length,
      generationCost: found.generationCost + ok.reduce((sum, r) => sum + r.cost, 0),
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return ok;
}
```

Add `import { GENERATORS } from "@/lib/generators/registry";` (extend the Task 5 import line). Confirm `uploadDesignImage`, `constructFluxPrompt`, `getOrCreateDesign`, `getDesignMessages`, `getDesignImagesForAIContext`, `insertChatMessage`, `designTable`, `db`, `eq` are already imported in this file (they are — used by `generateDesign`).

- [ ] **Step 2: Build check**

Run: `npm run build 2>&1 | grep -iE "error" | head`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/design/actions.ts
git commit -m "feat: compareGenerators action (fan-out, tagged images)"
```

---

## Task 7: adoptGenerator action

**Files:**
- Modify: `src/app/design/actions.ts` (new export)

- [ ] **Step 1: Add the action**

Append to `src/app/design/actions.ts`:

```ts
/**
 * Adopt a compared image: set the design's active generator to that
 * image's generator and make it the primary image. Owner-auth.
 */
export async function adoptGenerator(designId: string, imageId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const found = await db.query.design.findFirst({ where: eq(designTable.id, designId) });
  if (!found || found.userId !== session.user.id) throw new Error("Unauthorized");

  const image = await db.query.designImage.findFirst({
    where: eq(designImageTable.id, imageId),
  });
  if (!image || image.designId !== designId) throw new Error("Image not found");

  await db
    .update(designTable)
    .set({
      activeGeneratorId: image.generator ?? DEFAULT_GENERATOR_ID,
      primaryImageId: imageId,
      updatedAt: new Date(),
    })
    .where(eq(designTable.id, designId));

  return { activeGeneratorId: image.generator ?? DEFAULT_GENERATOR_ID };
}
```

Add `DEFAULT_GENERATOR_ID` to the generators import, and confirm `designImageTable` is imported (it is — used elsewhere). 

- [ ] **Step 2: Build check**

Run: `npm run build 2>&1 | grep -iE "error" | head`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/design/actions.ts
git commit -m "feat: adoptGenerator action (set active generator + primary)"
```

---

## Task 8: Gallery — expose + tag generator

**Files:**
- Modify: `src/lib/design-images.ts` (`getDesignGallery` source mapping returns generator), `src/app/design/page.tsx:51-59` (DesignImage map), `src/lib/design-images.ts:11-17` (DesignImage type), `src/app/design/image-gallery.tsx:68-87`

- [ ] **Step 1: Carry generator onto the gallery DesignImage type**

In `src/lib/design-images.ts`, add `generator: string | null;` to the `DesignImage` type (lines 11-17).

- [ ] **Step 2: Populate it in page.tsx**

In `src/app/design/page.tsx` `refreshGallery` (lines 52-58), add `generator: s.generator,` to the mapped object. (Requires Task 5 Step 2 so `s.generator` exists on source rows.)

- [ ] **Step 3: Render the tag**

In `src/app/design/image-gallery.tsx`, after the `#{img.number}` span (line 84-86), add:

```tsx
                {img.generator && (
                  <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded capitalize">
                    {img.generator}
                  </span>
                )}
```

- [ ] **Step 4: Build check**

Run: `npm run build 2>&1 | grep -iE "error" | head`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design-images.ts src/app/design/page.tsx src/app/design/image-gallery.tsx
git commit -m "feat: tag gallery images with their generator"
```

---

## Task 9: Compare button + adopt wiring + active-model indicator

**Files:**
- Modify: `src/app/design/chat-panel.tsx` (Compare button + prop), `src/app/design/page.tsx` (handleCompare, handleAdopt, pass props)

- [ ] **Step 1: Add the Compare prop + button to ChatPanel**

In `src/app/design/chat-panel.tsx`, add `onCompare: (message?: string) => void;` and `activeGenerator: string;` to the props type. After the Generate `<Button>` (lines 272-278), add:

```tsx
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (generating) return;
            const msg = input.trim() || undefined;
            if (msg) setInput("");
            onCompare(msg);
          }}
          disabled={busy || (messages.length === 0 && !input.trim())}
          title={`Generate with all models (current: ${activeGenerator})`}
        >
          Compare
        </Button>
```

- [ ] **Step 2: Add handlers in page.tsx**

In `src/app/design/page.tsx`, add state `const [activeGenerator, setActiveGenerator] = useState("ideogram");` and handlers:

```tsx
  async function handleCompare(userMessage?: string) {
    setGenerating(true);
    if (userMessage) {
      setMessages((prev) => [...prev, makeOptimisticMessage("user", userMessage)]);
    }
    try {
      const results = await compareGenerators(designId.current, userMessage);
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", `Compared ${results.length} generators — tap one to keep working with it.`),
      ]);
      await refreshGallery();
      if (window.matchMedia("(max-width: 767px)").matches) setDrawerOpen(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        makeOptimisticMessage("assistant", "Comparison failed. Try again?"),
      ]);
    } finally {
      setGenerating(false);
    }
  }

  async function handleAdopt(imageId: string, imageUrl: string) {
    const { activeGeneratorId } = await adoptGenerator(designId.current, imageId);
    setActiveGenerator(activeGeneratorId);
    setSelectedImage(imageUrl);
  }
```

Import `compareGenerators` and `adoptGenerator` from `./actions`. In the `getDesign(id)` resume effect (lines 67-71), also `setActiveGenerator(design.activeGeneratorId ?? "ideogram")` — this requires `getDesign` to return `activeGeneratorId`; add it to the `getDesign` select in `actions.ts` if absent.

- [ ] **Step 3: Pass props to ChatPanel**

In `src/app/design/page.tsx` JSX (around line 245), add `onCompare={handleCompare}` and `activeGenerator={activeGenerator}` to `<ChatPanel ... />`.

- [ ] **Step 4: Wire adopt from the lightbox**

First Read `src/app/design/image-lightbox.tsx` to see its props and how the page passes them (it already receives the image list + index from `page.tsx`). Then:
1. Add `onAdopt: (imageId: string, imageUrl: string) => void;` to the lightbox props type.
2. In the lightbox action row for the current image, add a button rendered only when `image.generator` is set:

```tsx
{image.generator && (
  <Button
    type="button"
    variant="secondary"
    size="sm"
    onClick={() => onAdopt(image.id, image.url)}
  >
    Use {image.generator}
  </Button>
)}
```

3. In `page.tsx`, pass `onAdopt={handleAdopt}` to `<ImageLightbox ... />`. `handleAdopt` (Step 2) already sets the active generator and selected image; closing the lightbox after adopt is optional polish.

The lightbox's `image` objects are the same `DesignImage` gallery entries, which carry `generator` after Task 8 Step 1.

- [ ] **Step 5: Manual smoke + build**

Run: `npm run build 2>&1 | grep -iE "error" | head`
Expected: no errors. Then with `IDEOGRAM_API_KEY` + `REPLICATE_API_TOKEN` set locally (both already are), in the running app: chat → Compare → two tagged images appear (Ideogram + Recraft) → tap one → it becomes selected/primary and the active-model title updates → plain Generate now uses the adopted model.

- [ ] **Step 6: Commit**

```bash
git add src/app/design/chat-panel.tsx src/app/design/page.tsx src/app/design/image-lightbox.tsx
git commit -m "feat: Compare button, adopt wiring, active-model indicator"
```

---

## Task 10: Final verification

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: 0 errors (pre-existing warnings OK).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success. (No new env needed — Recraft uses `REPLICATE_API_TOKEN`, checked lazily inside the function, so the build doesn't require it.)

- [ ] **Step 4: Commit any cleanup, open PR**

```bash
git add -A && git commit -m "chore: multi-generator cleanup" || true
```

---

## Notes / risks carried from the spec

- **Recraft does NOT solve the white-fill bug by itself** (corrected after verification): Recraft has no native transparent output; we drop its background with BiRefNet, which is subject matting and can leave interior white opaque — the same issue as the Ideogram-anchored path. So Recraft v1 is a **style-variety** second generator, not the white fix. The reliable garment-shows-through fix is a deterministic **luminance white-knockout** (key near-white → transparent), added later inside the relevant adapter(s) — sealed, no architecture change. Verify Recraft's line-drawing output during Task 4; if interior white persists and matters, that's when the knockout goes in.
- **Recraft via Replicate** (Task 4): official model `recraft-ai/recraft-v3`, reuses `REPLICATE_API_TOKEN` — no Recraft account/key. Confirm the exact `input` field names on https://replicate.com/recraft-ai/recraft-v3/api during Step 1.
- **compareGenerators cost**: fans out to every adapter (2 today), each recording its own `costPerImage` (Ideogram $0.03, Recraft $0.08 — Recraft is two Replicate calls: generate + background removal). Opt-in only. When a 3rd adapter lands, add a selection UI before shipping it (out of scope here).
- **Adopt UX** (Task 9 Step 4): v1 is a minimal "use this" button on a compared image. A richer compare view is a later polish.
- **Prompt-layer extraction deferred:** the spec floated pulling prompt construction out of the `ai.ts` system-prompt blob into its own unit. This plan delivers the per-model prompt seam via `adaptPrompt` (which is the part the feature needs) and removes the stale instruction, but does NOT restructure `ai.ts` — a broad refactor there is risk the feature doesn't require. Revisit if/when per-model `adaptPrompt` implementations grow enough to want a shared prompt-assembly home.
