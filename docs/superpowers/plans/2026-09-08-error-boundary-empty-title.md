# Error boundary + empty titles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a Paper-look React error boundary (there is none anywhere under `src/app`, so a transient Turso blip is a bare Next 500), and stop an owner from saving a blank image title that renders as an empty `<h1>` for every viewer.

**Architecture:** Two unrelated robustness leftovers in one branch, no shared code. (a) `src/app/error.tsx` + `src/app/global-error.tsx`, both client components, both leaning on the Next 16.2 `unstable_retry` prop; logging is `console.error` only because `src/instrumentation.ts`'s `onRequestError` already writes the `app_error` row. (b) blank titles blocked at three layers — server action returns a structured `{ error }` (it does not throw), the inline editor disables Save on an empty trimmed draft and shows `InlineNotice` on a refusal, and every display site falls back to a literal string so rows already blank in prod stop rendering empty.

**Tech Stack:** Next.js 16.2.1 App Router, React 19.2.4, Tailwind v4, Vitest + Testing Library, Drizzle + in-memory libSQL for the real-DB test.

**Spec:** the controller brief, quoted verbatim in "Spec, verbatim" below. Supporting: `docs/ux-design-review-2026-09.md` (nav model A), `docs/design-system.md` Part 1 (persona C), `docs/superpowers/ledgers/2026-09-07-paper-image-detail-progress.md` finding F3, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`.

## Global Constraints

- **File fence — touch NOTHING outside this list.** Two sibling SDD controllers are working in parallel worktrees on `src/app/studio/**`, `src/components/product-options.tsx`, `src/app/orders/**`, `src/app/admin/published/**` and `docs/design-system.md`. Do not touch those.
  - `src/app/error.tsx` (new)
  - `src/app/global-error.tsx` (new)
  - `src/app/__tests__/**` — NEW test files only; do not edit the existing five
  - `src/app/d/[imageId]/**` (incl. its `__tests__`)
  - `src/app/designs/actions.ts` and `src/app/designs/__tests__/**` (this is where `updatePublishedNaming` lives)
  - `src/lib/action-copy.ts` — to ADD a constant only; do not edit or reorder existing constants
  - `docs/superpowers/**`
- **This is NOT the Next.js you know** (`AGENTS.md`). Copy App Router call shapes from working code in this repo or from `node_modules/next/dist/docs/`, never from memory.
- **Migration-free.** If a step appears to need a schema change, STOP and report BLOCKED.
- **Paper rules** (decided by Nico; do not re-litigate). Light only. Tokens: ground `--background`, ink `--foreground`, `--text-muted`, `--text-faint`, hairline `--border`, `--border-hover`, `--surface`, `--surface-well`, `--accent-rose`. Tailwind: `bg-background`, `text-foreground`, `border-border`, `text-text-muted`, `text-text-faint`, `bg-surface`, `bg-surface-well`, `font-mono`.
  - 1px ink/hairline borders. **No shadows.** No dark literals anywhere (`bg-black`, `text-white`, `bg-gray-*`, `bg-foreground/70`, hex darks) — a guard test forbids some of them already.
  - `--accent-rose` is used ONLY on the wordmark and the Studio-composer/landing Generate. **Never on these pages.**
  - Mono label class, used verbatim everywhere this plan says "mono label":
    `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`
  - Body 14px (`text-sm`). Titles 14px/500 (`text-sm font-medium`). Links underlined: `underline underline-offset-[3px]`.
  - ONE primary action per screen: `Button` default `variant="primary"` (outlined ink). Everything else is `variant="secondary"`, `variant="ghost"`, or plain underlined text.
  - `disabled` already renders as a dotted border + muted text in the primitive. Do not add opacity hacks.
  - 44px minimum tap targets on phone (`min-h-11` / `w-11 h-11`). Check every layout at 390px.
  - AA contrast holds. `--text-faint` (#6f6d6a, 4.74:1 on the ground) is fine on `--background` and on `--surface-well`; do not put it on a coloured storefront backdrop.
- **No price** may appear in this plan, in code, or in copy unless garment AND size are already picked. Never write `From $X`. `src/lib/__tests__/no-preselection-price.test.ts` fails CI on it, comments included.
- Copy is persona C: plain, literal, no marketing sentence, no exclamation mark, no whimsy. Reuse existing strings; new copy is one short literal sentence and gets recorded in the ledger.
- Lint policy (`CLAUDE.md` → Tooling & CI): `@typescript-eslint/no-explicit-any` is an **error** in product code, off in tests. `catch (err)` unannotated, narrowed with `err instanceof Error ? err.message : String(err)`.
- Path alias `@` maps to `src/`. Single test file: `npx vitest run <path>`. Whole suite: `npm test`. Never run Playwright e2e locally.
- Never read `.env.local`, `.env`, or any secret material. Never run `op run`.
- Every commit message ends with exactly these two trailer lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
  ```

---

## Spec, verbatim (controller brief)

> ### Slice `error-boundary-empty-title` (controller 3)
>
> Two robustness leftovers, unrelated to each other, both small:
>
> a. **Error boundary.** There is NO `error.tsx` anywhere under `src/app` (verified: `find src/app -name error.tsx` is empty) — a transient Turso blip on any server-rendered page is a bare Next 500. Add `src/app/error.tsx` (client component, Paper look, persona C copy: one literal line such as "Something went wrong loading this page." plus a `Button` "Try again" that calls `reset()` and an underlined "Go to Studio" link — check `docs/ux-design-review-2026-09.md` for nav model A before choosing the link target; the home `/` is the safe default for guests). Consider also `src/app/global-error.tsx` (root-layout failures; it must render its own `<html>`/`<body>`) — read `node_modules/next/dist/docs/` on `error.js` conventions for Next 16 first and follow it exactly. Log the error via `console.error` only (the `instrumentation.ts` `onRequestError` hook already captures server errors into `app_error`; do not duplicate that write). Render the `digest` as small mono text when present so an admin can match it to `/admin/errors`. Unit-test with Testing Library: renders copy, `reset` called on click, digest shown/hidden.
>
> b. **Empty titles.** `updatePublishedNaming` (find it: `grep -rn "updatePublishedNaming" src`) persists `title.trim()` with no non-empty check, so an owner can save `""` and the image detail page renders an empty `<h1>` and a blank labelled TITLE row for every viewer (finding F3 in `docs/superpowers/ledgers/2026-09-07-paper-image-detail-progress.md` line ~55). Fix at THREE layers: (1) the server action rejects a blank title with a structured `{error}` return (find how sibling actions in that file return errors and match it; do not throw), (2) `EditableNaming` (`src/app/d/[imageId]/editable-naming.tsx`) disables Save while the trimmed draft is empty and shows the existing inline-notice pattern (`InlineNotice`, see PR #218) on a rejected save, (3) the display falls back to `title?.trim() || "Untitled"` wherever the h1/TITLE row reads it (`identity-block.tsx`, `editable-naming.tsx`). Extend the existing tests in `src/app/d/[imageId]/__tests__/` and add a real-DB test for the action if a sibling action already has one (look for `*.integration.test.ts` under that actions file's `__tests__`).

---

## Controller rulings (binding — these resolve the spec's ambiguities)

### R1. The retry control calls `unstable_retry`, falling back to `reset`

The spec says "`Button` 'Try again' that calls `reset()`". Next 16.2 changed this. `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` says under `#### reset`: *"In most cases, you should use `unstable_retry()` instead"*, because `reset()` only clears the boundary's error state and re-renders WITHOUT re-fetching, while `unstable_retry()` re-fetches and re-renders the segment. Version history: `unstable_retry` added in `v16.2.0`; this repo is on `next@16.2.1`.

The whole point of this boundary is a **transient Turso blip**. `reset()` alone would re-render the same already-failed server payload and land the user right back on the error page — a Try again button that cannot work is worse than no button. So the handler is:

```tsx
onClick={() => (unstable_retry ?? reset)()}
```

Both props are passed by Next today. The `??` is there because `unstable_retry` carries an `unstable_` prefix and may be renamed in a minor; without the guard that rename turns the click into `undefined is not a function`. Both props are typed optional in our component signature for the same reason, and the tests exercise both paths.

Cost if wrong: Try again re-renders the stale failed payload instead of re-fetching, i.e. the button appears to do nothing. Cheap to reverse (one expression), but invisible until a user hits a real outage — which is exactly the moment it matters.

### R2. The secondary link goes to `/`, and reads "Go to the home page"

The spec offers "Go to Studio" but then says "the home `/` is the safe default for guests". `docs/ux-design-review-2026-09.md` nav model A is Studio · Shop · account menu, and `/studio` sits behind sign-in (`requireRealUser`); PR #219's ruling W1 already established that pointing a guest-reachable CTA at `/studio` puts a sign-in wall in front of them. An error page is reachable by anyone, including a signed-out visitor whose `/shop` render blipped.

So: `/`. Copy is "Go to the home page" — literal, persona C, no arrow, no "Take me". Underlined text link, not a second button (one primary per screen).

Note the root layout still renders around `error.tsx` (per the Next docs, `error.js` "does not wrap the `layout.js` ... above it in the same segment"), so `SiteHeader` with the full nav is already on screen. The link is the backstop for the case where the reader does not see the header as navigation.

Cost if wrong: a signed-in user takes one extra tap to get to Studio. Trivial.

### R3. `global-error.tsx` ships, and imports `./globals.css`

The spec says "consider also". Build it: without it, a root-layout failure (a throw in `layout.tsx` itself, or in `SiteHeader`'s module graph) still produces a bare Next 500 — the exact hole this slice exists to close, one segment up.

Per the Next docs, global error UI "must define its own `<html>` and `<body>` tags, global styles, fonts, or other dependencies". So it imports `./globals.css` (Next dedupes the import with the root layout's) and paints `bg-background text-foreground` explicitly on `<body>`. It cannot use `metadata`/`generateMetadata` (client component); it does not need a `<title>` — this is a crash screen, not a page, and adding React 19's `<title>` here would be one more thing to keep in sync.

The font CSS variables (`--font-geist-sans`) are set by the root layout's `<html>` className, which by definition did not render if `global-error` is showing, so the body falls back to the stack `globals.css` declares. Accepted, not fixed.

Cost if wrong: a root-layout crash shows unstyled black-on-white text instead of Paper. It is still a crash screen either way.

### R4. Logging is `console.error` in a `useEffect`, and nothing else

`src/instrumentation.ts`'s `onRequestError` hook already writes an `app_error` row for every server error, surfaced at `/admin/errors`. A second write from the client would double-count and would need a route to write through. So: one `useEffect(() => { console.error(error) }, [error])`, exactly the shape in the Next docs. Client-side render errors that never reached the server are the one class this loses — accepted; they are out of scope for a slice about Turso blips.

Cost if wrong: a purely client-side crash leaves no server-side row. It still logs to the browser console and to Vercel's client logs.

### R5. The digest renders in small mono, only when present

`error.digest` is Next's hash of the thrown error, and it is the join key between what the user sees and the `app_error` row an admin reads at `/admin/errors`. A user reporting "it broke" plus a digest is a solvable ticket. Rendered as `font-mono text-[11px] text-text-faint` — NOT the shared `MONO_LABEL` constant, because that constant uppercases, and a digest is a case-sensitive hex string. When `digest` is absent (a client-side error), the element does not render at all rather than showing an empty row.

Cost if wrong: an admin cannot match a user report to a log row.

### R6. The server action returns `{ error }` for a blank title and does not throw

The spec is explicit. `deleteDesign` in the same file is the precedent: `Promise<{ error?: string }>`, `return { error: "..." }` for a refusal the user can act on, `throw` reserved for auth/not-found. So `updatePublishedNaming`'s signature becomes `Promise<{ error?: string }>` and every existing success path returns `{}`.

Two consequences the implementer must handle:
- `published-image-view.tsx` calls this action for `backgroundColor` only and ignores the return. Widening the return type is source-compatible; do not change that call site.
- Existing tests (`src/lib/__tests__/model-b-writer-cutover.integration.test.ts`, `composition-mirror.integration.test.ts`) `await` the action and in two cases assert it REJECTS (missing mirror, unpublished image). Those are `throw` paths and stay throws — the blank-title refusal is the only new `{ error }` return. **Those files are outside this slice's fence: if a change there is required, STOP and report it rather than editing them.** (It should not be: adding a return value to a function whose result was discarded breaks nothing.)

The check is `title !== undefined && title.trim() === ""`. It fires before any DB write and before `requireMirrorProduct`, so a blank save costs zero queries.

**Only `title` is guarded, not `description`.** Descriptions were deliberately removed from the product in PR #130 ("looks like AI slop" — Nico); the columns are kept and clearing one to empty is a legitimate operation, not a defect. A guard there would block a cleanup nobody can currently perform anyway.

Cost if wrong: an owner who genuinely wants no title cannot express that; they must pick a word. Given the display falls back to "Untitled" anyway, the two states are indistinguishable to a reader, so nothing is lost.

### R7. Layer 3 (display fallback) is already done in `editable-naming.tsx` — the gap is `page.tsx`

`editable-naming.tsx:30` already reads `{title?.trim() || "Untitled"}`, and `editable-naming.test.tsx` already pins the empty-string case. That is F3's fix, landed in PR #224's fix wave. `identity-block.tsx` does not read the title at all — it passes it straight to `EditableNaming`. So there is nothing to change in either file, and the plan records that rather than inventing work.

The real remaining gap is `src/app/d/[imageId]/page.tsx`, which uses `??` in four places (`card.title ?? "A design on PRNTD"` for `og:title`/`twitter:title`, `img.title ?? "Design"` for the breadcrumb `current`, and twice for image `alt`). `??` does not catch `""`. Prod may already hold blank titles saved before this branch, so these need `||`-style fallbacks as defence in depth: an empty `og:title` gives a nameless share card, and an empty `alt` is an accessibility defect.

Sites outside the fence that read a listing title the same way (`src/lib/image-share.ts`, the Shop grid, order-line identity) are **deferred, not fixed** — they belong to other slices' files and the server-side guard now stops new blanks at the source.

Cost if wrong: an already-blank prod row keeps producing a nameless share card. Bounded and cosmetic.

### R8. The disabled Save is the primary guard; the notice is the backstop

`EditableNaming`'s Save is disabled while `titleDraft.trim() === ""`, so the refusal is normally unreachable from the UI. The `InlineNotice` path exists for the case where the client and server disagree (a stale bundle, a future caller). Both are tested. The disabled treatment comes free from the `Button` primitive (dotted border + muted text) — do not add opacity.

New copy constant, persona C, added to `src/lib/action-copy.ts` under the existing `// --- image detail page (InlineNotice: one line) ---` heading:

```ts
export const EMPTY_TITLE_REJECTED = "A title can't be blank. Type a title or cancel.";
```

Cost if wrong: one more string in the copy file.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app/error.tsx` (new) | Route-segment error boundary for everything under `src/app`. Client component. Renders inside the root layout, so the site header is present. |
| `src/app/global-error.tsx` (new) | Root-layout error boundary. Client component, own `<html>`/`<body>`, imports `./globals.css`. |
| `src/app/__tests__/error-boundary.test.tsx` (new) | Testing Library coverage for both boundaries. |
| `src/app/designs/actions.ts` (modify) | `updatePublishedNaming` gains a blank-title refusal and a `Promise<{ error?: string }>` return type. |
| `src/app/designs/__tests__/empty-title.integration.test.ts` (new) | Real in-memory libSQL test that the refusal returns `{ error }`, writes nothing, and that a real title still saves. |
| `src/lib/action-copy.ts` (modify, ADD only) | `EMPTY_TITLE_REJECTED`. |
| `src/app/d/[imageId]/editable-naming.tsx` (modify) | Save disabled on an empty trimmed draft; `InlineNotice` on a `{ error }` return. |
| `src/app/d/[imageId]/__tests__/editable-naming.test.tsx` (modify) | Extended with the disabled-Save and rejected-save cases. |
| `src/app/d/[imageId]/page.tsx` (modify) | Four `??` title fallbacks become empty-safe. |
| `src/app/d/[imageId]/__tests__/image-page-metadata.test.ts` (new) | Pins the `generateMetadata` title fallback for `""`. |

---

## Task 1: Error boundaries

**Files:**
- Create: `src/app/error.tsx`
- Create: `src/app/global-error.tsx`
- Test: `src/app/__tests__/error-boundary.test.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui` (existing, `variant="primary"` default).
- Produces: nothing other tasks depend on. Tasks 1–3 are independent.

**Background the implementer needs:**

`error.tsx` and `global-error.tsx` are Next.js App Router *file conventions*: Next imports the default export and mounts it as a React error boundary around the segment. They must start with `"use client"`. The props Next 16.2 passes are `error: Error & { digest?: string }`, `unstable_retry: () => void`, and `reset: () => void` (see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`). Read that file before writing code.

Because these are file conventions rather than ordinary components, the tests import the default export directly and render it with hand-made props — there is no Next runtime involved.

Ruling R1 governs the click handler, R2 the link, R3 the global variant, R4 the logging, R5 the digest. Read them.

- [ ] **Step 1: Write the failing test**

Create `src/app/__tests__/error-boundary.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "../error";
import GlobalError from "../global-error";

// The boundaries log the error on mount (ruling R4). Silence it so the
// suite output stays readable, and so an assertion can check it happened.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

function makeError(digest?: string) {
  const err = new Error("boom") as Error & { digest?: string };
  if (digest) err.digest = digest;
  return err;
}

describe("app error boundary", () => {
  it("states what happened in one literal line", () => {
    render(
      <ErrorBoundary
        error={makeError()}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    expect(
      screen.getByText("Something went wrong loading this page.")
    ).toBeInTheDocument();
  });

  it("logs the error once on mount and never writes it to the page", () => {
    const error = makeError();
    render(
      <ErrorBoundary error={error} unstable_retry={vi.fn()} reset={vi.fn()} />
    );
    expect(consoleError).toHaveBeenCalledWith(error);
    // The thrown message is a Next digest in production, so it is never the
    // sentence the reader gets.
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("re-fetches the segment via unstable_retry when Try again is tapped", async () => {
    const retry = vi.fn();
    const reset = vi.fn();
    render(
      <ErrorBoundary error={makeError()} unstable_retry={retry} reset={reset} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("falls back to reset if a future Next drops unstable_retry", async () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={makeError()} reset={reset} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows the digest so an admin can match it to /admin/errors", () => {
    render(
      <ErrorBoundary
        error={makeError("abc123def")}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    expect(screen.getByTestId("error-digest")).toHaveTextContent("abc123def");
  });

  it("renders no digest row when the error carries no digest", () => {
    render(
      <ErrorBoundary
        error={makeError()}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    expect(screen.queryByTestId("error-digest")).not.toBeInTheDocument();
  });

  it("offers the home page, not /studio (guests cannot reach /studio)", () => {
    render(
      <ErrorBoundary
        error={makeError()}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    const link = screen.getByRole("link", { name: "Go to the home page" });
    expect(link).toHaveAttribute("href", "/");
  });
});

describe("global error boundary", () => {
  it("states what happened and offers Try again", async () => {
    const retry = vi.fn();
    render(
      <GlobalError
        error={makeError()}
        unstable_retry={retry}
        reset={vi.fn()}
      />
    );
    expect(
      screen.getByText("Something went wrong loading this page.")
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the digest when present", () => {
    render(
      <GlobalError
        error={makeError("zz99")}
        unstable_retry={vi.fn()}
        reset={vi.fn()}
      />
    );
    expect(screen.getByTestId("global-error-digest")).toHaveTextContent("zz99");
  });
});
```

Note on the global-error tests: `GlobalError` renders `<html>`/`<body>`, which React will nest inside jsdom's existing document body. React 19 tolerates this with a console warning; the `console.error` spy above already swallows it. If jsdom rejects the render outright, do NOT weaken the component — extract the inner markup of `global-error.tsx` into a local non-exported `Body` function is NOT allowed either (it would stop testing what ships). Instead render with `{ container: document.createElement("div") }` — still the real component, just a detached mount point. Record whichever you used in the ledger.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/__tests__/error-boundary.test.tsx`
Expected: FAIL — cannot resolve `../error` / `../global-error`.

- [ ] **Step 3: Write `src/app/error.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";

/**
 * Route-segment error boundary for everything under src/app. Before this
 * file existed there was none anywhere in the tree, so a transient Turso
 * blip on any server-rendered page was a bare Next 500.
 *
 * error.js does not wrap the layout.js in its own segment, so the root
 * layout — and with it SiteHeader — still renders around this. The home
 * link is a backstop for a reader who does not read the header as
 * navigation; it points at "/" and not "/studio" because /studio is behind
 * sign-in and this screen is reachable signed out.
 *
 * Logging is console.error only: src/instrumentation.ts's onRequestError
 * already writes the app_error row that /admin/errors reads, and a second
 * write from the client would double-count it.
 */
export default function Error({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  // Both are supplied by Next 16.2. They are typed optional so that a
  // future rename of the unstable_ prop cannot turn the click handler into
  // `undefined()` at runtime — see the ?? below.
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <div className="space-y-6 border border-border p-6">
        {/* The thrown message is a digest in production, so the reader gets
            our sentence, not the server's. */}
        <p className="text-sm text-foreground">
          Something went wrong loading this page.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            onClick={() => (unstable_retry ?? reset)?.()}
            className="min-h-11"
          >
            Try again
          </Button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center text-sm text-text-muted underline underline-offset-[3px] hover:no-underline"
          >
            Go to the home page
          </Link>
        </div>
        {error.digest && (
          <p
            data-testid="error-digest"
            className="font-mono text-[11px] leading-4 text-text-faint"
          >
            {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Write `src/app/global-error.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Root-layout error boundary. Replaces the root layout when active, so it
 * has to supply its own <html>/<body> and its own styles — hence the
 * globals.css import (Next dedupes it with the root layout's).
 *
 * The font CSS variables are set on the root layout's <html>, which by
 * definition did not render if this is showing, so the body falls back to
 * the stack globals.css declares. Accepted: this is a crash screen.
 *
 * No metadata export is possible in a client component; a crash screen does
 * not need a title. Copy and behaviour mirror src/app/error.tsx.
 */
export default function GlobalError({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <main className="mx-auto w-full max-w-2xl px-4 py-16">
          <div className="space-y-6 border border-border p-6">
            <p className="text-sm text-foreground">
              Something went wrong loading this page.
            </p>
            <button
              type="button"
              onClick={() => (unstable_retry ?? reset)?.()}
              className="min-h-11 rounded-md border border-foreground bg-transparent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-well"
            >
              Try again
            </button>
            {error.digest && (
              <p
                data-testid="global-error-digest"
                className="font-mono text-[11px] leading-4 text-text-faint"
              >
                {error.digest}
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
```

Note the deliberate non-reuse of the `Button` primitive here: `global-error` stands in for a failed root layout, so it keeps its dependency graph to React + the stylesheet. The class string is `Button`'s `primary` variant + `md` size, copied. Say so in the ledger.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/__tests__/error-boundary.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Verify the guard tests still pass**

Run: `npx vitest run src/app/__tests__/globals-css.test.ts src/lib/__tests__/no-preselection-price.test.ts src/app/__tests__/no-window-alert.test.ts`
Expected: PASS. (These are repo-wide greps; the new files must not introduce a dark literal, a price string, or a `window.alert`.)

- [ ] **Step 7: Commit**

```bash
git add src/app/error.tsx src/app/global-error.tsx src/app/__tests__/error-boundary.test.tsx
git commit -m "$(cat <<'EOF'
feat: add route and global error boundaries

There was no error.tsx anywhere under src/app, so a transient Turso blip on
any server-rendered page was a bare Next 500. Both boundaries retry via Next
16.2's unstable_retry (reset alone re-renders the failed payload without
re-fetching), log with console.error only because instrumentation.ts already
writes the app_error row, and show error.digest so a report can be matched to
/admin/errors.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 2: `updatePublishedNaming` refuses a blank title

**Files:**
- Modify: `src/app/designs/actions.ts` — `updatePublishedNaming`, defined at line 290
- Modify: `src/lib/action-copy.ts` — ADD one constant
- Test: `src/app/designs/__tests__/empty-title.integration.test.ts` (new)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces, for Task 3:
  ```ts
  export async function updatePublishedNaming(
    imageId: string,
    opts: { title?: string; description?: string; backgroundColor?: string | null }
  ): Promise<{ error?: string }>
  ```
  A blank `title` returns `{ error: EMPTY_TITLE_REJECTED }` and writes nothing. Every other current path returns `{}`. Auth/not-found/unpublished/missing-mirror keep throwing exactly as they do now.
- Produces, for Task 3: `EMPTY_TITLE_REJECTED` in `@/lib/action-copy`, value
  `"A title can't be blank. Type a title or cancel."`

**Background the implementer needs:**

`src/app/designs/actions.ts` is a `"use server"` module — every export must be an async function. `deleteDesign` at line 44 is the precedent for a structured refusal: `Promise<{ error?: string }>`, `throw` for auth/not-found, `return { error }` for something the user can act on.

`src/app/designs/__tests__/publish-gate.integration.test.ts` is the pattern for testing an action in this file against a real in-memory libSQL: `createTestDb()` from `@/lib/__tests__/test-db`, factories from `@/lib/__tests__/factories`, and `vi.mock` for `@/lib/db`, `next/headers`, `next/cache`, `@/lib/auth`, `@/lib/ai`. Read it in full before writing the new file — copy its mock block rather than inventing one.

Ruling R6 governs. Note especially: **do not touch** `src/lib/__tests__/model-b-writer-cutover.integration.test.ts` or `src/lib/__tests__/composition-mirror.integration.test.ts` — they are outside this slice's fence. Widening a discarded return value must not break them; if it does, STOP and report.

- [ ] **Step 1: Write the failing test**

Create `src/app/designs/__tests__/empty-title.integration.test.ts`. The mock block is copied from `publish-gate.integration.test.ts`; read that file and match it, then add these cases:

```ts
/**
 * updatePublishedNaming's blank-title refusal. An owner could previously
 * save "" (the action persisted title.trim() with no non-empty check), which
 * rendered an empty <h1> and a blank labelled TITLE row for every viewer —
 * finding F3 of PR #224's review. Runs against a real in-memory libSQL (#28)
 * so the "writes nothing" half is checked against actual rows.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";
import { EMPTY_TITLE_REJECTED } from "@/lib/action-copy";
import * as schema from "@/lib/db/schema";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;
let currentUserId: string;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: currentUserId } }),
    },
  },
  isAnonymousUser: () => false,
}));
vi.mock("@/lib/ai", () => ({
  generatePublishedNaming: async () => ({
    title: "Auto Title",
    description: "Auto Description",
  }),
}));

const { publishImage, updatePublishedNaming } = await import(
  "@/app/designs/actions"
);

beforeEach(async () => {
  testDb = await createTestDb();
  currentUserId = "u1";
  await makeUser(testDb, "u1");
});

/** Publish an image so there is a listing + mirror product to edit. */
async function publishedImage() {
  const d = await makeDesign(testDb, "u1");
  const img = await makeSourceImage(testDb, d.id, "u1");
  await publishImage(img.id, { title: "Real Title" });
  return img.id;
}

async function mirrorTitle(imageId: string) {
  const [row] = await testDb
    .select()
    .from(schema.product)
    .where(eq(schema.product.imageId, imageId));
  return row?.title ?? null;
}

describe("updatePublishedNaming — blank titles", () => {
  it("refuses an empty title and leaves the stored title untouched", async () => {
    const imageId = await publishedImage();
    const result = await updatePublishedNaming(imageId, { title: "" });
    expect(result).toEqual({ error: EMPTY_TITLE_REJECTED });
    expect(await mirrorTitle(imageId)).toBe("Real Title");
  });

  it("refuses a whitespace-only title", async () => {
    const imageId = await publishedImage();
    const result = await updatePublishedNaming(imageId, { title: "   " });
    expect(result).toEqual({ error: EMPTY_TITLE_REJECTED });
    expect(await mirrorTitle(imageId)).toBe("Real Title");
  });

  it("still saves a real title, trimmed", async () => {
    const imageId = await publishedImage();
    const result = await updatePublishedNaming(imageId, { title: "  New  " });
    expect(result).toEqual({});
    expect(await mirrorTitle(imageId)).toBe("New");
  });

  it("still saves a backdrop-only edit, which sends no title at all", async () => {
    const imageId = await publishedImage();
    const result = await updatePublishedNaming(imageId, {
      backgroundColor: "Black",
    });
    expect(result).toEqual({});
    expect(await mirrorTitle(imageId)).toBe("Real Title");
  });

  it("still allows clearing the description, which is not a title", async () => {
    const imageId = await publishedImage();
    const result = await updatePublishedNaming(imageId, { description: "" });
    expect(result).toEqual({});
  });
});
```

If `makeSourceImage`'s signature or the mirror-product column names differ from the above, read `src/lib/__tests__/factories.ts` and `src/lib/db/schema.ts` and correct the test — do NOT change the production code to match a wrong test. Record any correction in the ledger.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/designs/__tests__/empty-title.integration.test.ts`
Expected: FAIL — `EMPTY_TITLE_REJECTED` is not exported, and the action returns `undefined` rather than `{}`.

- [ ] **Step 3: Add the copy constant**

In `src/lib/action-copy.ts`, under the existing `// --- image detail page (InlineNotice: one line) ---` heading, after `SET_PRIMARY_IMAGE_FAILED`, ADD:

```ts
export const EMPTY_TITLE_REJECTED = "A title can't be blank. Type a title or cancel.";
```

Do not edit or reorder any existing constant in that file.

- [ ] **Step 4: Implement the refusal**

In `src/app/designs/actions.ts`, import the constant alongside the existing imports:

```ts
import { EMPTY_TITLE_REJECTED } from "@/lib/action-copy";
```

Change the signature (line 290) to declare the return type:

```ts
export async function updatePublishedNaming(
  imageId: string,
  {
    title,
    description,
    backgroundColor,
  }: {
    title?: string;
    description?: string;
    backgroundColor?: string | null;
  }
): Promise<{ error?: string }> {
```

Immediately after the three existing guards (`!image` / `ownerId !== session.user.id` / `!image.publishedAt`), before the `const set: MirrorUpdate = {}` block, insert:

```ts
  // A blank title is not a state the reader can see: every display site
  // falls back to "Untitled", so saving "" only makes the row look broken
  // (an empty <h1>, an empty og:title). Refused as data rather than thrown,
  // the way deleteDesign refuses a shop-referenced design — a thrown
  // server-action error is masked behind a digest in production, so the
  // caller could not show the reason. Description is deliberately NOT
  // guarded: clearing one is legitimate (descriptions left the product in
  // PR #130).
  if (title !== undefined && title.trim() === "") {
    return { error: EMPTY_TITLE_REJECTED };
  }
```

Then make every remaining exit return `{}`. Concretely, the function currently ends after `revalidatePath("/shop")` with no return — add `return {};` there.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/designs/__tests__/empty-title.integration.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify the out-of-fence callers still pass untouched**

Run: `npx vitest run src/lib/__tests__/model-b-writer-cutover.integration.test.ts src/lib/__tests__/composition-mirror.integration.test.ts`
Expected: PASS with **no edits to those files**. If either fails, STOP and report — do not edit them.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. In particular `src/app/d/[imageId]/published-image-view.tsx` calls this action and discards the result; widening the return type must not break it.

- [ ] **Step 8: Commit**

```bash
git add src/app/designs/actions.ts src/lib/action-copy.ts src/app/designs/__tests__/empty-title.integration.test.ts
git commit -m "$(cat <<'EOF'
fix: refuse a blank image title instead of persisting ""

updatePublishedNaming persisted title.trim() with no non-empty check, so an
owner could save "" and every viewer got an empty <h1> and a blank labelled
TITLE row (finding F3 of PR #224's review). Refused as a structured { error }
the way deleteDesign refuses a shop-referenced design — a thrown server-action
error is masked behind a digest in production, so the caller could not show
the reason. Descriptions stay clearable.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Task 3: Editor guard + display fallbacks

**Files:**
- Modify: `src/app/d/[imageId]/editable-naming.tsx`
- Modify: `src/app/d/[imageId]/__tests__/editable-naming.test.tsx`
- Modify: `src/app/d/[imageId]/page.tsx` — four `??` fallbacks at lines 38, 107, 136, 176
- Test: `src/app/d/[imageId]/__tests__/image-page-metadata.test.ts` (new)

**Interfaces:**
- Consumes from Task 2: `updatePublishedNaming(...): Promise<{ error?: string }>` returning `{ error: EMPTY_TITLE_REJECTED }` for a blank title, and `EMPTY_TITLE_REJECTED` from `@/lib/action-copy`.
- Produces: nothing.

**Background the implementer needs:**

`EditableNaming` is a client component with two modes: a read view (an `<h1>` plus an owner-only "Edit" text button) and an edit view (input + Save + Cancel). It currently `try`/`catch`es the action and puts `err.message` on screen — but a thrown server-action error is a digest in production, so that string is not the sentence the server wrote. The structured `{ error }` return from Task 2 crosses the wire as data and IS written for the reader, so it is shown verbatim (this is exactly the split `src/lib/action-copy.ts`'s docblock describes).

Rulings R7 and R8 govern. R7 in particular: the read view's `{title?.trim() || "Untitled"}` at line 30 is **already correct** and `identity-block.tsx` does not read the title at all — do not "fix" either. The gap is `page.tsx`.

`page.tsx` line 38 is inside `generateMetadata`; the other three are in the default page component. Only `generateMetadata` is unit-testable without mocking the whole page, so that is what the new test file pins; the three JSX sites are covered by the existing `page.test.tsx`-style review and by the prod smoke.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/d/[imageId]/__tests__/editable-naming.test.tsx`. First replace the existing action mock so a test can steer the return value:

```tsx
const updatePublishedNaming = vi.fn(async () => ({}) as { error?: string });
vi.mock("@/app/designs/actions", () => ({
  updatePublishedNaming: (...args: unknown[]) =>
    updatePublishedNaming(...(args as [])),
}));
```

Keep the two existing tests exactly as they are. Add:

```tsx
import userEvent from "@testing-library/user-event";
import { EMPTY_TITLE_REJECTED } from "@/lib/action-copy";

describe("EditableNaming — blank titles", () => {
  beforeEach(() => {
    updatePublishedNaming.mockReset();
    updatePublishedNaming.mockResolvedValue({});
  });

  it("disables Save while the trimmed draft is empty", async () => {
    render(<EditableNaming imageId="img-1" title="Real Title" canEdit />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByPlaceholderText("Title");
    await userEvent.clear(input);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(input, "   ");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(input, "x");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("never calls the action with a blank title", async () => {
    render(<EditableNaming imageId="img-1" title="Real Title" canEdit />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByPlaceholderText("Title"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updatePublishedNaming).not.toHaveBeenCalled();
  });

  it("shows the server's refusal verbatim and stays in the editor", async () => {
    updatePublishedNaming.mockResolvedValue({ error: EMPTY_TITLE_REJECTED });
    render(<EditableNaming imageId="img-1" title="Real Title" canEdit />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByPlaceholderText("Title"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("inline-notice")).toHaveTextContent(
      EMPTY_TITLE_REJECTED
    );
    // Still editing — the draft is not silently discarded.
    expect(screen.getByPlaceholderText("Title")).toBeInTheDocument();
  });

  it("closes the editor on a successful save", async () => {
    render(<EditableNaming imageId="img-1" title="Real Title" canEdit />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByPlaceholderText("Title"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("heading", { name: "Real Title" })
    ).toBeInTheDocument();
  });
});
```

Then create `src/app/d/[imageId]/__tests__/image-page-metadata.test.ts`:

```ts
/**
 * generateMetadata's title fallback. `card.title ?? "..."` does not catch an
 * empty string, and prod may already hold blank titles saved before the
 * server-side guard landed — an empty og:title is a nameless share card.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getShareCard = vi.fn();
vi.mock("@/lib/image-share", () => ({
  getShareCard: (...args: unknown[]) => getShareCard(...(args as [])),
}));

const { generateMetadata } = await import("../page");

beforeEach(() => {
  getShareCard.mockReset();
});

describe("image detail page metadata", () => {
  it("falls back for an empty-string title, not a nameless card", async () => {
    getShareCard.mockResolvedValue({ title: "", description: null });
    const meta = await generateMetadata({
      params: Promise.resolve({ imageId: "img-1" }),
    });
    expect(meta.title).toBe("A design on PRNTD");
    expect(meta.openGraph?.title).toBe("A design on PRNTD");
  });

  it("uses a real title", async () => {
    getShareCard.mockResolvedValue({ title: "Dapper Whale", description: null });
    const meta = await generateMetadata({
      params: Promise.resolve({ imageId: "img-1" }),
    });
    expect(meta.title).toBe("Dapper Whale");
  });
});
```

`page.tsx`'s real `generateMetadata` may pull a differently-named loader and may take a differently-shaped `params`/`searchParams`. **Read `src/app/d/[imageId]/page.tsx` lines 1–60 first** and adjust the mock target, the call shape, and the assertions to match what is actually there. If mocking `generateMetadata`'s dependency graph turns out to drag in the whole page module (server actions, DB), do not fight it: delete this second test file, and instead pin the fallback by extracting the expression into a tiny exported pure helper in `page.tsx` and testing that. Record which route you took in the ledger.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run "src/app/d/[imageId]/__tests__/editable-naming.test.tsx" "src/app/d/[imageId]/__tests__/image-page-metadata.test.ts"`
Expected: FAIL — Save is not disabled, no `inline-notice` renders, metadata returns `""`.

- [ ] **Step 3: Update `editable-naming.tsx`**

Replace the component body with this (the read view is unchanged — do not touch the `{title?.trim() || "Untitled"}` line):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePublishedNaming } from "@/app/designs/actions";
import { Button, InlineNotice } from "@/components/ui";

type Props = {
  imageId: string;
  title: string | null;
  canEdit: boolean;
};

export function EditableNaming({ imageId, title, canEdit }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A blank title is unsaveable (the server refuses it), so the control says
  // so rather than letting the tap fail. The dotted-border disabled look
  // comes from the Button primitive.
  const blank = titleDraft.trim() === "";

  if (!editing) {
    return (
      <div className="flex items-baseline gap-3">
        {/* 14px/500 ink: the title is a value inside the identity block
            now, not a page-scale headline (Paper slice 5, #188). It stays
            the page's h1. Rendered unconditionally — an owner viewing an
            unpublished, untitled image (canEdit false there) still gets a
            labelled TITLE row, falling back to "Untitled". */}
        <h1 className="text-sm font-medium text-foreground">
          {title?.trim() || "Untitled"}
        </h1>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="min-h-11 text-xs text-text-muted underline underline-offset-[3px] hover:no-underline sm:min-h-0"
          >
            Edit
          </button>
        )}
      </div>
    );
  }

  async function handleSave() {
    if (blank) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updatePublishedNaming(imageId, { title: titleDraft });
      // A structured refusal crosses the wire as data and is already written
      // for the reader, so it is shown verbatim — unlike a thrown error,
      // which production masks behind a digest.
      if (result?.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError(SAVE_TITLE_FAILED);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 pt-2">
      <input
        type="text"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        placeholder="Title"
        maxLength={80}
        className="w-full bg-surface border border-border rounded px-3 py-2 text-base"
      />
      {error && <InlineNotice message={error} />}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || blank} size="sm">
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          onClick={() => {
            setEditing(false);
            setTitleDraft(title ?? "");
            setError(null);
          }}
          variant="ghost"
          size="sm"
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

The `catch` branch above references `SAVE_TITLE_FAILED`, which does not exist yet. Add it to `src/lib/action-copy.ts` under the same image-detail-page heading, right after `EMPTY_TITLE_REJECTED`:

```ts
export const SAVE_TITLE_FAILED = "Couldn't save this title. Try again.";
```

and import it in `editable-naming.tsx`:

```ts
import { EMPTY_TITLE_REJECTED, SAVE_TITLE_FAILED } from "@/lib/action-copy";
```

(`EMPTY_TITLE_REJECTED` is not referenced by the component — the server supplies that string — so import only `SAVE_TITLE_FAILED`. Do not add an unused import; lint will flag it.)

This replaces the old `setError(err instanceof Error ? err.message : String(err))`, which showed a production digest to the user. That is the same ruling PR #218 applied at every other site on this page.

- [ ] **Step 4: Fix the four `??` title fallbacks in `page.tsx`**

At line 38 and at each of the three JSX sites (lines ~107, ~136, ~176), replace `X.title ?? "..."` with an empty-safe form:

```tsx
const title = card.title?.trim() || "A design on PRNTD";
```

```tsx
current={img.title?.trim() || "Design"}
```

```tsx
alt={img.title?.trim() || "Design"}
```

Add one comment above the `generateMetadata` line explaining why `??` is not enough:

```tsx
  // `??` would let an empty-string title through — a nameless share card,
  // and an empty alt on the two <Image>s below. Rows saved blank before
  // updatePublishedNaming started refusing them still exist.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run "src/app/d/[imageId]/"`
Expected: PASS — the whole image-detail-page test directory, including the pre-existing files, all green.

- [ ] **Step 6: Commit**

```bash
git add "src/app/d/[imageId]" src/lib/action-copy.ts
git commit -m "$(cat <<'EOF'
fix: block blank titles in the editor and fall back on display

Save is disabled while the trimmed draft is empty, so the server's refusal is
normally unreachable; when it does arrive it is shown verbatim (a structured
{ error } is written for the reader, unlike a thrown error, which production
masks behind a digest — the same split PR #218 applied elsewhere on this
page). page.tsx's four `??` title fallbacks become empty-safe: `??` let ""
through, giving a nameless share card and an empty alt for rows saved blank
before the server guard landed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Self-review notes

- **Spec coverage.** (a) error boundary → Task 1, including `global-error.tsx` (R3), `console.error`-only logging (R4), digest (R5), link target (R2), and the retry semantics the spec got wrong for Next 16.2 (R1). (b) empty titles: layer 1 server refusal → Task 2 (R6); layer 2 editor → Task 3 (R8); layer 3 display → R7 records that `editable-naming.tsx` already has it and redirects the work to `page.tsx`, in Task 3. Real-DB test for the action → Task 2 step 1, on the `publish-gate.integration.test.ts` pattern the spec pointed at.
- **Type consistency.** `updatePublishedNaming` is `Promise<{ error?: string }>` in Task 2's Interfaces block, in its implementation step, and in Task 3's consumption (`result?.error`). `EMPTY_TITLE_REJECTED` and `SAVE_TITLE_FAILED` are both defined in `src/lib/action-copy.ts` (Task 2 step 3, Task 3 step 3) — the second is added by Task 3, which is the only consumer.
- **Known soft spots, flagged for the implementer rather than guessed at:** the jsdom `<html>`-in-`<body>` render for `global-error` (Task 1 step 1 note), the factory/column names in the new integration test (Task 2 step 1 note), and whether `generateMetadata` is unit-testable in isolation (Task 3 step 1 note). Each has an explicit fallback and a "record it in the ledger" instruction.
