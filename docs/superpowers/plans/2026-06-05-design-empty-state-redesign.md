# /design Empty-State Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open `/design` as a single centered composer ("What shall we draw together?") and reveal the two-column working machinery (chat + Generations + Generate/Compare) only once there's content.

**Architecture:** A pure predicate derives "empty vs working" from data `page.tsx` already loads (`messages`, `images`) — no new persisted flag. `page.tsx` branches: empty → centered ChatPanel only (no Generations column); working → existing unchanged two-column layout. ChatPanel renders a centered composer (heading, subphrase, input, Send) in empty mode, with example chips revealed after 4s of inactivity. Generating copy switches from rotating filler to a plain "Drawing your design…".

**Tech Stack:** Next.js 16 App Router (client component), React, Tailwind, Vitest.

Spec: `docs/superpowers/specs/2026-06-05-design-empty-state-redesign.md`

---

## File Structure

- `src/lib/design-view.ts` (create) — pure `isDesignEmpty(messageCount, imageCount)` predicate. One responsibility: the empty-vs-working decision.
- `src/lib/__tests__/design-view.test.ts` (create) — unit tests for the predicate.
- `src/app/design/page.tsx` (modify) — branch on the predicate; render Generations column only in working mode; page title swaps to "Start designing" when empty.
- `src/app/design/chat-panel.tsx` (modify) — accept `isEmpty` prop; centered composer in empty mode; 4s "Need a suggestion?" reveal; replace rotating generating filler with "Drawing your design…".
- `src/app/design/image-gallery.tsx` (modify) — generating tile copy → "Drawing your design…".

---

## Task 1: Empty-vs-working predicate

**Files:**
- Create: `src/lib/design-view.ts`
- Test: `src/lib/__tests__/design-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isDesignEmpty } from "@/lib/design-view";

describe("isDesignEmpty", () => {
  it("is empty with zero messages and zero images", () => {
    expect(isDesignEmpty(0, 0)).toBe(true);
  });

  it("is not empty once there is a chat message", () => {
    expect(isDesignEmpty(1, 0)).toBe(false);
  });

  it("is not empty once there is an image (e.g. R2-recovered design)", () => {
    expect(isDesignEmpty(0, 1)).toBe(false);
  });

  it("is not empty with both messages and images", () => {
    expect(isDesignEmpty(3, 2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/design-view.test.ts`
Expected: FAIL — cannot resolve `@/lib/design-view` / `isDesignEmpty is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/design-view.ts

/**
 * The /design page opens as a centered composer (empty state) and only
 * reveals the two-column working layout once there is content. The split is
 * a pure function of data already loaded on the page — no persisted flag.
 */
export function isDesignEmpty(messageCount: number, imageCount: number): boolean {
  return messageCount === 0 && imageCount === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/design-view.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/design-view.ts src/lib/__tests__/design-view.test.ts
git commit -m "feat: add isDesignEmpty predicate for /design empty state"
```

---

## Task 2: page.tsx branches empty vs working

**Files:**
- Modify: `src/app/design/page.tsx`

This task wires the predicate into the page: pass `isEmpty` to ChatPanel, render the Generations column only when not empty, and swap the page title. ChatPanel still renders normally for now (centered composer comes in Task 3); the visible change here is the Generations column disappearing on a fresh `/design` and the title reading "Start designing".

- [ ] **Step 1: Import the predicate**

In `src/app/design/page.tsx`, add to the imports near the other `@/lib` imports (after the `breadcrumbTrail` import on line 26):

```tsx
import { isDesignEmpty } from "@/lib/design-view";
```

- [ ] **Step 2: Derive `empty` in the component body**

In `DesignPageInner`, just before the `return (` on line 272, add:

```tsx
  const empty = isDesignEmpty(messages.length, images.length);
```

- [ ] **Step 3: Swap the page title when empty**

Replace the `<h1>` on line 281:

```tsx
          <h1 className="text-lg font-semibold mt-1">Design something</h1>
```

with:

```tsx
          <h1 className="text-lg font-semibold mt-1">
            {empty ? "Start designing" : "Design something"}
          </h1>
```

- [ ] **Step 4: Pass `isEmpty` to ChatPanel and gate the Generations column**

Replace the two-column body block (lines 285–308, from `{/* Two-column body */}` through the closing `</div>` of that flex row) with:

```tsx
      {/* Body — centered composer when empty, two-column working layout otherwise */}
      <div className="flex-1 flex overflow-hidden">
        <ChatPanel
          messages={messages}
          images={images}
          loading={loading}
          generating={generating}
          onSend={handleSend}
          onGenerate={handleGenerate}
          onCompare={handleCompare}
          activeGenerator={activeGenerator}
          readyToGenerate={readyToGenerate}
          onUploadImage={handleUploadImage}
          isEmpty={empty}
        />
        {!empty && (
          <ImageGallery
            images={images}
            productGroups={productGroups}
            selectedImage={selectedImage}
            generating={generating}
            onClickImage={(i) => setLightboxIndex(i)}
            onMakeProducts={handleMakeProducts}
            onSelectProductVersion={handleSelectProductVersion}
          />
        )}
      </div>
```

Note: the mobile drawer toggle (lines 311–318) is already gated on `images.length > 0`, and the drawer / lightbox / publish modal all no-op when there are no images — leave them as-is.

- [ ] **Step 5: Add the `isEmpty` prop to ChatPanel's signature (temporary, unused)**

So the build type-checks before Task 3 styles it. In `src/app/design/chat-panel.tsx`, add `isEmpty` to both the destructured params and the props type. In the destructure (after `onUploadImage,` on line 59):

```tsx
  onUploadImage,
  isEmpty,
```

In the props type (after the `onUploadImage: ...` line, line 70):

```tsx
  onUploadImage: (base64: string, fileName: string) => void;
  isEmpty: boolean;
```

- [ ] **Step 6: Verify it builds and lint is clean**

Run: `npm run lint && npm run build`
Expected: lint 0 errors (the unused `isEmpty` will trip `@typescript-eslint/no-unused-vars` — if it errors, prefix-rename is wrong; instead leave it and proceed straight to Task 3 in the same commit). If lint flags `isEmpty` as unused, **skip committing here** and continue to Task 3, which uses it; commit at the end of Task 3.

- [ ] **Step 7: Manual smoke**

Ask the user to run the dev server (they run it themselves). On a fresh `/design` (no `?id`): the Generations column should be gone and the title should read "Start designing". On a resumed design with images (`/design?id=<existing>`): two-column layout intact, title "Design something".

---

## Task 3: Centered empty-state composer in ChatPanel

**Files:**
- Modify: `src/app/design/chat-panel.tsx`

Render a vertically+horizontally centered composer (heading, subphrase, input, Send) when `isEmpty` is true, with example chips revealed after 4s of inactivity. The existing normal column renders unchanged when `isEmpty` is false.

- [ ] **Step 1: Add suggestion-reveal state and effect**

In `ChatPanel`, after the existing `const [input, setInput] = useState("");` (line 76), add:

```tsx
  const [showSuggestions, setShowSuggestions] = useState(false);
  const engagedRef = useRef(false);
```

Then, after the auto-focus effect (ends line 123), add the 4s reveal effect:

```tsx
  // Empty state: after 4s of inactivity (input untouched), quietly reveal
  // example chips. The moment the user types, drop them — and don't re-arm
  // once they've engaged.
  useEffect(() => {
    if (!isEmpty) return;
    if (input.length > 0) {
      engagedRef.current = true;
      setShowSuggestions(false);
      return;
    }
    if (engagedRef.current) return;
    const t = setTimeout(() => setShowSuggestions(true), 4000);
    return () => clearTimeout(t);
  }, [isEmpty, input]);
```

- [ ] **Step 2: Render the centered composer when `isEmpty`**

In `ChatPanel`, immediately before the existing `return (` of the normal layout (the `<div className="flex-1 flex flex-col min-w-0 relative"` block, line 156), add an early return for the empty state:

```tsx
  if (isEmpty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-w-0 px-6 text-center">
        <h2 className="text-2xl sm:text-3xl font-semibold text-foreground">
          What shall we draw together?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Describe it in plain words. Refine as we go.
        </p>
        <form
          onSubmit={handleSend}
          className="mt-6 w-full max-w-xl flex gap-2"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your design..."
            className="flex-1 px-3 py-2 bg-surface border border-border rounded-md text-white placeholder:text-gray-500 focus:border-border-hover focus:outline-none"
            disabled={loading}
          />
          <Button type="submit" variant="primary" disabled={loading || !input.trim()}>
            Send
          </Button>
        </form>
        {showSuggestions && (
          <div className="mt-6 space-y-2">
            <p className="text-xs text-text-faint">Need a suggestion?</p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.slice(0, 3).map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setInput(example)}
                  className="text-xs px-3 py-1.5 border border-border rounded-full text-text-muted hover:text-foreground hover:border-border-hover transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
```

This reuses the existing `handleSend` (line 127). In the empty state `messages.length === 0`, so the `GENERATE_TRIGGERS` branch inside `handleSend` (guarded by `messages.length > 0`) never fires — submit always routes to `onSend` (chat message), matching the chat-first spec. The upload button and drag-drop overlay are intentionally omitted from the empty composer.

- [ ] **Step 3: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: 0 lint errors, build succeeds. `isEmpty` is now used, so the unused-var concern from Task 2 is resolved.

- [ ] **Step 4: Manual smoke**

On a fresh `/design`: page shows only the centered "What shall we draw together?" composer (no Generations column, no Generate/Compare). Wait ~4s without typing → "Need a suggestion?" + 3 chips fade in. Click a chip → it fills the input and the suggestions disappear. Type a message and Send → transitions to the two-column working layout (chat + Generations), where Generate/Compare appear behind the existing readiness gate.

- [ ] **Step 5: Commit (covers Task 2 + Task 3)**

```bash
git add src/app/design/page.tsx src/app/design/chat-panel.tsx
git commit -m "feat: centered empty-state composer on /design with delayed suggestions"
```

---

## Task 4: "Drawing your design…" generating copy

**Files:**
- Modify: `src/app/design/chat-panel.tsx`
- Modify: `src/app/design/image-gallery.tsx`

Replace the rotating filler in the chat generating indicator and the gallery generating tile with a plain status.

- [ ] **Step 1: Replace the chat generating indicator**

In `src/app/design/chat-panel.tsx`, replace the generating block (lines 244–250):

```tsx
        {generating && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 text-text-muted animate-pulse">
              {generatingMsg}
            </div>
          </div>
        )}
```

with:

```tsx
        {generating && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2 text-text-muted animate-pulse">
              Drawing your design…
            </div>
          </div>
        )}
```

- [ ] **Step 2: Remove the now-dead rotating-message machinery**

`generatingMsg` is no longer referenced. Delete:
- the `GENERATING_MESSAGES` const array (lines 9–20),
- the `useRotatingMessage` function (lines 22–40),
- the `const generatingMsg = useRotatingMessage(...)` line (line 82),
- and remove `generatingMsg` from the scroll-effect dependency array (line 118), so it reads:

```tsx
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, generating]);
```

- [ ] **Step 3: Update the gallery generating tile**

In `src/app/design/image-gallery.tsx`, replace the generating tile text (lines 94–100). Change:

```tsx
            {generating && (
              <div className="aspect-square rounded-lg border-2 border-border flex items-center justify-center bg-surface">
                <div className="text-[10px] text-text-faint animate-pulse text-center px-2">
                  Painting...
                </div>
              </div>
            )}
```

to:

```tsx
            {generating && (
              <div className="aspect-square rounded-lg border-2 border-border flex items-center justify-center bg-surface">
                <div className="text-[10px] text-text-faint animate-pulse text-center px-2">
                  Drawing your design…
                </div>
              </div>
            )}
```

- [ ] **Step 4: Verify build + lint + tests**

Run: `npm run lint && npm test && npm run build`
Expected: 0 lint errors (no unused `GENERATING_MESSAGES`/`useRotatingMessage`/`useMemo` if `useMemo` is now unused — check the import on line 3 and drop `useMemo` from it if nothing else uses it), all tests pass, build succeeds.

Note: `useMemo` is still used by `urlByImageId` (line 72), so keep it in the import. Only `generatingMsg`'s `useMemo` usage was internal to `useRotatingMessage`.

- [ ] **Step 5: Manual smoke**

Trigger Generate on a working design → chat shows "Drawing your design…" and the gallery placeholder tile shows "Drawing your design…" while rendering; a real image replaces it on completion.

- [ ] **Step 6: Commit**

```bash
git add src/app/design/chat-panel.tsx src/app/design/image-gallery.tsx
git commit -m "feat: plain 'Drawing your design…' generating copy on /design"
```

---

## Self-Review Notes

**Spec coverage:**
- Empty state shows only chrome + centered composer → Task 2 (gate Generations column, title) + Task 3 (centered composer).
- Hero "What shall we draw together?" + subphrase + input + Send → Task 3.
- No Generations column / no Generate/Compare in empty state → Task 2 (column) + Task 3 (early return omits Generate/Compare).
- 4s delayed "Need a suggestion?" chips, hide on type, no re-arm → Task 3.
- Submit = chat message (`sendChatMessage` via `onSend`), first message → working view → Task 3 (reuses `handleSend`; `empty` flips false once a message lands → page re-renders two-column).
- Generating copy "Drawing your design…" (chat + gallery), keep "Thinking…" → Task 4 (chat "Thinking…" indicator on line 237 left untouched).
- Empty-vs-working = pure predicate, unit-tested → Task 1.

**Out of scope (untouched):** working two-column layout, readiness gate, `assessReadiness`. Mobile reflow handled by `flex items-center justify-center` + `max-w-xl` collapsing on phones.

**Branch:** continue on `main`? No — open a feature branch `feat/design-empty-state` before Task 1 (branch protection requires a PR to merge to main).
