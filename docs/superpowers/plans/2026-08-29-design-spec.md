# DesignSpec + v4 Upgrade (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude emits a typed DesignSpec (or an edit instruction, or a clarify) instead of a prompt string; fresh generations move to Ideogram v4 `generate-transparent` via its structured `json_prompt` (magic prompt disabled by contract); the #137 class becomes unrepresentable (a spec requires a subject) instead of guarded against.

**Architecture:** New provider-neutral `src/lib/design-spec.ts` (types + validation + human-readable summary). New `generateTransparentV4(jsonPrompt, aspect)` client in `ideogram.ts`. New `constructDesignBrief()` in `ai.ts` returns a discriminated union `{operation: "clarify"|"generate"|"edit"}` — built additively, then a single cutover task rewires `generateDesign`, restructures the `ImageGenerator` interface around typed operations, and deletes `constructFluxPrompt`, the v3 generate client, and the now-dead `isClarificationOnly`/`isSubjectlessPrompt` guards.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Vitest, native fetch/FormData, Anthropic SDK (existing patterns), Ideogram API v1/v4.

**Spec:** `docs/async-generation-and-edit-plan.md` — "Slice 2 — DesignSpec, and the v4 upgrade" is the binding text. Slice 1 (in this branch's history) already routes anchored turns to `/v1/edit`.

## Global Constraints

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all green at the end. Run typecheck explicitly per task.
- `@typescript-eslint/no-explicit-any` is `error` in product code, `off` in tests. `catch (err)` + narrow with `err instanceof Error ? err.message : String(err)`. No new dependencies.
- **v4 API facts (verified against `developer.ideogram.ai/openapi.json` 2026-08-29; do not re-derive):** `POST https://api.ideogram.ai/v1/ideogram-v4/generate-transparent`, multipart form. Fields: `json_prompt` (JSON string; when supplied magic-prompt is DISABLED and `compositional_deconstruction.background` is replaced server-side with a transparent-background directive), `aspect_ratio` (enum `AUTO|1x1|4x5|3x4|…` — NxM strings, same mapping as v3), `rendering_speed` (`TURBO|DEFAULT|QUALITY`, default DEFAULT — we send TURBO), `output_resolution` (unset = default), `enable_copyright_detection` (unset). NO `negative_prompt`, NO `seed`, NO `magic_prompt` field. Response: `{response_type, created, data: [{url, prompt, resolution, is_image_safe, seed}]}` — `data[0].url`.
- **json_prompt wire shape:** `{high_level_description: string (required), style_description?: {aesthetics?, art_style?, lighting?, medium?, photo?, color_palette?: ["#RRGGBB"]}, compositional_deconstruction: {background: string (required), elements: [{type:"obj", desc, bbox?, color_palette?} | {type:"text", text, desc?, bbox?, color_palette?}] (required)}}`. We never emit `bbox` or `photo` in this slice.
- Cost: v4 TURBO generate = `0.03`; edit stays `EDIT_COST_PER_IMAGE` (0.2). Both flow through `costFor`.
- `isGenerateIntent` (client-side trigger) in `design-prompt.ts` STAYS. Only `isClarificationOnly` + `isSubjectlessPrompt` are deleted, and only in the cutover task after their sole caller is gone.
- The edit path built in slice 1 (`editTransparent`, `/v1/edit`, `EDIT_COST_PER_IMAGE`, the reframe placement re-render in `preview/actions.ts`) does not change. `preview/actions.ts` is untouched this slice.
- Rulings already made (do not re-litigate; they are in the SDD ledger): "variation" folds into generate; negativePrompt retires; an edit turn with no resolvable anchor image becomes a clarification; `image.prompt` stores `renderSpecSummary(spec)` for generates and the edit instruction for edits; full structured spec is NOT persisted this slice.

---

### Task 1: `design-spec.ts` — types, validation, summary

**Files:**
- Create: `src/lib/design-spec.ts`
- Test: `src/lib/__tests__/design-spec.test.ts` (create)

**Interfaces:**
- Produces: `DesignSpec`, `DesignSpecElement`, `parseDesignSpec(input: unknown): DesignSpec | null`, `renderSpecSummary(spec: DesignSpec): string`. Tasks 3 and 4 import all four.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/design-spec.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseDesignSpec, renderSpecSummary } from "../design-spec";

const VALID = {
  subject: "A bear reading a book under a pine tree",
  style: { artStyle: "woodcut illustration", colorPalette: ["#1A2B3C"] },
  elements: [
    { type: "obj", desc: "a bear seated with an open book" },
    { type: "text", text: "READ MORE", desc: "curved hand-carved lettering below" },
  ],
};

describe("parseDesignSpec", () => {
  it("accepts a valid spec and preserves fields", () => {
    const spec = parseDesignSpec(VALID);
    expect(spec).not.toBeNull();
    expect(spec!.subject).toBe(VALID.subject);
    expect(spec!.elements).toHaveLength(2);
    expect(spec!.style?.artStyle).toBe("woodcut illustration");
  });

  it("rejects a missing or empty subject (#137 made unrepresentable)", () => {
    expect(parseDesignSpec({ ...VALID, subject: "" })).toBeNull();
    expect(parseDesignSpec({ ...VALID, subject: "   " })).toBeNull();
    const { subject: _subject, ...noSubject } = VALID;
    expect(parseDesignSpec(noSubject)).toBeNull();
  });

  it("rejects empty or missing elements", () => {
    expect(parseDesignSpec({ ...VALID, elements: [] })).toBeNull();
    const { elements: _elements, ...noElements } = VALID;
    expect(parseDesignSpec(noElements)).toBeNull();
  });

  it("rejects an obj element without desc and a text element without text", () => {
    expect(parseDesignSpec({ ...VALID, elements: [{ type: "obj", desc: "" }] })).toBeNull();
    expect(parseDesignSpec({ ...VALID, elements: [{ type: "text", text: "" }] })).toBeNull();
    expect(parseDesignSpec({ ...VALID, elements: [{ type: "wat", desc: "x" }] })).toBeNull();
  });

  it("drops malformed palette entries but keeps valid hexes", () => {
    const spec = parseDesignSpec({
      ...VALID,
      style: { colorPalette: ["#FFD700", "gold", "#12345", "#a1B2c3"] },
    });
    expect(spec!.style?.colorPalette).toEqual(["#FFD700", "#a1B2c3"]);
  });

  it("returns null for non-objects", () => {
    expect(parseDesignSpec(null)).toBeNull();
    expect(parseDesignSpec("a bear")).toBeNull();
    expect(parseDesignSpec(42)).toBeNull();
  });

  it("tolerates a missing style block", () => {
    const { style: _style, ...noStyle } = VALID;
    const spec = parseDesignSpec(noStyle);
    expect(spec).not.toBeNull();
    expect(spec!.style).toBeUndefined();
  });
});

describe("renderSpecSummary", () => {
  it("joins subject, style notes, and literal text", () => {
    const spec = parseDesignSpec(VALID)!;
    const summary = renderSpecSummary(spec);
    expect(summary).toContain("A bear reading a book under a pine tree");
    expect(summary).toContain("woodcut illustration");
    expect(summary).toContain('"READ MORE"');
  });

  it("is just the subject when there is nothing else", () => {
    const spec = parseDesignSpec({
      subject: "A mountain",
      elements: [{ type: "obj", desc: "a mountain" }],
    })!;
    expect(renderSpecSummary(spec)).toBe("A mountain");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/design-spec.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/lib/design-spec.ts`**

```typescript
// Provider-neutral structured design brief. A spec REQUIRES a concrete
// subject and at least one element, which makes the #137 failure class
// (style boilerplate with no subject reaching the image model)
// unrepresentable instead of guarded against. Rendering to a provider's
// wire format lives in that provider's adapter, not here.

export type DesignSpecElement =
  | { type: "obj"; desc: string; colorPalette?: string[] }
  | { type: "text"; text: string; desc?: string; colorPalette?: string[] };

export type DesignSpecStyle = {
  aesthetics?: string;
  artStyle?: string;
  medium?: string;
  lighting?: string;
  colorPalette?: string[];
};

export type DesignSpec = {
  subject: string;
  style?: DesignSpecStyle;
  elements: DesignSpecElement[];
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanPalette(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const hexes = value.filter((v): v is string => typeof v === "string" && HEX_COLOR.test(v));
  return hexes.length > 0 ? hexes : undefined;
}

function parseElement(input: unknown): DesignSpecElement | null {
  if (typeof input !== "object" || input === null) return null;
  const el = input as Record<string, unknown>;
  const palette = cleanPalette(el.colorPalette);
  if (el.type === "obj") {
    const desc = cleanString(el.desc);
    if (!desc) return null;
    return { type: "obj", desc, ...(palette ? { colorPalette: palette } : {}) };
  }
  if (el.type === "text") {
    const text = cleanString(el.text);
    if (!text) return null;
    const desc = cleanString(el.desc);
    return {
      type: "text",
      text,
      ...(desc ? { desc } : {}),
      ...(palette ? { colorPalette: palette } : {}),
    };
  }
  return null;
}

/** Validate an untrusted candidate (Claude output) into a DesignSpec, or null. */
export function parseDesignSpec(input: unknown): DesignSpec | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const subject = cleanString(raw.subject);
  if (!subject) return null;
  if (!Array.isArray(raw.elements) || raw.elements.length === 0) return null;
  const elements: DesignSpecElement[] = [];
  for (const candidate of raw.elements) {
    const el = parseElement(candidate);
    if (!el) return null;
    elements.push(el);
  }
  let style: DesignSpecStyle | undefined;
  if (typeof raw.style === "object" && raw.style !== null) {
    const s = raw.style as Record<string, unknown>;
    const built: DesignSpecStyle = {};
    const aesthetics = cleanString(s.aesthetics);
    const artStyle = cleanString(s.artStyle);
    const medium = cleanString(s.medium);
    const lighting = cleanString(s.lighting);
    const colorPalette = cleanPalette(s.colorPalette);
    if (aesthetics) built.aesthetics = aesthetics;
    if (artStyle) built.artStyle = artStyle;
    if (medium) built.medium = medium;
    if (lighting) built.lighting = lighting;
    if (colorPalette) built.colorPalette = colorPalette;
    if (Object.keys(built).length > 0) style = built;
  }
  return { subject, ...(style ? { style } : {}), elements };
}

/**
 * Human-readable one-liner for storage/display ("Prompt used:" context,
 * published-naming input). The structured spec itself is not persisted in
 * this slice.
 */
export function renderSpecSummary(spec: DesignSpec): string {
  const parts: string[] = [spec.subject];
  const styleBits = [
    spec.style?.artStyle,
    spec.style?.medium,
    spec.style?.aesthetics,
  ].filter((s): s is string => Boolean(s));
  if (styleBits.length > 0) parts.push(styleBits.join(", "));
  const texts = spec.elements
    .filter((el): el is Extract<DesignSpecElement, { type: "text" }> => el.type === "text")
    .map((el) => `text: "${el.text}"`);
  parts.push(...texts);
  return parts.join(" — ");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/__tests__/design-spec.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design-spec.ts src/lib/__tests__/design-spec.test.ts
git commit -m "feat: DesignSpec type + validation + summary (subjectless prompts unrepresentable)"
```

---

### Task 2: v4 generate client

**Files:**
- Modify: `src/lib/ideogram.ts`
- Test: `src/lib/__tests__/ideogram-v4.test.ts` (create)

**Interfaces:**
- Produces: `V4JsonPrompt` (wire type), `generateTransparentV4(jsonPrompt: V4JsonPrompt, aspectRatio?: AspectRatio): Promise<string>`, `export const GENERATE_COST_PER_IMAGE = 0.03;`. Task 4 imports all three. The existing v3 `generateTransparent` is NOT touched in this task (deleted in Task 4 when its last caller switches).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/ideogram-v4.test.ts` (model it on the existing `ideogram-edit.test.ts` in the same directory — same `vi.stubGlobal("fetch", …)`/`vi.stubEnv` harness):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateTransparentV4, GENERATE_COST_PER_IMAGE, type V4JsonPrompt } from "../ideogram";

const JSON_PROMPT: V4JsonPrompt = {
  high_level_description: "A bear reading a book under a pine tree",
  style_description: { art_style: "woodcut illustration", color_palette: ["#1A2B3C"] },
  compositional_deconstruction: {
    background: "transparent background",
    elements: [
      { type: "obj", desc: "a bear seated with an open book" },
      { type: "text", text: "READ MORE", desc: "curved hand-carved lettering below" },
    ],
  },
};

function mockFetch(apiResponse: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(apiResponse.body ?? {}), {
      status: apiResponse.ok === false ? (apiResponse.status ?? 500) : 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

describe("generateTransparentV4", () => {
  beforeEach(() => vi.stubEnv("IDEOGRAM_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts json_prompt as a JSON string with TURBO speed and NxM aspect", async () => {
    const { calls } = mockFetch({
      body: { response_type: "generated", created: "now", data: [{ url: "https://ideogram.ai/v4.png" }] },
    });
    const url = await generateTransparentV4(JSON_PROMPT, "4:5");
    expect(url).toBe("https://ideogram.ai/v4.png");
    expect(calls[0].url).toBe("https://api.ideogram.ai/v1/ideogram-v4/generate-transparent");
    expect((calls[0].init?.headers as Record<string, string>)["Api-Key"]).toBe("test-key");
    const fd = calls[0].init?.body as FormData;
    expect(JSON.parse(fd.get("json_prompt") as string)).toEqual(JSON_PROMPT);
    expect(fd.get("aspect_ratio")).toBe("4x5");
    expect(fd.get("rendering_speed")).toBe("TURBO");
    expect(fd.get("magic_prompt")).toBeNull();
    expect(fd.get("negative_prompt")).toBeNull();
  });

  it("defaults aspect to 1x1", async () => {
    const { calls } = mockFetch({
      body: { response_type: "generated", created: "now", data: [{ url: "https://x/y.png" }] },
    });
    await generateTransparentV4(JSON_PROMPT);
    expect(((calls[0].init?.body as FormData).get("aspect_ratio"))).toBe("1x1");
  });

  it("throws with status on non-OK response", async () => {
    mockFetch({ ok: false, status: 422, body: { error: "bad" } });
    await expect(generateTransparentV4(JSON_PROMPT)).rejects.toThrow(/422/);
  });

  it("throws when the response has no URL", async () => {
    mockFetch({ body: { response_type: "generated", created: "now", data: [] } });
    await expect(generateTransparentV4(JSON_PROMPT)).rejects.toThrow(/URL/i);
  });

  it("throws when IDEOGRAM_API_KEY is missing", async () => {
    vi.stubEnv("IDEOGRAM_API_KEY", "");
    mockFetch({ body: {} });
    await expect(generateTransparentV4(JSON_PROMPT)).rejects.toThrow(/IDEOGRAM_API_KEY/);
  });

  it("exports the per-generate cost", () => {
    expect(GENERATE_COST_PER_IMAGE).toBe(0.03);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/ideogram-v4.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement in `src/lib/ideogram.ts`**

Append (reuse `toIdeogramAspect`, `withTimeout`; follow the file's existing endpoint-client shape):

```typescript
const V4_GENERATE_ENDPOINT =
  "https://api.ideogram.ai/v1/ideogram-v4/generate-transparent";
const V4_TIMEOUT_MS = 120_000;

/** Rough internal $/image for a v4 TURBO generation. */
export const GENERATE_COST_PER_IMAGE = 0.03;

/** Ideogram 4.0 structured-prompt wire format (openapi V4JsonPrompt).
 *  Supplying json_prompt disables magic prompt by contract; on the
 *  transparent endpoint the background field is replaced server-side with
 *  a transparent-background directive. */
export type V4JsonPrompt = {
  high_level_description: string;
  style_description?: {
    aesthetics?: string;
    art_style?: string;
    medium?: string;
    lighting?: string;
    color_palette?: string[];
  };
  compositional_deconstruction: {
    background: string;
    elements: Array<
      | { type: "obj"; desc: string; color_palette?: string[] }
      | { type: "text"; text: string; desc?: string; color_palette?: string[] }
    >;
  };
};

/**
 * Generate an RGBA PNG via Ideogram 4.0's transparent endpoint using the
 * structured json_prompt contract. Returns the image URL — caller downloads
 * the bytes immediately, Ideogram URLs expire.
 */
export async function generateTransparentV4(
  jsonPrompt: V4JsonPrompt,
  aspectRatio: AspectRatio = "1:1"
): Promise<string> {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) throw new Error("IDEOGRAM_API_KEY missing");

  const fd = new FormData();
  fd.append("json_prompt", JSON.stringify(jsonPrompt));
  fd.append("aspect_ratio", toIdeogramAspect(aspectRatio));
  fd.append("rendering_speed", "TURBO");

  const res = await withTimeout("generateTransparentV4", V4_TIMEOUT_MS, () =>
    fetch(V4_GENERATE_ENDPOINT, {
      method: "POST",
      headers: { "Api-Key": apiKey },
      body: fd,
    })
  );

  if (!res.ok) {
    throw new Error(`Ideogram v4 ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error(`No URL in Ideogram v4 response: ${JSON.stringify(data)}`);
  return url;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/__tests__/ideogram-v4.test.ts src/lib/__tests__/ideogram-edit.test.ts` (the edit tests guard against accidental drift in the shared file)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ideogram.ts src/lib/__tests__/ideogram-v4.test.ts
git commit -m "feat: Ideogram v4 generate-transparent client (json_prompt, TURBO)"
```

---

### Task 3: `constructDesignBrief` — the new envelope (additive)

**Files:**
- Modify: `src/lib/ai.ts` (add new exports; do NOT touch `constructFluxPrompt` or `GENERATE_SYSTEM_PROMPT` — they are deleted in Task 4)
- Test: `src/lib/__tests__/design-brief.test.ts` (create)

**Interfaces:**
- Consumes: `parseDesignSpec`, `DesignSpec` from `./design-spec` (Task 1); the module-private `buildMessages` + `anthropic` client already in `ai.ts`.
- Produces:

```typescript
export type DesignBrief =
  | { operation: "clarify"; message: string }
  | { operation: "generate"; message: string; spec: DesignSpec }
  | { operation: "edit"; message: string; editInstruction: string; referenceImage: number | null };

export async function constructDesignBrief(
  chatHistory: ChatMessage[],
  images: DesignImage[],
  userMessage?: string
): Promise<DesignBrief>;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/design-brief.test.ts`. Mock the Anthropic client the same way the existing `constructFluxPrompt` describe block in `ai.test.ts` does (a `vi.mock("@anthropic-ai/sdk", …)` returning a controllable `messages.create` — copy that harness, don't invent a new one). Ten cases, each a real test with a concrete envelope payload and assertions:

1. Valid generate: model returns `{"message":"Drawing it","operation":"generate","spec":{"subject":"a bear","elements":[{"type":"obj","desc":"a bear"}]}}` → `{operation:"generate"}`, spec preserved, `message === "Drawing it"`.
2. Generate with an INVALID spec (subject missing) → `{operation:"clarify"}`, message falls back to the model's `message` field.
3. Valid edit: `{"operation":"edit","editInstruction":"make the bear larger","referenceImage":2}` → `{operation:"edit"}`, instruction + `referenceImage: 2`.
4. Edit with empty `editInstruction` → clarify.
5. Explicit clarify: `{"operation":"clarify","message":"What subject?"}` → clarify with that message.
6. Unknown operation value → clarify.
7. Non-JSON prose response → clarify whose message IS the prose (the #137 rule: prose means Claude answered in chat; surface it, render nothing).
8. Empty response → clarify with the canned "Tell me what you'd like on the shirt."
9. Code-fenced JSON is unwrapped (reuse the fence-stripping behavior).
10. `referenceImage` absent on an edit → `null`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/design-brief.test.ts`
Expected: FAIL — `constructDesignBrief` not exported.

- [ ] **Step 3: Implement in `src/lib/ai.ts`**

Add the new system prompt const and function (alongside the old ones — additive):

```typescript
const DESIGN_BRIEF_SYSTEM_PROMPT = `You are a t-shirt design assistant for PRNTD. Translate the user's conversation into a structured design brief.

Respond with raw JSON only (no markdown, no code fences):
{
  "message": "Brief factual acknowledgment shown to the user (plain, no exclamation points)",
  "operation": "generate" | "edit" | "clarify",
  "spec": { ... },                 // required when operation is "generate"
  "editInstruction": "...",        // required when operation is "edit"
  "referenceImage": null or number // edit only: the # of the design being refined
}

Choosing the operation:
- "generate": the user wants a new design, or a different take on the idea (new subject, changed style, another version of the same concept).
- "edit": the user is refining an existing design — changing, adding, removing, or adjusting parts while keeping the rest ("make the bear larger", "remove the lettering", "different font"). The referenced image is sent to an instruction-edit model together with your editInstruction.
- "clarify": the subject is too vague to draw anything; put the single question in "message". Only a missing subject warrants clarify — if style is unstated, pick one that suits the subject and say which you chose in "message".

The spec (operation "generate"):
{
  "subject": "One or two sentences describing the whole design.",
  "style": {
    "aesthetics": "mood, vibe, texture cues",
    "artStyle": "e.g. woodcut illustration, sumi-e brush painting",
    "medium": "e.g. screen print, pen and ink",
    "lighting": "only when it matters",
    "colorPalette": ["#RRGGBB"]    // only when the user expressed color intent; soft bias, not a lock
  },
  "elements": [
    { "type": "obj", "desc": "a concrete visual element" },
    { "type": "text", "text": "LITERAL TEXT TO RENDER", "desc": "typography style and placement notes" }
  ]
}
"subject" and at least one element are required — never emit a spec without a concrete subject.

Print specifications (physics, not taste):
- DTG printing, 12" x 16" print area.
- The design is generated on a transparent background automatically — never mention backgrounds in any field.
- Favor open, breathable compositions — avoid dense block prints (ink coverage matters for DTG).
- Flat graphic / artwork only — NEVER a picture of a t-shirt. Never the words "t-shirt", "shirt", or "mockup" in any field.

Style — be faithful to the user's intent:
- DO NOT default to clean / vector / digital illustration unless asked.
- Hand-painted, brushy, distressed, vintage, zine etc.: write concrete texture cues into "artStyle"/"aesthetics" and element descs ("sumi-e brush strokes, uneven ink pressure, ink pooling at stroke ends", "halftone screen-print, deliberate ink gaps, slight registration offset").
- If the user is silent on style, pick one that suits the subject and say which you chose in "message" — do not stop to ask.
- Never override the user's stated style because you think a different style would print better; if a style genuinely conflicts with print constraints, explain in "message".

Affirmative-only fields:
- There is no negative-prompt channel. Every spec field describes only what SHOULD appear. Translate negations into positive targets ("mouth closed, calm expression" not "no tongue"; "solid filled bold block lettering" not "no bubble letters"; "open composition, clear focal point, generous negative space" not "less busy").
- To push away from a default the model likes, state the desired quality concretely in "aesthetics" ("raw bristle texture, uneven ink pressure" rather than "not smooth").

Text in designs:
- Put literal text in a text element's "text" field exactly as it should render; typography intent goes in that element's "desc" and must match the user's style intent.
- If the user wants no text, emit no text elements and never mention text anywhere.

Edits (operation "edit"):
- editInstruction states what should change and what must stay ("make the bear larger; keep the lettering, colors, and composition unchanged"). Do not re-describe the whole design.
- The edit model handles removal instructions directly: "remove the lettering under the figure" is correct here.
- Set "referenceImage" to the # of the design being refined (from the gallery context); null if the user didn't say — the latest design is assumed.`;
```

Then the function — mirror `constructFluxPrompt`'s body shape (same `buildMessages` call, same model, same fence-stripping), with this parse logic:

```typescript
export async function constructDesignBrief(
  chatHistory: ChatMessage[],
  images: DesignImage[],
  userMessage?: string
): Promise<DesignBrief> {
  const { messages, galleryContext } = buildMessages(chatHistory, images, userMessage);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: DESIGN_BRIEF_SYSTEM_PROMPT + galleryContext,
    messages,
  });

  let text = response.content?.[0]?.type === "text" ? response.content[0].text : "";
  if (!text) {
    console.error("constructDesignBrief: empty response from Claude");
    return { operation: "clarify", message: "Tell me what you'd like on the shirt." };
  }
  text = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Prose means Claude answered in chat, not with a brief (#137): surface
    // it and render nothing.
    return { operation: "clarify", message: text };
  }

  const message =
    typeof parsed.message === "string" && parsed.message.trim()
      ? parsed.message.trim()
      : "Tell me what you'd like on the shirt.";

  if (parsed.operation === "generate") {
    const spec = parseDesignSpec(parsed.spec);
    if (!spec) {
      console.error("constructDesignBrief: generate with invalid spec, downgrading to clarify");
      return { operation: "clarify", message };
    }
    return { operation: "generate", message, spec };
  }

  if (parsed.operation === "edit") {
    const editInstruction =
      typeof parsed.editInstruction === "string" && parsed.editInstruction.trim()
        ? parsed.editInstruction.trim()
        : null;
    if (!editInstruction) {
      console.error("constructDesignBrief: edit with empty instruction, downgrading to clarify");
      return { operation: "clarify", message };
    }
    const referenceImage =
      typeof parsed.referenceImage === "number" ? parsed.referenceImage : null;
    return { operation: "edit", message, editInstruction, referenceImage };
  }

  return { operation: "clarify", message };
}
```

Add the `DesignBrief` type export and the `parseDesignSpec`/`DesignSpec` imports from `./design-spec`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/__tests__/design-brief.test.ts src/lib/__tests__/ai.test.ts`
Expected: PASS (old suite untouched).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai.ts src/lib/__tests__/design-brief.test.ts
git commit -m "feat: constructDesignBrief — typed clarify/generate/edit envelope with DesignSpec"
```

---

### Task 4: Cutover — typed operations end to end, delete the legacy path

**Files:**
- Modify: `src/lib/generators/types.ts`, `src/lib/generators/ideogram-generator.ts`, `src/app/design/actions.ts`, `src/lib/ai.ts` (deletions), `src/lib/design-prompt.ts` (deletions), `src/lib/ideogram.ts` (delete v3 `generateTransparent` — grep first), `src/lib/__tests__/ai.test.ts` (delete the `constructFluxPrompt` describe), `src/lib/__tests__/design-prompt.test.ts` (delete tests of deleted guards)
- Modify (mocks): `src/app/design/__tests__/generation-races.integration.test.ts`, `fresh-start-seed.integration.test.ts`, `conversation-close.integration.test.ts`, `set-primary-image.integration.test.ts`, `src/app/designs/__tests__/delete-design.integration.test.ts`, `src/lib/generators/__tests__/ideogram-generator.test.ts`

**Interfaces:**
- Consumes: everything Tasks 1-3 produced.
- Produces (final shape for later slices):

```typescript
// types.ts
export type GenerateOperation =
  | { kind: "generate"; spec: DesignSpec }
  | { kind: "edit"; instruction: string; anchorImageUrl: string };
export type GenerateOptions = { aspect: AspectRatio };
export interface ImageGenerator {
  id: GeneratorId;
  label: string;
  costFor(op: GenerateOperation): number;
  generate(op: GenerateOperation, opts: GenerateOptions): Promise<string>;
}
```

(`adaptPrompt`, `referenceImageUrl`, `negativePrompt` are deleted from the interface.)

- [ ] **Step 1: Rewrite the adapter test first (failing)**

`src/lib/generators/__tests__/ideogram-generator.test.ts`: mock `../../ideogram` exposing `generateTransparentV4`, `editTransparent`, `EDIT_COST_PER_IMAGE: 0.2`, `GENERATE_COST_PER_IMAGE: 0.03`. Cases:
- `{kind:"generate", spec}` → `generateTransparentV4` called with the RENDERED wire prompt: `high_level_description === spec.subject`, `style_description.art_style === spec.style.artStyle`, `color_palette` carried, `compositional_deconstruction.background === "transparent background"`, elements mapped 1:1 (obj desc / text text+desc); `editTransparent` NOT called.
- `{kind:"edit", instruction, anchorImageUrl}` → `editTransparent(instruction, anchorImageUrl, aspect)`; v4 NOT called.
- `costFor` → 0.03 for a generate op, 0.2 for an edit op.

- [ ] **Step 2: Rewrite the adapter**

`ideogram-generator.ts`: add module-private `toV4JsonPrompt(spec: DesignSpec): V4JsonPrompt` mapping camelCase→snake_case (`artStyle`→`art_style`, `colorPalette`→`color_palette`; omit an empty style_description; `background: "transparent background"` — the endpoint replaces it server-side but the field is required). Adapter:

```typescript
export const ideogramGenerator: ImageGenerator = {
  id: "ideogram",
  label: "Ideogram",
  costFor: (op) => (op.kind === "edit" ? EDIT_COST_PER_IMAGE : GENERATE_COST_PER_IMAGE),
  generate: (op, { aspect }) =>
    op.kind === "edit"
      ? editTransparent(op.instruction, op.anchorImageUrl, aspect)
      : generateTransparentV4(toV4JsonPrompt(op.spec), aspect),
};
```

Update `types.ts` per the Interfaces block above (import `DesignSpec` from `../design-spec`).

- [ ] **Step 3: Rewire `generateDesign` in `src/app/design/actions.ts`**

Replace the `constructFluxPrompt` → `isClarificationOnly` → anchor-resolution → `generator.generate(string, …)` region (~lines 214-250) with:

```typescript
  let brief;
  try {
    brief = await constructDesignBrief(messagesForPrompt, images, userMessage);
  } catch (err) {
    console.error("constructDesignBrief failed:", err);
    throw new Error("Failed to construct prompt");
  }

  if (brief.operation === "clarify") {
    await persistClarification(designId, userMessage, brief.message);
    return {
      message: brief.message,
      imageUrl: null,
      imageId: null,
      generationNumber: found.generationCount,
      readyToGenerate: false,
    };
  }

  const generator = getGenerator(found.activeGeneratorId);

  let generateOp: GenerateOperation;
  if (brief.operation === "edit") {
    const referenced =
      brief.referenceImage != null
        ? images.find((img) => img.number === brief.referenceImage)?.url
        : undefined;
    // No explicit reference → the latest output is what "make it larger" means.
    const outputs = images.filter((img) => img.role !== "seed");
    const anchorImageUrl = referenced ?? outputs[outputs.length - 1]?.url;
    if (!anchorImageUrl) {
      // An edit classified on an imageless thread is a model error; there is
      // nothing to edit, so ask instead of rendering.
      const message = "There's no design to edit yet — tell me what you'd like on the shirt.";
      await persistClarification(designId, userMessage, message);
      return {
        message,
        imageUrl: null,
        imageId: null,
        generationNumber: found.generationCount,
        readyToGenerate: false,
      };
    }
    generateOp = { kind: "edit", instruction: brief.editInstruction, anchorImageUrl };
  } else {
    generateOp = { kind: "generate", spec: brief.spec };
  }

  const generationCost = generator.costFor(generateOp);

  let imageUrl: string;
  try {
    imageUrl = await generator.generate(generateOp, { aspect: "1:1" });
  } catch (err) {
    console.error("generateDesign image generation failed:", err);
    throw new Error("Image generation failed");
  }

  const storedPrompt =
    brief.operation === "edit" ? brief.editInstruction : renderSpecSummary(brief.spec);
```

Then in the `db.batch` block, `prompt: aiResponse.fluxPrompt` → `prompt: storedPrompt`, and every remaining `aiResponse.message` → `brief.message`. Imports: `constructDesignBrief` replaces `constructFluxPrompt`; add `renderSpecSummary` from `@/lib/design-spec`, `GenerateOperation` from `@/lib/generators/types`; remove the now-unused `isClarificationOnly` import. The existing `outputs`/`parentImageId` logic further down stays exactly as is (parent remains the latest output, matching slice-1 behavior — anchor and parent can differ; that is pre-existing and out of scope).

- [ ] **Step 4: Delete the legacy path**

- `src/lib/ai.ts`: delete `constructFluxPrompt` and `GENERATE_SYSTEM_PROMPT`.
- `src/lib/design-prompt.ts`: `grep -rn "isClarificationOnly\|isSubjectlessPrompt" src e2e` — expect the only remaining hits to be `design-prompt.ts` itself and its test; then delete both functions, `STYLE_ONLY_TERMS`, and their tests in `design-prompt.test.ts` (keep `isGenerateIntent` + its tests untouched).
- `src/lib/ideogram.ts`: `grep -rn "generateTransparent\b" src scripts e2e --include="*.ts"` — if the v3 `generateTransparent`'s only `src/` caller was the adapter (expected), delete it (keep `toIdeogramAspect` — both v4 and edit use it). If a `scripts/` file imports it, leave a one-line note in your report (scripts are excluded from lint/tsconfig; do not fix scripts).
- `src/lib/__tests__/ai.test.ts`: delete the `constructFluxPrompt` describe block (~lines 673-830).

- [ ] **Step 5: Update the five integration-test mocks**

In `generation-races`, `fresh-start-seed`, `conversation-close`, `set-primary-image` (all `src/app/design/__tests__/`) and `delete-design` (`src/app/designs/__tests__/`): the `vi.mock("@/lib/ai", …)` blocks replace `constructFluxPrompt` with

```typescript
  constructDesignBrief: vi.fn(async () => ({
    operation: "generate",
    message: "Here it is",
    spec: { subject: "a happy cat", elements: [{ type: "obj", desc: "a happy cat" }] },
  })),
```

and any mocked registry generator gains the new signature: `generate: vi.fn(async () => "https://src/ideogram.png")` keeps working (args ignored), but `costFor: () => 0.03` must stay and `adaptPrompt` mocks must be dropped if present. Fix whatever the test run then surfaces — these files assert on stored prompts/messages in places; align assertions with `renderSpecSummary` output ("a happy cat") rather than weakening them.

- [ ] **Step 6: Run the affected suites, then the full gates**

```bash
npx vitest run src/lib/generators/__tests__ src/lib/__tests__/ai.test.ts src/lib/__tests__/design-prompt.test.ts src/lib/__tests__/design-brief.test.ts src/app/design/__tests__ src/app/designs/__tests__
npm run typecheck && npm run lint
npm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: DesignSpec cutover — v4 json_prompt generates, typed operations, legacy prompt path deleted"
```

---

### Task 5: Full gates + spec status note

**Files:**
- Modify: `docs/async-generation-and-edit-plan.md`

- [ ] **Step 1: Run every gate**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

(For `npm run build` in this worktree, if it fails on missing env, reuse the inline-placeholder-env approach recorded in `.superpowers/sdd/2026-08-29-edit-as-operation/task-5-report.md` — nothing written to disk.)

- [ ] **Step 2: Append the status note**

Under "Slice 2 — DesignSpec, and the v4 upgrade" in `docs/async-generation-and-edit-plan.md`, add:

```
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-29-design-spec.md docs/async-generation-and-edit-plan.md
git commit -m "docs: slice 2 status note"
```
