# Paper sweep: admin desk + auth pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the four `/admin*` pages and the four `(auth)` pages to the Paper look (#188 slice 7, part 2), and fix the parked `handleAddTag` stale-notice bug on both admin pages.

**Architecture:** Presentation-only edits inside `src/app/admin/**` and `src/app/(auth)/**`. No server action, no auth gate, no data shape changes. The single behavioural change is `handleAddTag` clearing `actionResult` before it fires, matching every sibling handler on both pages. Two new component tests (Testing Library, mocked `../actions`) pin the notice-clearing; one new component test pins `/sign-in`'s `/studio` default.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (Paper tokens in `src/app/globals.css`), Vitest + Testing Library.

**Spec:** `docs/ux-design-review-2026-09.md` — route verdicts for `/admin*` ("mechanical sweep only; tables on paper with hairlines are the natural fit") and Auth ("ink-bordered inputs, outlined submit"), plus the "Shared components audit".

## Global Constraints

- **Light only.** No dark literals anywhere: no `bg-black*`, `text-white`, `bg-gray-*`, `text-red-*`, raw dark hexes.
- **Tokens only.** `bg-background`, `text-foreground`, `text-text-muted`, `text-text-faint`, `border-border`, `border-foreground` (ink), `hover:border-border-hover`, `bg-surface`, `bg-surface-raised`, `bg-surface-well`, `text-positive`, `text-negative`. `--accent-rose` is reserved for the wordmark and the Studio/landing Generate button — **it appears nowhere in this slice**.
- **Mono label spec (verbatim):** `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase` for section labels, ids, dates, statuses.
- **Body 14px** (`text-sm`). **Links underlined:** `underline underline-offset-[3px]`.
- **1px borders, no shadows.** Every `border-*`/`divide-*` utility must name a colour — Tailwind v4's default border colour is `currentColor`, so a bare `border-b` or `divide-y` silently paints ink.
- **44px minimum tap targets on phone** (`min-h-11`).
- **ONE primary action per screen** (`Button variant="primary"`, outlined ink); everything else `secondary`, `ghost`, or a plain underlined link. Never add opacity hacks for disabled — the primitive already renders dotted border + muted text.
- **Do NOT edit** `src/components/ui/*`, `src/app/globals.css`, or anything outside `src/app/admin/**`, `src/app/(auth)/**`, and `docs/superpowers/**`.
- **No copy changes** beyond deleting a marketing sentence (there are none on these pages). Persona C: plain, literal, no exclamation marks.
- **Keep every `data-testid` and every action.** `data-loop-redact=""` attributes stay exactly where they are (they keep PII out of feedback captures).
- `catch (err)` + `err instanceof Error ? err.message : String(err)`. `no-explicit-any` is an error in product code (off in tests).
- Migration-free. If a schema change looks necessary, stop and report.

## Rulings already made (do not re-litigate)

1. **Colour on figures:** only figures that are already coloured today keep colour. On `/admin` that is Stripe Fees (`text-negative`) and the per-row Profit cell (`text-positive`/`text-negative` by sign). Orders / Revenue / COGS / Gross Profit stay ink. Ledger amounts on the detail page keep their existing positive/negative mapping — they are literal money-in/money-out.
2. **Dense-table controls use hairline at rest, ink on hover/focus** (`border-border hover:border-border-hover focus:border-border-hover`). That is exactly what `--border-hover` exists for. Standalone controls in a Card (the detail page's classification `<select>`) get a 1px ink border (`border-foreground`), matching the `Input` primitive's stated rationale that hairline is too faint for a control outline.
3. **The inline `+tag` input stays a bare `<input>`, not the `Input` primitive** — it lives inside a 12-column table cell and a full primitive would blow the row's height. It gets a mono face and a bottom hairline that inks on focus.
4. **Archived rows on `/admin` keep `opacity-50`.** The no-opacity rule in the design pass is scoped to disabled *buttons* ("a faded button looks like a rendering glitch"); a whole dimmed row is a legitimate list treatment and the row already carries an explicit "archived" marker.
5. **Auth page headings are not restyled.** The sweep is tokens, borders, controls, and mono — not the type scale. `text-2xl font-bold` on four centred auth headings is out of scope; changing it is churn without a spec line.
6. **`handleAddTag` gets `setActionResult(null)` and nothing else.** It is fire-and-forget with no try/catch and writes no line of its own; the bug is purely that a stale Retry/Recover/Refund line survives the interaction.

---

## File Structure

- `src/app/(auth)/sign-in/page.tsx` — modify. Error token, link offsets, submit tap target.
- `src/app/(auth)/sign-up/page.tsx` — modify. Same.
- `src/app/(auth)/forgot-password/page.tsx` — modify. Same.
- `src/app/(auth)/reset-password/page.tsx` — modify. Same.
- `src/app/(auth)/__tests__/sign-in-redirect.test.tsx` — **create**. Pins the `/studio` default and the same-origin `?next=` restriction.
- `src/app/admin/page.tsx` — modify. Summary block, filters, table, tag/classification controls, `handleAddTag` clear.
- `src/app/admin/__tests__/admin-tag-notice.test.tsx` — **create**. Pins the list page's notice clearing.
- `src/app/admin/orders/[id]/page.tsx` — modify. Header, cards, ledger timeline, tag/classification controls, `handleAddTag` clear.
- `src/app/admin/orders/[id]/__tests__/order-detail-tag-notice.test.tsx` — **create**. Pins the detail page's notice clearing.
- `src/app/admin/published/page.tsx` — modify. Well, rank input, hide/unhide, hidden marker, dates.
- `src/app/admin/errors/page.tsx` — modify. Hairline table, mono head/timestamps, stack well.

---

### Task 1: Auth pages Paper sweep + sign-in default test

**Files:**
- Modify: `src/app/(auth)/sign-in/page.tsx`
- Modify: `src/app/(auth)/sign-up/page.tsx`
- Modify: `src/app/(auth)/forgot-password/page.tsx`
- Modify: `src/app/(auth)/reset-password/page.tsx`
- Test: `src/app/(auth)/__tests__/sign-in-redirect.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks rely on.

**Context you need:** All four pages already route their inputs through the `Input` primitive and their submits through `Button` — verify that stays true and change nothing about the form logic. `Input` already renders `border border-foreground` (ink) with an ink focus ring, so "ink-bordered inputs" is already satisfied by the primitive; do not add border classes at the call sites. `Button variant="primary"` (the default) is already the outlined ink submit.

The only real defects are: `text-red-600` on four error lines (a raw Tailwind red, not the `--negative` token), links that underline without the house `underline-offset-[3px]`, and submit buttons at ~36px on a phone.

- [ ] **Step 1: Write the failing test**

Create `src/app/(auth)/__tests__/sign-in-redirect.test.tsx`:

```tsx
/**
 * Nav model A (#219) made /studio the post-sign-in home. Nothing pinned it,
 * so a future sweep could quietly retarget it. This also pins the
 * same-origin restriction on ?next= (open-redirect guard).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SignInPage from "../sign-in/page";

const push = vi.fn();
const signInEmail = vi.fn();
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => search,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: (...args: unknown[]) => signInEmail(...args) },
  },
}));

async function submit() {
  fireEvent.change(screen.getByPlaceholderText("Email"), {
    target: { value: "a@b.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: "password123" },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

beforeEach(() => {
  push.mockReset();
  signInEmail.mockReset();
  signInEmail.mockResolvedValue({ error: null });
  search = new URLSearchParams();
});

describe("sign-in redirect target", () => {
  it("defaults to /studio", async () => {
    render(<SignInPage />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/studio"));
  });

  it("honors a same-origin ?next=", async () => {
    search = new URLSearchParams("next=/cart");
    render(<SignInPage />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cart"));
  });

  it("refuses a protocol-relative ?next= and falls back to /studio", async () => {
    search = new URLSearchParams("next=//evil.example.com");
    render(<SignInPage />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/studio"));
  });

  it("shows the failure line on the negative token, never a raw red", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid credentials" } });
    render(<SignInPage />);
    await submit();
    const line = await screen.findByText("Invalid credentials");
    expect(line.className).toContain("text-negative");
    expect(line.className).not.toContain("red-600");
  });
});
```

- [ ] **Step 2: Run it and watch the last case fail**

Run: `npx vitest run "src/app/(auth)/__tests__/sign-in-redirect.test.tsx"`
Expected: the three redirect cases PASS (that behaviour already exists — they are regression pins), the token case FAILS on `text-red-600`.

- [ ] **Step 3: Sweep all four auth pages**

In each of the four pages, make exactly these edits:

`sign-in/page.tsx`:
- `<p className="text-red-600 text-sm">` → `<p className="text-negative text-sm">`
- `<Link href="/forgot-password" className="text-sm text-text-muted underline">` → `className="text-sm text-text-muted underline underline-offset-[3px] hover:text-foreground"`
- `<Link href="/sign-up" className="underline">` → `className="underline underline-offset-[3px]"`
- `<Button type="submit" disabled={loading} className="w-full">` → `className="w-full min-h-11"`

`sign-up/page.tsx`:
- `text-red-600 text-sm` → `text-negative text-sm`
- `<Link href="/sign-in" className="underline">` → `className="underline underline-offset-[3px]"`
- submit `className="w-full"` → `className="w-full min-h-11"`

`forgot-password/page.tsx`:
- `text-red-600 text-sm` → `text-negative text-sm`
- both `<Link href="/sign-in" className="text-sm underline">` / `className="underline">` → add `underline-offset-[3px]`
- submit `className="w-full"` → `className="w-full min-h-11"`

`reset-password/page.tsx`:
- `text-red-600 text-sm` → `text-negative text-sm`
- `<Link href="/forgot-password" className="text-sm underline">` → add `underline-offset-[3px]`
- `<Link href="/sign-in" className="underline">` → add `underline-offset-[3px]`
- both `<Button className="w-full">` (the done-state "Sign in" and the submit) → `className="w-full min-h-11"`

Do not touch the headings, the copy, the `Suspense` wrappers, or any form logic.

- [ ] **Step 4: Run the test and the whole auth folder**

Run: `npx vitest run "src/app/(auth)"`
Expected: all four cases PASS.

- [ ] **Step 5: Verify no raw reds and no bare underlines survive**

Run: `grep -rn "red-600\|red-500" "src/app/(auth)"` → expected: no output.
Run: `grep -rn 'className="underline"\|className="text-sm underline"' "src/app/(auth)"` → expected: no output.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(auth)"
git commit -m "Paper sweep: auth pages on the negative token, underline offsets, 44px submits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN"
```

---

### Task 2: `/admin` list — ruled summary block, hairline table, tag-notice fix

**Files:**
- Modify: `src/app/admin/page.tsx`
- Test: `src/app/admin/__tests__/admin-tag-notice.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing later tasks rely on. `data-testid="admin-action-result"` on the `InlineNotice` must survive — Task 3's test uses the same id on the detail page.

**Context you need:** `src/app/admin/page.tsx` is a client component. It imports server actions from `./actions` (mockable in tests, see `src/app/cart/__tests__/cart-page.test.tsx` for the pattern) and pure helpers from `@/lib/admin-filters` (`filterReducer`, `applyFilters`, `applySort`, `computeSummary`). `useConfirm` renders a `ConfirmSheet` whose confirm button carries `data-testid="confirm-sheet-confirm"`.

The bug: every handler on this page opens with `setActionResult(null)` except `handleAddTag` (line ~160), so a stale "Retry failed"/"Cannot recover" line survives an Add-Tag interaction.

- [ ] **Step 1: Write the failing test**

Create `src/app/admin/__tests__/admin-tag-notice.test.tsx`:

```tsx
/**
 * Parked in the #218 alert sweep: handleAddTag was the one handler that did
 * not clear the previous result line, so a stale Retry/Recover failure
 * survived the next interaction and read as a fresh failure of the tag add.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminPage from "../page";

const getAdminData = vi.fn();
const retryPrintfulSubmission = vi.fn();
const setOrderTags = vi.fn();

vi.mock("../actions", () => ({
  getAdminData: () => getAdminData(),
  retryPrintfulSubmission: (...a: unknown[]) => retryPrintfulSubmission(...a),
  recoverPendingOrder: vi.fn(),
  archiveOrder: vi.fn(),
  unarchiveOrder: vi.fn(),
  setOrderTags: (...a: unknown[]) => setOrderTags(...a),
  setOrderClassification: vi.fn(),
}));

const PAID_ORDER = {
  id: "11111111-2222-3333-4444-555555555555",
  displayName: null,
  status: "paid",
  userEmail: "buyer@example.com",
  designImageUrl: null,
  lines: [{ blankId: "bella-canvas-3001", size: "M", color: "Black" }],
  totalPrice: 24.12,
  printfulCost: null,
  printfulOrderId: null,
  stripeSessionId: null,
  trackingUrl: null,
  trackingNumber: null,
  createdAt: new Date("2026-09-01T12:00:00Z"),
  archivedAt: null,
  classification: null,
  tags: null,
};

beforeEach(() => {
  getAdminData.mockReset();
  retryPrintfulSubmission.mockReset();
  setOrderTags.mockReset();
  getAdminData.mockResolvedValue({ orders: [PAID_ORDER], ledger: [] });
  retryPrintfulSubmission.mockRejectedValue(new Error("printful down"));
  setOrderTags.mockResolvedValue(undefined);
});

async function raiseStaleNotice() {
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  fireEvent.click(await screen.findByTestId("confirm-sheet-confirm"));
  await screen.findByTestId("admin-action-result");
}

describe("/admin add-tag clears the previous result line", () => {
  it("removes a stale failure line when a tag is added", async () => {
    render(<AdminPage />);
    await raiseStaleNotice();

    const input = screen.getByPlaceholderText("+tag");
    fireEvent.change(input, { target: { value: "vip" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.queryByTestId("admin-action-result")).toBeNull()
    );
    expect(setOrderTags).toHaveBeenCalledWith(PAID_ORDER.id, ["vip"]);
  });

  it("leaves the line alone when the typed tag is empty", async () => {
    render(<AdminPage />);
    await raiseStaleNotice();

    const input = screen.getByPlaceholderText("+tag");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("admin-action-result")).toBeInTheDocument();
    expect(setOrderTags).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify the first case fails**

Run: `npx vitest run src/app/admin/__tests__/admin-tag-notice.test.tsx`
Expected: "removes a stale failure line" FAILS (the notice is still in the document); the empty-tag case PASSES.

- [ ] **Step 3: Fix `handleAddTag`**

In `src/app/admin/page.tsx`, add the clear as the first statement after the early returns — **after** the empty/duplicate guards, so a no-op keypress does not wipe a line the operator is still reading:

```tsx
  function handleAddTag(orderId: string, tag: string, currentTags: string[] | null) {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;
    const tags = currentTags ?? [];
    if (tags.includes(trimmed)) return;
    // Clear the previous result line: this is a new interaction, and a stale
    // Retry/Recover failure sitting next to a freshly added tag reads as a
    // failure of the tag add.
    setActionResult(null);
    const next = [...tags, trimmed];
    setOrderTags(orderId, next);
    updateOrder(orderId, { tags: next });
  }
```

- [ ] **Step 4: Run the test to verify both cases pass**

Run: `npx vitest run src/app/admin/__tests__/admin-tag-notice.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit the fix before the visual sweep**

```bash
git add src/app/admin/page.tsx src/app/admin/__tests__/admin-tag-notice.test.tsx
git commit -m "admin: adding a tag clears the previous result line

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN"
```

- [ ] **Step 6: Replace the five summary Cards with one ruled block**

Replace the whole `{/* Financial summary */}` block. Drop `Card` from the import if nothing else on the page uses it (it does not — check and remove it from the `@/components/ui` import list if unused, otherwise lint will fail).

```tsx
      {/* Financial summary — a ruled block of figures, not five panels.
          Colour only where a figure is already signed money-out (fees). */}
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border-t border-border mb-8">
        {[
          { label: "Orders", value: String(summary.orderCount) },
          {
            label: filterLabel ? `${filterLabel} Revenue` : "Revenue",
            value: `$${summary.revenue.toFixed(2)}`,
          },
          {
            label: "Stripe Fees",
            value: `$${Math.abs(summary.stripeFees).toFixed(2)}`,
            tone: "text-negative",
          },
          { label: "COGS (Printful)", value: `$${summary.cogs.toFixed(2)}` },
          { label: "Gross Profit", value: `$${summary.grossProfit.toFixed(2)}` },
        ].map((f) => (
          <div key={f.label} className="border-b border-border py-3 pr-4">
            <dt className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">
              {f.label}
            </dt>
            <dd className={`mt-1 text-sm font-mono ${f.tone ?? "text-foreground"}`}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
```

- [ ] **Step 7: Filters as underlined text, table head as mono labels, rules named**

Header links — add the house offset:

```tsx
          <Link href="/admin/errors" className="text-sm underline underline-offset-[3px] hover:no-underline">
```
(same for `/admin/published`).

Filter buttons — replace the three `className` templates. Define these two constants above the component so the three call sites share them:

```tsx
// Filters are underlined text, not chips: the selected one inks and
// underlines, the rest sit muted. min-h-11 keeps the phone tap target.
const filterOn = "text-xs px-2 min-h-11 text-foreground underline underline-offset-[3px]";
const filterOff = "text-xs px-2 min-h-11 text-text-muted hover:text-foreground";
```

Apply: the `All` button, each classification button, and the `Archived (n)` button all become `className={allSelected ? filterOn : filterOff}` (respectively `filterState.classifications.has(c)` and `filterState.showArchived`).

Table shell:
- `<thead className="border-b text-text-faint text-xs uppercase">` → `<thead className="border-b border-border text-text-muted">`
- Every `<th className="py-3 pr-4">` (both the literal `Order` one and the two inside the `.map`) gains the mono label spec: `className="py-3 pr-4 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase font-normal"`. The sortable one keeps its `cursor-pointer select-none hover:text-foreground` and its `onClick`.
- `<tbody className="divide-y">` → `<tbody className="divide-y divide-border">`

- [ ] **Step 8: Mono the row data and de-chip the inline controls**

Inside the row `.map`, make these edits and no others:

- Order cell: the id `<span className="font-mono">` stays; the sub-id `<div className="font-mono text-text-faint text-[10px] mt-0.5">` → `text-text-muted text-[10px]` (faint on a hover-white row is the wrong end of the ramp for an id you read). The link keeps `underline`; add `underline-offset-[3px]`.
- Classification `<select>`: `className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-foreground cursor-pointer outline-none"` → `className="font-mono text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-surface border border-border hover:border-border-hover focus:border-border-hover text-foreground cursor-pointer outline-none"`.
- Tag chips: `className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-muted cursor-pointer hover:line-through"` → `className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted cursor-pointer hover:line-through"`.
- `+tag` input: `className="text-[10px] w-12 bg-transparent text-text-faint border-none outline-none placeholder:text-text-faint"` → `className="font-mono text-[10px] w-12 bg-transparent text-foreground border-b border-border focus:border-foreground outline-none placeholder:text-text-muted"`. **Keep `placeholder="+tag"` exactly** — the new test selects on it.
- `×N items` marker: `className="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-muted"` → `className="mt-1 inline-block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"`.
- `archived` marker: `className="text-xs text-text-faint"` → `className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"`.
- Revenue cell `className="py-3 pr-4 font-medium"` → `className="py-3 pr-4 font-mono"`.
- COGS cell → add `font-mono` (keep `text-xs text-text-muted`).
- Profit cell `className="py-3 pr-4 text-xs font-medium"` → `className="py-3 pr-4 text-xs font-mono"`; the inner signed `<span>` keeps its positive/negative class.
- Date cell → add `font-mono` (it is already `text-xs text-text-muted whitespace-nowrap`).
- Printful cell is already `font-mono` — leave it.
- `Track` link: add `underline-offset-[3px]`.

- [ ] **Step 9: Classification reference block**

At the bottom `<details>`:
- `<summary className="text-sm text-text-muted cursor-pointer hover:text-foreground">` → add `underline underline-offset-[3px]`.
- The `FUTURE_CLASSIFICATIONS` chips: `className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-faint mr-1 mb-1"` → `className="inline-block font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted mr-1 mb-1"`.
- The "Planned (not yet in use):" line: `text-xs text-text-faint` → `font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`.
- The empty state `<p className="text-text-faint">No orders.</p>` → `<p className="text-sm text-text-muted">No orders.</p>`.

- [ ] **Step 10: Verify nothing regressed and no unnamed rules survive**

Run: `npx vitest run src/app/admin`
Expected: all pass (the two new tag tests plus the existing three admin suites).

Run: `grep -n 'divide-y"\|border-b"\|border-t"\|bg-surface-raised text-text' src/app/admin/page.tsx`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "Paper sweep: /admin summary as a ruled figure block, hairline order table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN"
```

---

### Task 3: `/admin/orders/[id]` — ruled ledger timeline, mono money, tag-notice fix

**Files:**
- Modify: `src/app/admin/orders/[id]/page.tsx`
- Test: `src/app/admin/orders/[id]/__tests__/order-detail-tag-notice.test.tsx` (create)

**Interfaces:**
- Consumes: the `data-testid="admin-action-result"` convention established on `/admin` (Task 2) — the detail page already uses the same id.
- Produces: nothing.

**Context you need:** Same client-component shape as Task 2. Actions come from `../../actions`, so the mock path in a test living at `src/app/admin/orders/[id]/__tests__/` is `../../../actions`. `useParams` comes from `next/navigation` and must be mocked. `Breadcrumbs` is a real component that calls `useRouter`; the `next/navigation` mock must supply `useRouter`, `useParams`, and `usePathname`.

Two real defects beyond the sweep:
1. `handleAddTag` never clears `actionResult` (same parked bug as Task 2).
2. The ledger timeline's bullet is `bg-border-default` — **there is no `--color-border-default` token**, so that dot has been invisible since the token sweep. It is replaced by ruled rows, not repainted.

- [ ] **Step 1: Write the failing test**

Create `src/app/admin/orders/[id]/__tests__/order-detail-tag-notice.test.tsx`:

```tsx
/**
 * Same parked bug as /admin: handleAddTag left a stale Retry/Recover/Refund
 * failure line on screen next to the freshly added tag.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OrderDetailPage from "../page";

const getOrderDetail = vi.fn();
const retryPrintfulSubmission = vi.fn();
const setOrderTags = vi.fn();

vi.mock("../../../actions", () => ({
  getOrderDetail: (...a: unknown[]) => getOrderDetail(...a),
  retryPrintfulSubmission: (...a: unknown[]) => retryPrintfulSubmission(...a),
  recoverPendingOrder: vi.fn(),
  refundOrder: vi.fn(),
  archiveOrder: vi.fn(),
  unarchiveOrder: vi.fn(),
  setOrderClassification: vi.fn(),
  setOrderTags: (...a: unknown[]) => setOrderTags(...a),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-2222-3333-4444-555555555555" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/orders/11111111-2222-3333-4444-555555555555",
}));

const ORDER = {
  id: "11111111-2222-3333-4444-555555555555",
  displayName: null,
  status: "paid",
  userEmail: "buyer@example.com",
  designImageUrl: null,
  lines: [
    {
      blankId: "bella-canvas-3001",
      size: "M",
      color: "Black",
      quantity: 1,
      placements: {},
      imageUrl: null,
      title: null,
      designedByName: null,
    },
  ],
  totalPrice: 24.12,
  printfulCost: null,
  printfulOrderId: null,
  stripeSessionId: null,
  stripePaymentIntentId: null,
  trackingUrl: null,
  createdAt: new Date("2026-09-01T12:00:00Z"),
  archivedAt: null,
  classification: null,
  tags: null,
  shippingName: null,
  shippingAddress1: null,
  shippingAddress2: null,
  shippingCity: null,
  shippingState: null,
  shippingZip: null,
  shippingCountry: null,
  ledger: [],
};

beforeEach(() => {
  getOrderDetail.mockReset();
  retryPrintfulSubmission.mockReset();
  setOrderTags.mockReset();
  getOrderDetail.mockResolvedValue(ORDER);
  retryPrintfulSubmission.mockRejectedValue(new Error("printful down"));
  setOrderTags.mockResolvedValue(undefined);
});

async function raiseStaleNotice() {
  fireEvent.click(await screen.findByRole("button", { name: /Retry Printful/ }));
  fireEvent.click(await screen.findByTestId("confirm-sheet-confirm"));
  await screen.findByTestId("admin-action-result");
}

describe("order detail add-tag clears the previous result line", () => {
  it("removes a stale failure line when a tag is added", async () => {
    render(<OrderDetailPage />);
    await raiseStaleNotice();

    const input = screen.getByPlaceholderText("+tag");
    fireEvent.change(input, { target: { value: "rush" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.queryByTestId("admin-action-result")).toBeNull()
    );
    expect(setOrderTags).toHaveBeenCalledWith(ORDER.id, ["rush"]);
  });

  it("leaves the line alone when the tag is already present", async () => {
    getOrderDetail.mockResolvedValue({ ...ORDER, tags: ["rush"] });
    render(<OrderDetailPage />);
    await raiseStaleNotice();

    const input = screen.getByPlaceholderText("+tag");
    fireEvent.change(input, { target: { value: "rush" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("admin-action-result")).toBeInTheDocument();
    expect(setOrderTags).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify the first case fails**

Run: `npx vitest run "src/app/admin/orders/[id]"`
Expected: "removes a stale failure line" FAILS; the duplicate-tag case PASSES.

- [ ] **Step 3: Fix `handleAddTag`**

```tsx
  function handleAddTag(tag: string) {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed || !order) return;
    const tags = order.tags ?? [];
    if (tags.includes(trimmed)) return;
    // New interaction: drop the previous result line so a stale
    // Retry/Recover/Refund failure isn't read as a failure of the tag add.
    setActionResult(null);
    const next = [...tags, trimmed];
    setOrderTags(params.id, next);
    setOrder((prev) => (prev ? { ...prev, tags: next } : prev));
  }
```

- [ ] **Step 4: Run the test to verify both pass**

Run: `npx vitest run "src/app/admin/orders/[id]"`
Expected: 2 passed.

- [ ] **Step 5: Commit the fix**

```bash
git add "src/app/admin/orders/[id]"
git commit -m "admin order detail: adding a tag clears the previous result line

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN"
```

- [ ] **Step 6: Sweep the header**

- The header id `<span className="text-sm font-mono text-text-muted">` → `className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted"`.
- The classification chip `<span className="text-xs px-2 py-0.5 rounded bg-surface-raised text-text-muted">` → `<span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted">`.
- `archived` marker `className="text-xs text-text-faint"` → `className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted"`.
- The date `<span className="text-xs text-text-muted ml-auto">` → `className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted ml-auto"`.

- [ ] **Step 7: Sweep the Card section labels and the financials**

Every `<h3 className="text-xs text-text-muted uppercase mb-N">` on this page (there are five: Customer, Product, Financials, Classification & Tags, Ledger, References — six) becomes the mono label spec, keeping its own `mb-*`:

```tsx
<h3 className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted mb-2">
```

Financials amounts get `font-mono`:
- `<span>${order.totalPrice.toFixed(2)}</span>` → `<span className="font-mono">…</span>`
- `<span className="text-negative">-${…}</span>` → add `font-mono`
- the profit `<span className={profit >= 0 ? …}>` → `className={`font-mono ${profit >= 0 ? "text-positive" : "text-negative"}`}`
- the divider `className="flex justify-between border-t border-border pt-1 mt-1"` already names its colour — leave it.

`Printful: {order.printfulOrderId}` line: `className="text-xs text-text-faint"` → `className="font-mono text-xs text-text-muted"`.

- [ ] **Step 8: Sweep the tag + classification controls**

- The standalone classification `<select>`: `className="text-xs px-2 py-1 rounded bg-surface border border-border text-foreground cursor-pointer outline-none"` → `className="text-sm min-h-11 px-2 rounded bg-surface border border-foreground text-foreground cursor-pointer outline-none focus:ring-1 focus:ring-foreground"` (standalone control = ink border, per ruling 2; `min-h-11` for phone).
- Tag chips: `className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-muted cursor-pointer hover:line-through"` → `className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted cursor-pointer hover:line-through"`.
- `+tag` input: `className="text-[10px] w-16 bg-transparent text-text-faint border-none outline-none placeholder:text-text-faint"` → `className="font-mono text-[10px] w-16 bg-transparent text-foreground border-b border-border focus:border-foreground outline-none placeholder:text-text-muted"`. **Keep `placeholder="+tag"`.**
- The "Refunded $X" line `className="text-xs text-text-muted self-center"` → add `font-mono`.

- [ ] **Step 9: Ledger timeline as ruled rows**

Replace the ledger list body (the `<div className="space-y-3">` and its `.map`) with ruled rows and drop the invisible `bg-border-default` dot:

```tsx
              <div className="divide-y divide-border border-t border-border">
                {order.ledger.map((entry) => {
                  const typeInfo = LEDGER_TYPE_LABELS[entry.type] ?? {
                    label: entry.type,
                    color: "text-text-muted",
                  };
                  return (
                    <div key={entry.id} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-foreground">
                          {typeInfo.label}
                        </span>
                        <span className={`font-mono text-sm ${typeInfo.color}`}>
                          {entry.amount >= 0 ? "+" : ""}${entry.amount.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted truncate">
                        {entry.description}
                      </p>
                      <p className="font-mono text-[11px] leading-4 text-text-muted">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
```

The empty-ledger line `<p className="text-xs text-text-faint">No ledger entries (pre-April 2026 order)</p>` → `className="text-sm text-text-muted"` (copy unchanged).

The References block `className="text-xs text-text-faint space-y-1 font-mono break-all"` → `text-text-muted` (an id you read is not decorative).

- [ ] **Step 10: Full-page verification**

Run: `npx vitest run src/app/admin`
Expected: all admin suites pass.

Run: `grep -n "border-default\|bg-surface-raised text-text-muted" "src/app/admin/orders/[id]/page.tsx"`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add "src/app/admin/orders/[id]/page.tsx"
git commit -m "Paper sweep: order detail — mono labels, ruled ledger rows, ink classification select

Drops an invisible bg-border-default bullet (no such token since the
token sweep) in favour of hairline-ruled ledger rows.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN"
```

---

### Task 4: `/admin/published` grid + `/admin/errors` table

**Files:**
- Modify: `src/app/admin/published/page.tsx`
- Modify: `src/app/admin/errors/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

**Context you need:** Both are server components (`export const dynamic = "force-dynamic"`, session-gated on `ADMIN_EMAIL`) — **do not touch the gate or the server actions**. `published/page.tsx` uses `bg-checkerboard`, which since Paper slice 1 is just an alias for `--surface-well` with deliberately **no** border of its own; call sites that want an edge add `border border-border` themselves (this one already does). Replace the alias with the real token so the last checkerboard call site in admin is gone.

There is no test to write here: these are two server components with no branching logic beyond `images.length === 0` / `errors.length === 0`, both already covered by nothing and not worth a render harness (a server component needs the DB). Verification is `npm run build` plus the greps below.

- [ ] **Step 1: Sweep `/admin/published`**

- The image well: `className="relative block aspect-square bg-checkerboard border border-border"` → `className="relative block aspect-square bg-surface-well border border-border"`.
- The card wrapper: `className={`border rounded-md overflow-hidden ${img.isHidden ? "border-negative opacity-60" : "border-border"}`}` → `className={`border rounded-md overflow-hidden ${img.isHidden ? "border-negative" : "border-border"}`}`. Opacity is not the signal; add an explicit marker instead, immediately above the title inside `<div className="p-3 space-y-2">`:

```tsx
                {img.isHidden && (
                  <p className="font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-negative">
                    Hidden
                  </p>
                )}
```

- The designer line stays `text-xs text-text-muted truncate`.
- The date: `<p className="text-xs text-text-faint">` → `<p className="font-mono text-[11px] leading-4 tracking-[0.08em] text-text-muted">`.
- The rank `<Input …>`: add `font-mono` to its className → `className="w-full min-w-0 min-h-11 px-2 text-sm font-mono"`.
- The hide/unhide `<Button type="submit" variant={img.isHidden ? "secondary" : "danger"} size="sm" className="w-full">` → underlined text: `variant="ghost"` with `className="w-full min-h-11 underline underline-offset-[3px]"`. Keep the `{img.isHidden ? "Unhide" : "Hide"}` label and the form exactly as they are. The `Save` button keeps `variant="secondary"`.
- The empty state `<p className="text-text-muted">No published images yet.</p>` → add `text-sm`.

- [ ] **Step 2: Sweep `/admin/errors`**

- `<thead className="border-b text-text-faint text-xs uppercase">` → `<thead className="border-b border-border text-text-muted">`, and each of the four `<th className="py-3 pr-4">` → `className="py-3 pr-4 font-mono text-[11px] leading-4 tracking-[0.08em] uppercase font-normal"`.
- `<tbody className="divide-y">` → `<tbody className="divide-y divide-border">`.
- The timestamp cell `className="py-3 pr-4 text-xs text-text-muted whitespace-nowrap"` → add `font-mono`.
- The `routeType` suffix `<span className="text-text-faint ml-2">` → `className="text-text-muted ml-2"`.
- The Stack `<summary className="text-text-faint cursor-pointer">` → `className="text-text-muted cursor-pointer underline underline-offset-[3px]"`.
- The stack `<pre className="mt-1 p-2 bg-surface rounded text-[10px] whitespace-pre-wrap break-all">` → `className="mt-1 p-2 bg-surface-well border border-border rounded text-[10px] whitespace-pre-wrap break-all"`.
- The empty state `<p className="text-text-muted">No errors recorded.</p>` → add `text-sm`.

- [ ] **Step 3: Verify**

Run: `grep -rn "bg-checkerboard\|divide-y\"\|border-b\"\|opacity-60" src/app/admin/published/page.tsx src/app/admin/errors/page.tsx`
Expected: no output.

Run: `npx vitest run src/app/admin`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/published/page.tsx src/app/admin/errors/page.tsx
git commit -m "Paper sweep: published grid on the paper well, hairline errors table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN"
```

---

## Final gate (controller runs this, not a task)

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

All four green before the PR opens. Record the numbers in the PR body.

Grep sweep over the two owned trees — each must return nothing:

```bash
grep -rn "bg-black\|text-white\|bg-gray-\|text-red-\|text-blue-\|bg-checkerboard" src/app/admin "src/app/(auth)"
grep -rnE 'class(Name)?="[^"]*\b(divide-y|border-b|border-t|border)\"' src/app/admin "src/app/(auth)"
grep -rn "accent-rose" src/app/admin "src/app/(auth)"
```
