# Alert Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every `window.alert` / bare `alert(` call in product code with an in-page surface — a one-button notice sheet built on the existing `Modal`, or an inline error line next to the control — and add a guard test so none creep back.

**Architecture:** PR #200 already replaced all 11 `window.confirm` calls with `ConfirmSheet` / `useConfirm` (`src/components/ui/confirm-sheet.tsx`), copy split into named constants. This plan finishes that job for the 19 remaining `alert(` call sites across 6 files. Two new primitives sit beside `ConfirmSheet` in `src/components/ui`: `NoticeSheet` / `useNotice` (a one-button acknowledge sheet, same Modal, same sheet-on-phone / dialog-on-desktop chrome) and `InlineNotice` (a one-line status/error paragraph on Paper tokens). Every string moves to `src/lib/action-copy.ts`. Nothing about what the underlying server actions do changes.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Tailwind v4 with the Paper design tokens from `src/app/globals.css`, Vitest + jsdom + @testing-library/react.

**Spec:** The controller's dispatch brief (reproduced in "Spec" below). Related prior art: `docs/design-system.md` (persona C copy), `src/components/ui/confirm-sheet.tsx` (#200), `src/app/cart/page.tsx` (#116 error + Retry state), `src/app/__tests__/globals-css.test.ts` (guard-test style).

## Global Constraints

- Work only inside this worktree, on branch `feat/alert-sweep`. Never touch the main checkout or sibling worktrees.
- **Copy is persona C** (`docs/design-system.md` Part 1): plain statements of what happened and what to do. No whimsy, no exclamation marks, no apology theatre ("Oops!", "Sorry about that!"), no hyperbole.
- **No inline string literals for user-visible copy.** Every user-visible string is a named export of `src/lib/action-copy.ts`, imported at the call site. This is the #200 rule.
- **Paper tokens only.** Error text uses `text-negative` (`--negative: #b91c1c`), secondary/neutral text uses `text-text-muted` or `text-text-faint`. No raw `text-red-*` / `text-gray-*` classes; the #213 sweep removed those on purpose.
- `@typescript-eslint/no-explicit-any` is **error** in product code, **off** in tests. Use `catch (err)` (defaults to `unknown`) and narrow with `err instanceof Error ? … : String(err)`; never annotate `err: any`.
- Phone-first: any tappable control keeps a ≥44px tap target (`min-h-[44px]` / `min-h-11`), matching `ConfirmSheet`.
- Out of scope: changing what any server action does, redesigning any page, `window.confirm` (already done in #200), any schema change, any `e2e/` change (no Playwright spec handles dialogs today — verified by grep).
- Every commit message ends with these two trailer lines, exactly:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
```

## Spec

Replace every `window.alert` with an in-page surface. Classify each site:

- **(a) An error the user must acknowledge before the UI is usable again** → a one-button acknowledge sheet built on the SAME `Modal`/sheet primitive as `ConfirmSheet` (`NoticeSheet`/`useNotice` next to it, same styling, one "Close"-style button labelled per persona C).
- **(b) A transient failure of an inline action** → an inline error line next to the control, on Paper tokens. Admin pages may use (b) throughout.

Tests: a component test for the notice sheet (renders message, Close dismisses, focus lands on Close on open — mirroring the `ConfirmSheet` tests), and for each converted site either an existing test updated or a small new one proving the error path renders the notice/inline line and that `window.alert` is **not** called. Then a guard test that greps `src/` and fails if any `alert(` call site returns.

## Baseline

Captured before any change (`npm test`): **146 test files, 1594 tests passing.** The 19 call sites, from
`grep -rn "alert(" src --include='*.tsx' --include='*.ts' | grep -v __tests__ | grep -v 'role="alert"'`:

| File | Lines | Sites |
| --- | --- | --- |
| `src/app/design/design-client.tsx` | 612, 685, 697 | 3 |
| `src/app/admin/page.tsx` | 80, 98, 101, 107 | 4 |
| `src/app/admin/orders/[id]/page.tsx` | 63, 81, 84, 90, 108, 111, 115 | 7 |
| `src/app/d/[imageId]/start-from-image.tsx` | 24 | 1 |
| `src/app/d/[imageId]/conversation-actions.tsx` | 39, 58, 63 | 3 |
| `src/app/d/[imageId]/conversation-images.tsx` | 57 | 1 |

## Classification, per site

Recorded here because the ruling — not the mechanics — is the load-bearing part of this slice.

**(a) NoticeSheet — `src/app/design/design-client.tsx`, all 3 sites.** Every one of these fires from a surface with no stable inline slot: the delete comes from inside the image lightbox or the mobile gallery drawer (an overlay, which is why `handlePublishImage` closes the lightbox before opening the publish modal), and Close/Reopen and "New design from this image" fire from the thread header and the lightbox respectively. There is nowhere to put a line "next to the control" that the user would still be looking at. A modal sheet also matches what the action left behind: the thread did not change state, and the user needs to know that before carrying on.

**(b) InlineNotice — `src/app/d/[imageId]/*`, all 5 sites.** Each of these three components owns a small, always-visible block of its own (a full-width button; a two-button text row; a strip row plus the lightbox `actions` slot). The failing control stays on screen and re-enables, so a line directly beneath it is both cheaper and less interruptive than a modal. `conversation-images.tsx` renders its line in **both** places `handleUse` is reachable from — the strip row and the lightbox actions slot — rather than stacking a sheet on top of the lightbox.

**(b) InlineNotice — `src/app/admin/*`, all 11 sites.** Per the spec, admin uses (b) throughout. Admin also has *success* alerts ("Recovered: …", "Refund issued.", "Already refunded — no action taken."), which a one-button error sheet models badly; the inline line carries a `tone` so the same slot reports both outcomes. Admin is a single operator (Nico) who wants the diagnostic, so admin lines carry the raw error text as a secondary `hint`.

**Ruling: user-facing surfaces never render `err.message`; admin does.** In production, Next.js masks thrown server-action messages behind a digest — `conversation-actions.tsx` already carries a comment saying exactly this. So today's `window.alert(err.message)` on prod shows a digest string for the *most* informative case (`deleteDesignImage` throws `"Can't delete this image — it's referenced by an order."`, which the customer never sees). Replacing it with our own plain constant is strictly better than what ships today. Structured refusals that come back as `{ error }` (e.g. `deleteDesign`) are still shown **verbatim** — those cross the wire as data, not as a thrown error, and are already written for the user. Cost if wrong: a genuinely informative thrown message is flattened to a generic line. Deferred follow-up, out of scope here: convert `deleteDesignImage`'s throw into an `{ error }` return the way `deleteDesign` does, so the real refusal survives prod.

## File structure

**Create:**
- `src/components/ui/notice-sheet.tsx` — `NoticeSheet` (presentational) + `useNotice` (imperative hook). Mirrors `confirm-sheet.tsx` exactly one file over.
- `src/components/ui/inline-notice.tsx` — `InlineNotice`, one line of tone-coloured copy with an optional secondary hint. Shared by all 8 (b) sites so the token choice lives in one place.
- `src/lib/action-copy.ts` — every user-visible string this slice touches.
- `src/components/ui/__tests__/notice-sheet.test.tsx`
- `src/components/ui/__tests__/inline-notice.test.tsx`
- `src/app/d/[imageId]/__tests__/conversation-actions.test.tsx`
- `src/app/d/[imageId]/__tests__/start-from-image.test.tsx`
- `src/app/__tests__/no-window-alert.test.ts` — the guard.

**Modify:**
- `src/components/ui/index.ts` — export the two new primitives and their types.
- `src/app/design/design-client.tsx` — 3 sites → `useNotice`.
- `src/app/d/[imageId]/start-from-image.tsx`, `conversation-actions.tsx`, `conversation-images.tsx` — 5 sites → `InlineNotice`.
- `src/app/admin/page.tsx`, `src/app/admin/orders/[id]/page.tsx` — 11 sites → `InlineNotice`.
- `src/app/d/[imageId]/__tests__/conversation-images.test.tsx` — the existing "a failed save alerts the message" test asserts `window.alert` was called; it becomes an assertion that the inline line rendered and `alert` was not called.
- `src/lib/design-view.ts` — one small pure helper (Task 4) so the branchy notice choice is unit-testable.

---

### Task 1: Notice primitives and the copy module

**Files:**
- Create: `src/components/ui/notice-sheet.tsx`
- Create: `src/components/ui/inline-notice.tsx`
- Create: `src/lib/action-copy.ts`
- Create: `src/components/ui/__tests__/notice-sheet.test.tsx`
- Create: `src/components/ui/__tests__/inline-notice.test.tsx`
- Modify: `src/components/ui/index.ts`

**Interfaces:**
- Consumes: `Modal` from `./modal`, `Button` from `./button` (both already forward refs — `ConfirmSheet` passes `ref` to `Button` today).
- Produces, relied on by Tasks 3–5:
  - `NoticeSheet(props: NoticeSheetProps)` where `NoticeSheetProps = { open: boolean; title: string; body?: string; closeLabel?: string; onClose: () => void }`. Test id `notice-sheet`, close button test id `notice-sheet-close`.
  - `useNotice(): { notice: (options: NoticeOptions) => void; element: ReactNode }` where `NoticeOptions = { title: string; body?: string; closeLabel?: string }`.
  - `InlineNotice(props: InlineNoticeProps)` where `InlineNoticeProps = { message: string; hint?: string; tone?: "negative" | "neutral"; className?: string; testId?: string }`. Default `tone` is `"negative"`, default `testId` is `"inline-notice"`.
  - `src/lib/action-copy.ts` exports listed in Step 5 below.

- [ ] **Step 1: Write the failing tests for both primitives**

Create `src/components/ui/__tests__/notice-sheet.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { NoticeSheet, useNotice } from "../notice-sheet";

describe("NoticeSheet", () => {
  it("renders title and body when open", () => {
    render(<NoticeSheet open title="Image not deleted" body="It may be on an order." onClose={() => {}} />);
    expect(screen.getByText("Image not deleted")).toBeInTheDocument();
    expect(screen.getByText("It may be on an order.")).toBeInTheDocument();
    expect(screen.getByTestId("notice-sheet")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<NoticeSheet open={false} title="Image not deleted" onClose={() => {}} />);
    expect(screen.queryByTestId("notice-sheet")).not.toBeInTheDocument();
  });

  it("defaults the button label to Close and honors an override", () => {
    const { unmount } = render(<NoticeSheet open title="Nope" onClose={() => {}} />);
    expect(screen.getByTestId("notice-sheet-close")).toHaveTextContent("Close");
    unmount();
    render(<NoticeSheet open title="Nope" closeLabel="Got it" onClose={() => {}} />);
    expect(screen.getByTestId("notice-sheet-close")).toHaveTextContent("Got it");
  });

  it("focuses the close button on open", () => {
    render(<NoticeSheet open title="Nope" onClose={() => {}} />);
    expect(screen.getByTestId("notice-sheet-close")).toHaveFocus();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<NoticeSheet open title="Nope" onClose={onClose} />);
    fireEvent.click(screen.getByTestId("notice-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<NoticeSheet open title="Nope" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function Harness() {
  const { notice, element } = useNotice();
  const [count, setCount] = useState(0);
  return (
    <>
      {element}
      <button type="button" onClick={() => { notice({ title: `Failure ${count}` }); setCount((n) => n + 1); }}>
        fail
      </button>
    </>
  );
}

describe("useNotice", () => {
  it("shows nothing until notice() is called", () => {
    render(<Harness />);
    expect(screen.queryByTestId("notice-sheet")).not.toBeInTheDocument();
  });

  it("shows the sheet on notice() and dismisses it on Close", async () => {
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByText("fail")); });
    expect(screen.getByText("Failure 0")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTestId("notice-sheet-close")); });
    expect(screen.queryByTestId("notice-sheet")).not.toBeInTheDocument();
  });

  it("replaces an open notice with the newer one", async () => {
    render(<Harness />);
    await act(async () => { fireEvent.click(screen.getByText("fail")); });
    await act(async () => { fireEvent.click(screen.getByText("fail")); });
    expect(screen.getByText("Failure 1")).toBeInTheDocument();
    expect(screen.queryByText("Failure 0")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("notice-sheet")).toHaveLength(1);
  });
});
```

Create `src/components/ui/__tests__/inline-notice.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InlineNotice } from "../inline-notice";

describe("InlineNotice", () => {
  it("renders the message on the negative token by default", () => {
    render(<InlineNotice message="Couldn't open this conversation." />);
    const el = screen.getByTestId("inline-notice");
    expect(el).toHaveTextContent("Couldn't open this conversation.");
    expect(el.className).toContain("text-negative");
  });

  it("renders a neutral tone on the muted token", () => {
    render(<InlineNotice tone="neutral" message="Refund issued." />);
    const el = screen.getByTestId("inline-notice");
    expect(el.className).toContain("text-text-muted");
    expect(el.className).not.toContain("text-negative");
  });

  it("renders an optional hint beneath the message", () => {
    render(<InlineNotice message="Recover failed." hint="Order not found" />);
    expect(screen.getByText("Order not found")).toBeInTheDocument();
  });

  it("omits the hint element when no hint is given", () => {
    render(<InlineNotice message="Recover failed." />);
    expect(screen.getByTestId("inline-notice").querySelector("span")).toBeNull();
  });

  it("honors a custom testId", () => {
    render(<InlineNotice message="x" testId="admin-action-result" />);
    expect(screen.getByTestId("admin-action-result")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run both tests to verify they fail**

Run: `npx vitest run src/components/ui/__tests__/notice-sheet.test.tsx src/components/ui/__tests__/inline-notice.test.tsx`
Expected: FAIL — "Failed to resolve import ../notice-sheet" and "../inline-notice".

- [ ] **Step 3: Write `src/components/ui/notice-sheet.tsx`**

Chrome is copied verbatim from `confirm-sheet.tsx` so the two read as one family. Do not invent new spacing or colours.

```tsx
"use client";

import { ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Modal } from "./modal";
import { Button } from "./button";

export type NoticeSheetProps = {
  open: boolean;
  title: string;
  body?: string;
  closeLabel?: string;
  onClose: () => void;
};

/**
 * One-button acknowledge sheet — ConfirmSheet's sibling for the case where
 * there is nothing to decide, only something to be told. Same Modal, same
 * chrome: slides up from the bottom under `sm:`, a centred dialog from `sm:`
 * up. Used where the failing control lives on a surface with no stable inline
 * slot (a lightbox, a drawer, a thread header); everything with a visible
 * anchor uses InlineNotice instead.
 *
 * role="alertdialog" rather than "dialog": the content is an error the user
 * is being asked to acknowledge, which is what that role means.
 */
export function NoticeSheet({
  open,
  title,
  body,
  closeLabel = "Close",
  onClose,
}: NoticeSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Close is the only action, so it is also the safe focus target: an
    // Enter keypress right after the sheet opens dismisses it.
    if (open) closeRef.current?.focus();
  }, [open]);

  const titleId = useId();

  return (
    <Modal open={open} onClose={onClose}>
      <div
        data-testid="notice-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 w-full rounded-t-xl border-t border-border bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:static sm:w-96 sm:rounded-xl sm:border sm:pb-5"
      >
        <h2 id={titleId} className="text-base font-medium text-foreground">{title}</h2>
        {body ? <p className="mt-2 text-sm text-text-muted">{body}</p> : null}
        <div className="mt-5 flex justify-end">
          <Button
            ref={closeRef}
            type="button"
            data-testid="notice-sheet-close"
            variant="secondary"
            size="lg"
            className="min-h-[44px] w-full sm:w-auto"
            onClick={onClose}
          >
            {closeLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export type NoticeOptions = {
  title: string;
  body?: string;
  closeLabel?: string;
};

/**
 * Imperative notice() over the NoticeSheet primitive, so a caller can report
 * a failure from a catch block without wiring its own open/close state:
 *
 *   const { notice, element } = useNotice();
 *   catch { notice({ title, body }); }
 *   ...
 *   return <>{element}...</>;
 *
 * One notice at a time: a second call while one is open replaces it, so a
 * burst of failures never stacks sheets. Nothing is awaited — unlike
 * useConfirm there is no answer to wait for.
 */
export function useNotice(): { notice: (options: NoticeOptions) => void; element: ReactNode } {
  const [current, setCurrent] = useState<NoticeOptions | null>(null);

  const notice = useCallback((options: NoticeOptions) => {
    setCurrent(options);
  }, []);

  const dismiss = useCallback(() => setCurrent(null), []);

  const element = current ? (
    <NoticeSheet
      open
      title={current.title}
      body={current.body}
      closeLabel={current.closeLabel}
      onClose={dismiss}
    />
  ) : null;

  return { notice, element };
}
```

- [ ] **Step 4: Write `src/components/ui/inline-notice.tsx`**

```tsx
export type InlineNoticeTone = "negative" | "neutral";

export type InlineNoticeProps = {
  /** The one line of copy. Always a constant from src/lib/action-copy.ts. */
  message: string;
  /** Optional second line — the raw error text on admin surfaces, where the
   * operator wants the diagnostic. Never used on customer surfaces. */
  hint?: string;
  tone?: InlineNoticeTone;
  className?: string;
  testId?: string;
};

/**
 * One line of result copy next to the control that produced it — the inline
 * half of the alert sweep. Sites whose failing control stays on screen use
 * this; sites on an overlay with no stable anchor use NoticeSheet.
 *
 * The tone→token mapping lives here and nowhere else, so a future palette
 * change is one edit: `text-negative` for a failure, `text-text-muted` for a
 * neutral/success result (admin's "Refund issued.").
 */
export function InlineNotice({
  message,
  hint,
  tone = "negative",
  className = "",
  testId = "inline-notice",
}: InlineNoticeProps) {
  return (
    <p
      data-testid={testId}
      role={tone === "negative" ? "alert" : "status"}
      aria-live="polite"
      className={`text-sm ${tone === "negative" ? "text-negative" : "text-text-muted"} ${className}`}
    >
      {message}
      {hint ? <span className="block text-text-faint">{hint}</span> : null}
    </p>
  );
}
```

- [ ] **Step 5: Write `src/lib/action-copy.ts`**

Every string this slice shows a human. Persona C: say what happened, then what to do.

```ts
/**
 * User-visible copy for action failures and results, split out of the call
 * sites the way #200 split the confirm copy. Persona C (docs/design-system.md
 * Part 1): plain statement of what happened, then what to do. No apologies,
 * no exclamation marks.
 *
 * Customer-facing constants never interpolate a thrown error's message: in
 * production Next.js masks server-action throws behind a digest, so
 * `err.message` is not the sentence the server wrote. Structured refusals
 * that come back as `{ error }` are shown verbatim by their call site —
 * those cross the wire as data and are already written for the reader.
 * Admin constants pair with a raw-error `hint`, because the admin surface has
 * exactly one operator and he wants the diagnostic.
 */

// --- /design thread (NoticeSheet: title + body) ---

export const DELETE_IMAGE_ERROR = {
  title: "Image not deleted",
  body: "It may be on an order or used by another design. Refresh the page and try again.",
} as const;

export const CLOSE_CONVERSATION_ERROR = {
  title: "Conversation not closed",
  body: "Try again.",
} as const;

export const REOPEN_CONVERSATION_ERROR = {
  title: "Conversation not reopened",
  body: "Try again.",
} as const;

export const START_FROM_IMAGE_ERROR = {
  title: "New design not started",
  body: "The image is still here. Try again.",
} as const;

// --- image detail page (InlineNotice: one line) ---

export const OPEN_CONVERSATION_FAILED = "Couldn't open this conversation. Try again.";
export const DELETE_CONVERSATION_FAILED = "Couldn't delete this conversation. Try again.";
export const START_FROM_IMAGE_FAILED = "Couldn't start a new design from this image. Try again.";
export const SET_PRIMARY_IMAGE_FAILED = "Couldn't make this the design's image. Try again.";

// --- admin (InlineNotice: one line, plus the raw error as a hint) ---

export const ADMIN_RETRY_FAILED = "Retry failed.";
export const ADMIN_RECOVER_FAILED = "Recover failed.";
export const ADMIN_REFUND_FAILED = "Refund failed.";
export const ADMIN_REFUND_ISSUED = "Refund issued.";
export const ADMIN_ALREADY_REFUNDED = "Already refunded — no action taken.";
export const ADMIN_RECOVER_ARCHIVE_HINT =
  "If the Stripe session was never paid, archive the order instead.";

export const adminRecovered = (action: string) => `Recovered: ${action}`;
export const adminCannotRecover = (reason: string) => `Cannot recover: ${reason}`;
export const adminCannotRefund = (reason: string) => `Cannot refund: ${reason}`;
```

- [ ] **Step 6: Export the primitives from `src/components/ui/index.ts`**

Add beneath the existing `ConfirmSheet` lines, keeping the file's shape:

```ts
export { NoticeSheet, useNotice } from "./notice-sheet";
export type { NoticeSheetProps, NoticeOptions } from "./notice-sheet";
export { InlineNotice } from "./inline-notice";
export type { InlineNoticeProps, InlineNoticeTone } from "./inline-notice";
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/ui/__tests__/notice-sheet.test.tsx src/components/ui/__tests__/inline-notice.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/notice-sheet.tsx src/components/ui/inline-notice.tsx src/components/ui/index.ts src/lib/action-copy.ts src/components/ui/__tests__/notice-sheet.test.tsx src/components/ui/__tests__/inline-notice.test.tsx
git commit -m "$(cat <<'EOF'
Add NoticeSheet/useNotice + InlineNotice and the shared action copy

The two in-page surfaces that replace window.alert: a one-button
acknowledge sheet on the same Modal as ConfirmSheet (#200), for controls
that live on an overlay with no stable inline slot, and a one-line
notice for controls that stay on screen. All copy lands in
src/lib/action-copy.ts.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 2: Image detail page — inline notices (5 sites)

**Files:**
- Modify: `src/app/d/[imageId]/start-from-image.tsx` (line 24)
- Modify: `src/app/d/[imageId]/conversation-actions.tsx` (lines 39, 58, 63)
- Modify: `src/app/d/[imageId]/conversation-images.tsx` (line 57)
- Modify: `src/app/d/[imageId]/__tests__/conversation-images.test.tsx` (the `beforeEach` alert spy at line 42 and the test at line 218)
- Create: `src/app/d/[imageId]/__tests__/conversation-actions.test.tsx`
- Create: `src/app/d/[imageId]/__tests__/start-from-image.test.tsx`

**Interfaces:**
- Consumes: `InlineNotice` from `@/components/ui`; `OPEN_CONVERSATION_FAILED`, `DELETE_CONVERSATION_FAILED`, `START_FROM_IMAGE_FAILED`, `SET_PRIMARY_IMAGE_FAILED` from `@/lib/action-copy`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests for the two components that have none**

Create `src/app/d/[imageId]/__tests__/start-from-image.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StartFromImage } from "../start-from-image";
import { startConversationFromImage } from "@/app/design/actions";
import { START_FROM_IMAGE_FAILED } from "@/lib/action-copy";

vi.mock("@/app/design/actions", () => ({ startConversationFromImage: vi.fn() }));
vi.mock("@/lib/ensure-guest-session", () => ({ ensureGuestSession: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.spyOn(window, "alert").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("StartFromImage", () => {
  it("shows an inline failure line and no alert when the action throws", async () => {
    vi.mocked(startConversationFromImage).mockRejectedValueOnce(new Error("Unauthorized"));
    render(<StartFromImage imageId="img-a" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-from-image"));
    });
    expect(screen.getByTestId("inline-notice")).toHaveTextContent(START_FROM_IMAGE_FAILED);
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.getByTestId("start-from-image")).toBeEnabled();
  });

  it("clears a previous failure line when the action is retried", async () => {
    vi.mocked(startConversationFromImage)
      .mockRejectedValueOnce(new Error("Unauthorized"))
      .mockImplementationOnce(() => new Promise(() => {}));
    render(<StartFromImage imageId="img-a" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-from-image"));
    });
    expect(screen.getByTestId("inline-notice")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-from-image"));
    });
    expect(screen.queryByTestId("inline-notice")).not.toBeInTheDocument();
  });
});
```

Note on the second test: the success path calls `window.location.assign`, which jsdom does not implement — the second mock therefore returns a promise that never settles, so the assertion runs while the action is still in flight and no navigation is attempted.

Create `src/app/d/[imageId]/__tests__/conversation-actions.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConversationActions } from "../conversation-actions";
import { openConversation } from "@/app/d/conversation-actions";
import { deleteDesign } from "@/app/designs/actions";
import { OPEN_CONVERSATION_FAILED, DELETE_CONVERSATION_FAILED } from "@/lib/action-copy";

vi.mock("@/app/d/conversation-actions", () => ({ openConversation: vi.fn() }));
vi.mock("@/app/designs/actions", () => ({ deleteDesign: vi.fn() }));

beforeEach(() => {
  vi.spyOn(window, "alert").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Walk the confirm sheet #200 puts in front of Delete. */
async function confirmDelete() {
  await act(async () => {
    fireEvent.click(screen.getByText("Delete conversation"));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("confirm-sheet-confirm"));
  });
}

describe("ConversationActions", () => {
  it("shows an inline line and no alert when opening fails", async () => {
    vi.mocked(openConversation).mockRejectedValueOnce(new Error("Unauthorized"));
    render(<ConversationActions designId="d1" archived={false} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("open-conversation"));
    });
    expect(screen.getByTestId("inline-notice")).toHaveTextContent(OPEN_CONVERSATION_FAILED);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("shows a structured refusal verbatim", async () => {
    vi.mocked(deleteDesign).mockResolvedValueOnce({ error: "This design has an order on it." });
    render(<ConversationActions designId="d1" archived={false} />);
    await confirmDelete();
    expect(screen.getByTestId("inline-notice")).toHaveTextContent("This design has an order on it.");
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("shows the generic delete line when the action throws", async () => {
    vi.mocked(deleteDesign).mockRejectedValueOnce(new Error("boom"));
    render(<ConversationActions designId="d1" archived={false} />);
    await confirmDelete();
    expect(screen.getByTestId("inline-notice")).toHaveTextContent(DELETE_CONVERSATION_FAILED);
    expect(screen.queryByText("boom")).toBeNull();
    expect(window.alert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run "src/app/d/[imageId]/__tests__/start-from-image.test.tsx" "src/app/d/[imageId]/__tests__/conversation-actions.test.tsx"`
Expected: FAIL — no `inline-notice` element; `window.alert` was called.

- [ ] **Step 3: Convert `start-from-image.tsx`**

Add `error` state, clear it when the action starts, set the constant on failure, and wrap the button so the line has somewhere to live. The `w-full` on the wrapper preserves the button's full-width layout in its parent.

```tsx
"use client";

import { useState } from "react";
import { startConversationFromImage } from "@/app/design/actions";
import { ensureGuestSession } from "@/lib/ensure-guest-session";
import { Button, InlineNotice } from "@/components/ui";
import { START_FROM_IMAGE_FAILED } from "@/lib/action-copy";

export function StartFromImage({ imageId }: { imageId: string }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await ensureGuestSession();
      const { designId } = await startConversationFromImage(imageId);
      window.location.assign(`/design?id=${designId}`);
    } catch {
      // The thrown message is a Next.js digest in production, so the line
      // says what happened in our own words instead.
      setError(START_FROM_IMAGE_FAILED);
      setStarting(false);
    }
  }

  return (
    <div className="w-full space-y-2">
      <Button
        variant="secondary"
        size="lg"
        onClick={start}
        disabled={starting}
        data-testid="start-from-image"
        className="w-full"
      >
        {starting ? "Starting…" : "New design from this image"}
      </Button>
      {error && <InlineNotice message={error} />}
    </div>
  );
}
```

Keep the existing file-top docblock (lines 8–13) exactly as it is.

- [ ] **Step 4: Convert `conversation-actions.tsx`**

Add `error` state cleared at the start of each action; render the line under the button row. The root becomes a `space-y-2` wrapper around the existing `flex flex-wrap` row, so the row's own layout is unchanged.

```tsx
  const [busy, setBusy] = useState<"open" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, element: confirmSheet } = useConfirm();

  async function open() {
    setBusy("open");
    setError(null);
    try {
      await openConversation(designId);
      window.location.assign(`/design?id=${designId}`);
    } catch {
      setError(OPEN_CONVERSATION_FAILED);
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: DELETE_CONVERSATION_TITLE,
      body: DELETE_CONVERSATION_CONSEQUENCE,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy("delete");
    setError(null);
    try {
      // Expected refusals come back as { error } — prod masks thrown
      // server-action messages, so a throw here only shows the digest. The
      // refusal is written for the reader, so it is shown verbatim; a throw
      // gets our own line.
      const result = await deleteDesign(designId);
      if (result?.error) {
        setError(result.error);
        setBusy(null);
        return;
      }
    } catch {
      setError(DELETE_CONVERSATION_FAILED);
      setBusy(null);
      return;
    }
    window.location.assign("/designs");
  }
```

and the render:

```tsx
  return (
    <div className="space-y-2 pt-1">
      {confirmSheet}
      <div className="flex flex-wrap items-center gap-4">
        {/* ...the two buttons and the archived span, unchanged... */}
      </div>
      {error && <InlineNotice message={error} />}
    </div>
  );
```

The `pt-1` moves from the inner row to the new wrapper; the inner row keeps `flex flex-wrap items-center gap-4`.

Imports become:

```tsx
import { useConfirm, InlineNotice } from "@/components/ui";
import { DELETE_CONVERSATION_FAILED, OPEN_CONVERSATION_FAILED } from "@/lib/action-copy";
```

- [ ] **Step 5: Convert `conversation-images.tsx`**

`handleUse` is reachable from two places, so the line renders in both. Add state, clear on each attempt:

```tsx
  const [saving, setSaving] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);
```

```tsx
  async function handleUse(imageId: string) {
    setSaving(true);
    setUseError(null);
    try {
      await setPrimaryImage(designId, imageId);
      setPrimary(imageId);
    } catch {
      setUseError(SET_PRIMARY_IMAGE_FAILED);
    } finally {
      setSaving(false);
    }
  }
```

In the strip row, after the `isPrimary ? … : <Button …>` block and still inside the `flex flex-wrap items-center gap-3` div:

```tsx
        {useError && <InlineNotice message={useError} />}
```

In the lightbox `actions` fragment, after the existing `Open` link:

```tsx
              {useError && <InlineNotice message={useError} className="self-center" />}
```

Imports:

```tsx
import { Button, InlineNotice } from "@/components/ui";
import { SET_PRIMARY_IMAGE_FAILED } from "@/lib/action-copy";
```

Note both slots render the same state, so when the lightbox is open the element appears twice in the DOM. That is deliberate — the strip is behind the lightbox and the user only ever sees one — but it means the updated test in Step 6 must use `getAllByTestId` where the lightbox is open. In the strip-only test below it is a single element.

- [ ] **Step 6: Update the existing `conversation-images.test.tsx`**

Replace the test at line 218 (`"a failed save alerts the message and re-enables the button"`) with:

```tsx
  it("a failed save shows an inline line, calls no alert, and re-enables the button", async () => {
    vi.mocked(setPrimaryImage).mockRejectedValueOnce(new Error("Unauthorized"));
    renderStrip();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use this one" }));
    });
    expect(screen.getByTestId("inline-notice")).toHaveTextContent(SET_PRIMARY_IMAGE_FAILED);
    expect(window.alert).not.toHaveBeenCalled();
    const btn = screen.getByRole("button", { name: "Use this one" });
    expect(btn).toBeEnabled();
    expect(screen.queryByText(CURRENT_COPY)).toBeNull();
    expect(thumb(1)).toHaveAttribute("aria-current", "true");
  });
```

Add the import at the top of the file: `import { SET_PRIMARY_IMAGE_FAILED } from "@/lib/action-copy";`. **Keep** the `vi.spyOn(window, "alert")` in `beforeEach` (line 42) — it is now what makes `expect(window.alert).not.toHaveBeenCalled()` meaningful and stops jsdom's "not implemented" noise if a regression reintroduces a call.

- [ ] **Step 7: Run the three test files to verify they pass**

Run: `npx vitest run "src/app/d/[imageId]/__tests__"`
Expected: PASS — all files in the directory green, including the pre-existing buy-hero/buy-panel/publish-cta suites.

- [ ] **Step 8: Verify no alerts remain in this directory**

Run: `grep -rn "alert(" "src/app/d" --include='*.tsx' | grep -v __tests__ | grep -v 'role="alert"'`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add "src/app/d/[imageId]"
git commit -m "$(cat <<'EOF'
Image detail page: inline notices in place of five alerts

Open/delete conversation, start-from-image, and "Use this one" all keep
their control on screen, so each reports into a line beneath it rather
than a browser dialog. deleteDesign's { error } refusal is still shown
verbatim; thrown errors get our own copy, since prod masks them behind a
Next.js digest.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 3: /design thread — notice sheet (3 sites)

**Files:**
- Modify: `src/app/design/design-client.tsx` (lines 612, 685, 697)
- Modify: `src/lib/design-view.ts` (add one pure helper)
- Modify: `src/lib/__tests__/design-view.test.ts` (add the helper's tests; create the file only if it does not exist — check first with `ls src/lib/__tests__/ | grep design-view`)

**Interfaces:**
- Consumes: `useNotice` from `@/components/ui`; `DELETE_IMAGE_ERROR`, `CLOSE_CONVERSATION_ERROR`, `REOPEN_CONVERSATION_ERROR`, `START_FROM_IMAGE_ERROR` from `@/lib/action-copy`.
- Produces: `conversationToggleError(closed: boolean): { title: string; body?: string }` exported from `@/lib/design-view`.

- [ ] **Step 1: Write the failing test for the pure helper**

The one branching decision in this task is which of the two conversation-toggle messages to show, and `design-client.tsx` is a ~900-line client container with no component test today. Pull that decision into `design-view.ts`, where it is testable in the node environment, and test it there.

Append to `src/lib/__tests__/design-view.test.ts`:

```ts
import { conversationToggleError } from "../design-view";
import { CLOSE_CONVERSATION_ERROR, REOPEN_CONVERSATION_ERROR } from "../action-copy";

describe("conversationToggleError", () => {
  it("reports a failed reopen when the conversation was closed", () => {
    expect(conversationToggleError(true)).toEqual(REOPEN_CONVERSATION_ERROR);
  });

  it("reports a failed close when the conversation was open", () => {
    expect(conversationToggleError(false)).toEqual(CLOSE_CONVERSATION_ERROR);
  });
});
```

(Match the file's existing import style — if it already imports from `"../design-view"`, add the name to that import instead of adding a second one.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/__tests__/design-view.test.ts`
Expected: FAIL — `conversationToggleError` is not exported.

- [ ] **Step 3: Add the helper to `src/lib/design-view.ts`**

```ts
import { CLOSE_CONVERSATION_ERROR, REOPEN_CONVERSATION_ERROR } from "./action-copy";

/**
 * Which notice a failed Close/Reopen shows. `closed` is the state the
 * conversation was in when the toggle was pressed, so a failure while closed
 * means the reopen did not happen.
 */
export function conversationToggleError(closed: boolean): { title: string; body?: string } {
  return closed ? REOPEN_CONVERSATION_ERROR : CLOSE_CONVERSATION_ERROR;
}
```

Put the import with the file's other imports, not mid-file.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/__tests__/design-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `useNotice` into `design-client.tsx`**

Add to the `@/components/ui` import (it currently imports `Button`):

```tsx
import { Button, useNotice } from "@/components/ui";
```

Add to the `@/lib/design-view` import (it currently imports `isDesignEmpty, sourcesToGalleryImages`):

```tsx
import { isDesignEmpty, sourcesToGalleryImages, conversationToggleError } from "@/lib/design-view";
```

Add:

```tsx
import { DELETE_IMAGE_ERROR, START_FROM_IMAGE_ERROR } from "@/lib/action-copy";
```

Inside the component body, next to the other hook calls:

```tsx
  const { notice, element: noticeSheet } = useNotice();
```

Convert the three handlers:

```tsx
  async function handleDeleteImage(imageId: string) {
    const deleted = images.find((img) => img.id === imageId);
    try {
      await deleteDesignImage(designId.current, imageId);
    } catch {
      // The server's refusal reason ("…referenced by an order") does not
      // survive to the client in production — Next masks a thrown
      // server-action error behind a digest — so say it in our own words.
      notice(DELETE_IMAGE_ERROR);
      return;
    }
    // ...rest of the handler unchanged...
  }
```

```tsx
  async function handleToggleClosed() {
    try {
      if (closed) {
        await reopenConversation(designId.current);
        setClosed(false);
      } else {
        await closeConversation(designId.current);
        setClosed(true);
      }
    } catch {
      notice(conversationToggleError(closed));
    }
  }
```

```tsx
  async function handleStartFromImage(imageId: string) {
    try {
      const { designId: newId } = await startConversationFromImage(imageId);
      window.location.assign(`/design?id=${newId}`);
    } catch {
      notice(START_FROM_IMAGE_ERROR);
    }
  }
```

`DELETE_IMAGE_ERROR` and friends are `as const` object literals with `title`/`body`, which is exactly `NoticeOptions` minus the optional `closeLabel` — they pass straight through with no spreading.

- [ ] **Step 6: Render the sheet**

Find where `<PublishModal … />` is rendered in this component's returned tree and render `{noticeSheet}` as its sibling, at the same nesting level. This is the one wiring step no unit test covers, so read the surrounding JSX and confirm the element is inside the component's returned tree and not inside a conditionally-mounted branch (it must render whether or not the lightbox, drawer, or publish modal is open).

- [ ] **Step 7: Attempt a component test for one converted handler — bounded**

Try to render `DesignClient` in jsdom and drive the Close/Reopen failure path. Budget: mocking `./actions`, `next/navigation`, and `@/lib/design-thread-cache` is acceptable. **If the mount needs more than those three module mocks, stop, delete the attempt, and record in the ledger that `design-client.tsx` is covered by the pure helper test plus the Task 5 guard test only.** Do not spend the task's time fighting a container mount; the helper carries the only branching logic, and the smoke in the PR body covers the wiring.

- [ ] **Step 8: Verify no alerts remain in this file**

Run: `grep -n "alert(" src/app/design/design-client.tsx | grep -v 'role="alert"'`
Expected: no output.

Run: `npx vitest run src/app/design src/lib/__tests__/design-view.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/design/design-client.tsx src/lib/design-view.ts src/lib/__tests__/design-view.test.ts
git commit -m "$(cat <<'EOF'
/design thread: notice sheet in place of three alerts

Delete-image, Close/Reopen, and start-from-image all fire from a
lightbox, drawer, or header with no stable inline slot, so each reports
through the one-button sheet. The Close/Reopen message choice moves into
a pure conversationToggleError() so it is testable outside the container.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 4: Admin — inline action results (11 sites)

**Files:**
- Modify: `src/app/admin/page.tsx` (lines 80, 98, 101, 107)
- Modify: `src/app/admin/orders/[id]/page.tsx` (lines 63, 81, 84, 90, 108, 111, 115)
- Create: `src/app/admin/__tests__/admin-action-result.test.ts`

**Interfaces:**
- Consumes: `InlineNotice` and `InlineNoticeTone` from `@/components/ui`; the `ADMIN_*` constants and `adminRecovered` / `adminCannotRecover` / `adminCannotRefund` builders from `@/lib/action-copy`.
- Produces: nothing later tasks depend on.

Both pages get the same shape. The list page keys its result by order id, because it renders a row per order and the line belongs to the row whose button was pressed; the detail page has one order and so needs no key.

- [ ] **Step 1: Write the failing test for the copy builders**

Both admin pages are large `useEffect`-driven containers that fetch on mount; a component test would be mostly mock scaffolding. The decisions worth pinning are the strings themselves and the ok/not-ok branch, so test the builders directly.

Create `src/app/admin/__tests__/admin-action-result.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ADMIN_ALREADY_REFUNDED,
  ADMIN_RECOVER_ARCHIVE_HINT,
  ADMIN_REFUND_ISSUED,
  adminCannotRecover,
  adminCannotRefund,
  adminRecovered,
} from "@/lib/action-copy";

describe("admin action-result copy", () => {
  it("names the action a recovery took", () => {
    expect(adminRecovered("submitted")).toBe("Recovered: submitted");
  });

  it("carries the server's reason into the cannot-recover line", () => {
    expect(adminCannotRecover("session never paid")).toBe("Cannot recover: session never paid");
  });

  it("carries the server's reason into the cannot-refund line", () => {
    expect(adminCannotRefund("no charge")).toBe("Cannot refund: no charge");
  });

  it("keeps the archive hint out of the headline", () => {
    expect(adminCannotRecover("x")).not.toContain(ADMIN_RECOVER_ARCHIVE_HINT);
  });

  it("distinguishes a fresh refund from an already-refunded order", () => {
    expect(ADMIN_REFUND_ISSUED).not.toBe(ADMIN_ALREADY_REFUNDED);
  });
});
```

- [ ] **Step 2: Run it to verify it fails or passes**

Run: `npx vitest run src/app/admin/__tests__/admin-action-result.test.ts`
Expected: PASS immediately — Task 1 already wrote the constants. This test is a regression pin on the copy, not a red-first cycle; note that in the ledger and move on. (If it fails, Task 1's module is wrong — fix `action-copy.ts`, not the test.)

- [ ] **Step 3: Convert `src/app/admin/page.tsx`**

Add to the `@/components/ui` import: `InlineNotice`, and `type InlineNoticeTone`. Add:

```tsx
import {
  ADMIN_RECOVER_ARCHIVE_HINT,
  ADMIN_RECOVER_FAILED,
  ADMIN_RETRY_FAILED,
  adminCannotRecover,
  adminRecovered,
} from "@/lib/action-copy";
```

State, next to `retrying`/`recovering`:

```tsx
  // One result line at a time, keyed to the row whose button was pressed —
  // admin acts on one order and then reads what happened to it.
  const [actionResult, setActionResult] = useState<{
    orderId: string;
    tone: InlineNoticeTone;
    message: string;
    hint?: string;
  } | null>(null);
```

Handlers:

```tsx
  async function handleRetry(orderId: string) {
    const ok = await confirm({
      title: "Retry Printful submission for this order?",
      confirmLabel: "Retry",
    });
    if (!ok) return;
    setRetrying(orderId);
    setActionResult(null);
    try {
      await retryPrintfulSubmission(orderId);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ orderId, tone: "negative", message: ADMIN_RETRY_FAILED, hint: message });
    } finally {
      setRetrying(null);
    }
  }

  async function handleRecover(orderId: string) {
    const ok = await confirm({
      title: "Replay the Stripe webhook for this stuck pending order?",
      body: "This will charge through the full flow: paid → submitted → emails.",
      confirmLabel: "Recover",
      danger: true,
    });
    if (!ok) return;
    setRecovering(orderId);
    setActionResult(null);
    try {
      const result = await recoverPendingOrder(orderId);
      if (result.ok) {
        setActionResult({ orderId, tone: "neutral", message: adminRecovered(result.action) });
        await fetchData();
      } else {
        setActionResult({
          orderId,
          tone: "negative",
          message: adminCannotRecover(result.reason),
          hint: ADMIN_RECOVER_ARCHIVE_HINT,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ orderId, tone: "negative", message: ADMIN_RECOVER_FAILED, hint: message });
    } finally {
      setRecovering(null);
    }
  }
```

Render: find the JSX that renders this order's Retry / Recover buttons (search for `retrying === order.id`). Directly beneath that button group, still inside the same cell/row container, add:

```tsx
                    {actionResult?.orderId === order.id && (
                      <InlineNotice
                        testId="admin-action-result"
                        tone={actionResult.tone}
                        message={actionResult.message}
                        hint={actionResult.hint}
                      />
                    )}
```

If the buttons sit in a table cell, keep the line inside that `<td>`; do not add a row.

- [ ] **Step 4: Convert `src/app/admin/orders/[id]/page.tsx`**

Same shape, unkeyed. Add to the `@/components/ui` import: `InlineNotice`, `type InlineNoticeTone`. Add:

```tsx
import {
  ADMIN_ALREADY_REFUNDED,
  ADMIN_RECOVER_ARCHIVE_HINT,
  ADMIN_RECOVER_FAILED,
  ADMIN_REFUND_FAILED,
  ADMIN_REFUND_ISSUED,
  ADMIN_RETRY_FAILED,
  adminCannotRecover,
  adminCannotRefund,
  adminRecovered,
} from "@/lib/action-copy";
```

State:

```tsx
  const [actionResult, setActionResult] = useState<{
    tone: InlineNoticeTone;
    message: string;
    hint?: string;
  } | null>(null);
```

Handlers — each clears `actionResult` right after its `setXxx(true)` and reports into it:

```tsx
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ tone: "negative", message: ADMIN_RETRY_FAILED, hint: message });
    } finally {
```

```tsx
      const result = await recoverPendingOrder(params.id);
      if (result.ok) {
        setActionResult({ tone: "neutral", message: adminRecovered(result.action) });
        await fetchOrder();
      } else {
        setActionResult({
          tone: "negative",
          message: adminCannotRecover(result.reason),
          hint: ADMIN_RECOVER_ARCHIVE_HINT,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ tone: "negative", message: ADMIN_RECOVER_FAILED, hint: message });
    } finally {
```

```tsx
      const result = await refundOrder(params.id);
      if (result.ok) {
        setActionResult({
          tone: "neutral",
          message: result.refunded ? ADMIN_REFUND_ISSUED : ADMIN_ALREADY_REFUNDED,
        });
        await fetchOrder();
      } else {
        setActionResult({ tone: "negative", message: adminCannotRefund(result.reason) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionResult({ tone: "negative", message: ADMIN_REFUND_FAILED, hint: message });
    } finally {
```

Render, directly beneath the Retry / Recover / Refund / Archive button group:

```tsx
        {actionResult && (
          <InlineNotice
            testId="admin-action-result"
            tone={actionResult.tone}
            message={actionResult.message}
            hint={actionResult.hint}
          />
        )}
```

- [ ] **Step 5: Verify no alerts remain in admin**

Run: `grep -rn "alert(" src/app/admin --include='*.tsx' | grep -v __tests__ | grep -v 'role="alert"'`
Expected: no output.

Run: `npx vitest run src/app/admin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin
git commit -m "$(cat <<'EOF'
Admin: one inline result line per action, replacing eleven alerts

Retry, Recover, and Refund report into a line beneath their buttons —
list page keyed by order id, detail page unkeyed. Success results
(Recovered, Refund issued) share the slot on the neutral tone, and the
raw error rides along as a hint, which is what the one operator wants.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 5: Guard test

**Files:**
- Create: `src/app/__tests__/no-window-alert.test.ts`

**Interfaces:**
- Consumes: nothing. Reads the source tree from disk, in the style of `src/app/__tests__/globals-css.test.ts`.
- Produces: nothing.

- [ ] **Step 1: Write the guard test**

```ts
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

// The alert sweep (this branch) replaced every browser alert() with an
// in-page surface: NoticeSheet for a control on an overlay with no stable
// inline slot, InlineNotice for one that stays on screen. A native alert is
// unstyleable, blocks the main thread, is invisible to our component tests,
// and on iOS Safari reads as a browser-chrome interruption rather than part
// of the product — the same reasons #195/#200 removed window.confirm. This
// guard makes a reintroduction fail CI instead of shipping.
//
// Sibling of globals-css.test.ts: both assert something about source text
// that no rendering test can see.
const SRC = join(__dirname, "../..");

// Matches `alert(` and `window.alert(` but not `showAlert(`, `x.alert(`, or
// the attribute `role="alert"` (no call parens). The lookbehind rejects a
// preceding identifier character or dot.
const ALERT_CALL = /(?<![\w.$])(?:window\.)?alert\s*\(/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("no browser alert() in product code", () => {
  it("finds source files to scan", () => {
    // Guards the guard: a broken walk would make the assertion below vacuous.
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it("has no alert() call sites left outside tests", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => ALERT_CALL.test(readFileSync(file, "utf-8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/app/__tests__/no-window-alert.test.ts`
Expected: PASS — Tasks 2–4 removed all 19 sites. If it lists offenders, they are real; fix them before continuing rather than loosening the regex.

- [ ] **Step 3: Prove the guard actually bites**

Temporarily add `window.alert("x");` inside any function body in `src/app/cart/page.tsx`, run the test, confirm it FAILS and names `app/cart/page.tsx`, then revert the edit with `git checkout -- src/app/cart/page.tsx` and re-run to confirm it passes again. A guard test that has never gone red is not known to work.

- [ ] **Step 4: Commit**

```bash
git add src/app/__tests__/no-window-alert.test.ts
git commit -m "$(cat <<'EOF'
Guard test: fail CI if a browser alert() comes back

Verified to bite by temporarily reintroducing one call site.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 6: Full verification

**Files:** none — this task changes nothing unless something is red.

- [ ] **Step 1: Run the full gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint 0 errors, typecheck clean, all tests pass (baseline was 1594; expect ~1615+), build succeeds.

If anything is red, fix it and re-run the whole chain — not just the failing command.

- [ ] **Step 2: Confirm the sweep is complete**

Run: `grep -rn "alert(" src --include='*.tsx' --include='*.ts' | grep -v __tests__ | grep -v 'role="alert"'`
Expected: no output.

- [ ] **Step 3: Commit anything the gate required**

Only if Step 1 needed fixes. Same trailer lines.

---

## Self-review

**Spec coverage.** Every one of the 19 sites is assigned to a task and classified: 3 (a) in Task 3, 5 (b) in Task 2, 11 (b) in Task 4. The notice-sheet component test (renders message, Close dismisses, focus on Close) is Task 1 Step 1. Per-site tests: Task 2 creates two new test files and updates the existing alert-asserting test, all three asserting `window.alert` was not called; Task 3 covers its one branching decision through a pure helper and states the bounded fallback for the container; Task 4 pins the copy branches. The guard test is Task 5, and Task 5 Step 3 proves it bites. Copy constants: Task 1 Step 5, all sites import from there.

**Placeholders.** None: every code step carries the actual code, every command carries its expected output. Task 3 Step 6 and Task 4 Step 3 say "find the JSX" rather than quoting it, because the exact surrounding markup in those two large files is best read at edit time — each states the constraint the placement must satisfy.

**Type consistency.** `InlineNoticeProps` fields (`message`, `hint`, `tone`, `className`, `testId`) are used with exactly those names in Tasks 2 and 4. `NoticeOptions` (`title`, `body`, `closeLabel`) matches the shape of the `as const` copy objects passed in Task 3. `useNotice` returns `{ notice, element }` and is destructured as `{ notice, element: noticeSheet }`. `conversationToggleError` is declared in Task 3 Step 3 and consumed in Step 5 under the same name. `InlineNoticeTone` is exported from `index.ts` in Task 1 Step 6 and imported as a type in Task 4.

## Deferred, deliberately

- `deleteDesignImage` still *throws* its refusal (`"Can't delete this image — it's referenced by an order."`), which production masks behind a digest. Converting it to an `{ error }` return like `deleteDesign` would let the real reason reach the user; that changes what the action does, which this slice excludes.
- `design-client.tsx` has no container-level component test. The wiring of `{noticeSheet}` into its tree is covered by the prod smoke, not by CI.
