# isUniqueViolation walks the cause chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `isUniqueViolation` recognise a unique-constraint rejection that arrives wrapped in drizzle's `DrizzleQueryError`, so `refund-order.ts`'s bare-insert catch actually turns a concurrent second Refund click into `{ok:true, refunded:false}` instead of throwing.

**Architecture:** One pure-function change in `src/lib/ledger.ts` — walk the `.cause` chain (bounded, cycle-safe, tolerant of non-`Error` links) and match `/UNIQUE constraint failed/i` at any level, keeping the existing top-level `.message` match. Then lock the behaviour with unit tests plus real-DB tests that produce genuine drizzle/libSQL errors, and remove the `db.batch` workaround the old limitation forced on `generateDesign`.

**Tech Stack:** TypeScript, drizzle-orm 0.45.1, `@libsql/client`, Vitest with the real in-memory libSQL harness at `src/lib/__tests__/test-db.ts`.

**Spec:** GitHub issue #209 (`gh api repos/nicolovejoy/prntd/issues/209`). Body reproduced in "Background" below, so the plan is self-contained.

## Background (the spec, restated)

`isUniqueViolation` (`src/lib/ledger.ts:150`) is today:

```ts
export function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(message);
}
```

Error shapes were verified empirically against the in-memory libSQL harness on 2026-09-07 (a duplicate `ledger_entry(order_id, type)` insert). These are facts, not guesses — do not re-litigate them, but the tests must reproduce them from real DB calls rather than hand-built fakes:

**Bare `db.insert(...).values(...)`:**
- constructor `DrizzleQueryError`
- `.message` = `Failed query: insert into "ledger_entry" (...) values (...)\nparams: ...` — **no SQLite text at all**
- `.cause` = `LibsqlError`, `.cause.message` = `SQLITE_CONSTRAINT: UNIQUE constraint failed: ledger_entry.order_id, ledger_entry.type`
- `.cause.cause.message` = `UNIQUE constraint failed: ledger_entry.order_id, ledger_entry.type`

**`db.batch([...])`:**
- constructor `LibsqlBatchError`
- `.message` = `SQLITE_CONSTRAINT: SQLITE_CONSTRAINT: UNIQUE constraint failed: ...` — matches today, and must keep matching

So batched callers (`src/lib/webhook-handlers.ts:149`, `src/app/design/actions.ts:290`) work today; the one bare-insert caller (`src/lib/refund-order.ts:103`) has never worked. That is money-adjacent: a concurrent second Refund click throws instead of reporting the benign no-op.

**Callers (all four, verified by grep on 2026-09-07):**
- `src/lib/ledger.ts:150` — the definition
- `src/lib/webhook-handlers.ts:149` — `db.batch` → matches today, must keep matching
- `src/app/design/actions.ts:290` — `db.batch` wrapping ONE insert, added by #211 purely to get a matchable shape
- `src/lib/refund-order.ts:103` — bare insert → the live defect

## Global Constraints

- Work only inside the worktree `/Users/nico/src/prntd/.claude/worktrees/209-unique-violation` on branch `feat/209-unique-violation`. Never touch the main checkout or sibling worktrees. Use absolute paths.
- **No schema change. No migration. No new retry logic.** Out of scope, full stop.
- `@typescript-eslint/no-explicit-any` is `error` in product code, `off` in test files. Product code must be typed; `unknown` + narrowing, never `any`.
- `catch` clauses take `catch (err)` (implicitly `unknown`). Never annotate `err: any` in product code.
- Real-DB tests use `createTestDb()` from `src/lib/__tests__/test-db.ts`, which derives DDL from `schema.ts` — the `ledger_entry(order_id, type)` unique index is present. FKs are enforced.
- Tests that need a genuine drizzle error must produce it by actually hitting the DB. Hand-constructed `DrizzleQueryError` look-alikes are acceptable ONLY in the pure unit tests, where the point is the walk itself.
- Every commit message ends with exactly these two trailer lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
```

- Writing style for comments and docblocks (from `CLAUDE.md`): state what something does and why, plainly. No hyperbole, no "core insight", no selling.
- Baseline before any change: 146 test files, 1594 tests, all passing.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/ledger.ts` | `isUniqueViolation` + its docblock — the only product-code behaviour change | 1 |
| `src/lib/__tests__/ledger.test.ts` | Pure unit tests for the cause walk (existing file, append a `describe`) | 1 |
| `src/lib/__tests__/unique-violation.integration.test.ts` | NEW — real drizzle/libSQL errors from bare insert and from `db.batch`, both recognised | 2 |
| `src/lib/__tests__/refund-order.integration.test.ts` | Append the concurrent-click test that exercises the catch at `refund-order.ts:103` | 2 |
| `src/app/design/actions.ts` | Drop the one-statement `db.batch` workaround and the comment that explains it | 3 |
| `src/lib/refund-order.ts` | Comment accuracy only (see Task 3 ruling) | 3 |

---

### Task 1: `isUniqueViolation` walks the cause chain

**Files:**
- Modify: `/Users/nico/src/prntd/.claude/worktrees/209-unique-violation/src/lib/ledger.ts:145-153`
- Test: `/Users/nico/src/prntd/.claude/worktrees/209-unique-violation/src/lib/__tests__/ledger.test.ts` (append at end of file)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isUniqueViolation(err: unknown): boolean` — signature unchanged, exported from `@/lib/ledger`. Task 2 and Task 3 depend on it now matching a `DrizzleQueryError` whose SQLite text lives only on `.cause`.

- [ ] **Step 1: Write the failing tests**

Append this to the END of `src/lib/__tests__/ledger.test.ts`. Add `isUniqueViolation` to the existing import list at the top of that file (the import is `from "../ledger"`).

```ts
describe("isUniqueViolation", () => {
  it("matches the SQLite text on the error's own message (db.batch shape)", () => {
    // db.batch calls the libSQL client directly, so LibsqlBatchError carries
    // the SQLite text on .message. This is the shape the webhook paid-claim
    // relies on; it must keep matching.
    const err = new Error(
      "SQLITE_CONSTRAINT: SQLITE_CONSTRAINT: UNIQUE constraint failed: ledger_entry.order_id, ledger_entry.type"
    );
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("matches when the text is only on .cause (bare-insert DrizzleQueryError shape)", () => {
    // drizzle wraps every non-batch execution: its own message is
    // "Failed query: ..." and never contains the SQLite text.
    const err = new Error('Failed query: insert into "ledger_entry" ...', {
      cause: new Error(
        "SQLITE_CONSTRAINT: UNIQUE constraint failed: ledger_entry.order_id, ledger_entry.type"
      ),
    });
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("matches two levels down (DrizzleQueryError -> LibsqlError -> SQLite)", () => {
    const err = new Error("Failed query: ...", {
      cause: new Error("SQLITE_CONSTRAINT: outer", {
        cause: new Error("UNIQUE constraint failed: ledger_entry.order_id"),
      }),
    });
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("tolerates a non-Error link in the chain", () => {
    const err = new Error("Failed query: ...", {
      cause: { message: "UNIQUE constraint failed: ledger_entry.order_id" },
    });
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("is false for an unrelated error, including its causes", () => {
    const err = new Error("Failed query: ...", {
      cause: new Error("FOREIGN KEY constraint failed"),
    });
    expect(isUniqueViolation(err)).toBe(false);
  });

  it("is false for a plain object with no matching text", () => {
    expect(isUniqueViolation({ nope: true })).toBe(false);
  });

  it("handles non-Error input", () => {
    expect(isUniqueViolation("UNIQUE constraint failed: x.y")).toBe(true);
    expect(isUniqueViolation("something else")).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(42)).toBe(false);
  });

  it("does not hang on a cause cycle", () => {
    // A pathological chain must terminate rather than spin. The test itself
    // would time out if the walk looped.
    const a = new Error("Failed query: a");
    const b = new Error("Failed query: b");
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;
    expect(isUniqueViolation(a)).toBe(false);
  });

  it("stops at a bounded depth rather than walking an unbounded chain", () => {
    // 50 links deep, with the match past the bound: a long chain must not be
    // walked forever, and the answer for one is false.
    let err = new Error("UNIQUE constraint failed: deep");
    for (let i = 0; i < 50; i++) {
      err = new Error(`Failed query: level ${i}`, { cause: err });
    }
    expect(isUniqueViolation(err)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && npx vitest run src/lib/__tests__/ledger.test.ts`

Expected: the four cause-chain cases fail (`expected false to be true`). The `db.batch`-shape case, the unrelated-error case, the plain-object case, the non-Error case, the cycle case and the depth case already pass against the old implementation — that is fine and expected; they are regression locks.

- [ ] **Step 3: Write the implementation**

Replace the whole of `isUniqueViolation` and its docblock in `src/lib/ledger.ts` with:

```ts
/**
 * True when an error is SQLite/libSQL's unique-constraint rejection — the
 * signal that a concurrent or redelivered write already booked this row.
 *
 * The text can arrive at two different depths. `db.batch(...)` calls the
 * libSQL client directly, so `LibsqlBatchError.message` carries it. Every
 * NON-batch execution (a bare `db.insert(...)`) is wrapped by drizzle in a
 * `DrizzleQueryError` whose own message is only `Failed query: ...`; the
 * SQLite text lives on `.cause` (`LibsqlError`), and one level below that
 * again. So we walk the chain instead of reading one message (#209 — before
 * this, the bare-insert catch in refund-order.ts could never match).
 *
 * The walk is bounded and cycle-safe because the chain is arbitrary
 * third-party data: a driver that ever self-references would otherwise hang
 * a money path.
 */
export function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = err;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (current === null || current === undefined) return false;
    if (UNIQUE_VIOLATION_TEXT.test(errorMessageOf(current))) return true;
    if (typeof current !== "object") return false;
    if (seen.has(current)) return false;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

Add these three module-level definitions immediately above it:

```ts
const UNIQUE_VIOLATION_TEXT = /UNIQUE constraint failed/i;

/** Deep enough for DrizzleQueryError -> LibsqlError -> SQLite, with slack. */
const MAX_CAUSE_DEPTH = 8;

/** Best-effort message for an arbitrary thrown value. */
function errorMessageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }
  return String(value);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && npx vitest run src/lib/__tests__/ledger.test.ts`

Expected: PASS, all cases.

- [ ] **Step 5: Run the callers' existing suites — nothing regresses**

Run:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && npx vitest run src/lib/__tests__/refund-order.integration.test.ts src/lib/__tests__/money-path.integration.test.ts src/app/design/__tests__/refused-submit-no-row.integration.test.ts
```

Expected: PASS. In particular the "non-unique insert failure refunds and rethrows" test in `refused-submit-no-row.integration.test.ts` uses a FOREIGN KEY violation — it must still rethrow, proving the widened match did not become a catch-all.

- [ ] **Step 6: Commit**

```bash
cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation
git add src/lib/ledger.ts src/lib/__tests__/ledger.test.ts
git commit -m "$(cat <<'EOF'
fix: isUniqueViolation walks the .cause chain (#209)

drizzle wraps every non-batch execution in DrizzleQueryError whose own
message is "Failed query: ..."; the SQLite text lives only on .cause. A
bare db.insert() therefore never matched, so refund-order.ts's concurrent-
click catch threw instead of reporting the benign no-op. The walk is
bounded and cycle-safe — the chain is third-party data on a money path.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 2: Real-DB proof — bare insert recognised, and the refund race is a no-op

**Files:**
- Create: `/Users/nico/src/prntd/.claude/worktrees/209-unique-violation/src/lib/__tests__/unique-violation.integration.test.ts`
- Modify: `/Users/nico/src/prntd/.claude/worktrees/209-unique-violation/src/lib/__tests__/refund-order.integration.test.ts` (append one `it` inside the existing `describe("refundOrderCore")`, and extend the import from `@/lib/ledger`)

**Interfaces:**
- Consumes: `isUniqueViolation` from Task 1; `createTestDb()` from `./test-db`; `refundOrderCore` / `RefundOrderDeps` from `@/lib/refund-order`; `refundLedgerRow` from `@/lib/ledger`.
- Produces: nothing consumed by later tasks. These are the regression locks that let Task 3 delete the `db.batch` workaround with confidence.

Notes for whoever writes this:
- The unit tests in Task 1 use hand-built error chains. These tests exist because a hand-built chain proves the walk but not the shape — only a real drizzle call proves we walk the shape drizzle actually throws. Never assert on `err.constructor.name` (that pins a library internal); assert on `isUniqueViolation(err)` and on the fact that `err instanceof Error && !/UNIQUE/i.test(err.message)` for the bare-insert case, which is the whole point.
- `refund-order.integration.test.ts` already has an idempotency test, but it returns early at the up-front `existing` ledger-row lookup and never reaches the catch at line 103. The new test must reach the catch. The honest way to do that is to book the rival row from inside the mocked `createRefund`: that lands the row after the up-front check has passed and before our own insert — exactly the real race window.

- [ ] **Step 1: Write the failing real-DB test for the raw error shape**

Create `src/lib/__tests__/unique-violation.integration.test.ts`:

```ts
/**
 * #209: the error shapes `isUniqueViolation` has to recognise, produced by
 * real drizzle/libSQL calls rather than hand-built fakes. The unit tests in
 * ledger.test.ts prove the walk; these prove we walk the shape the driver
 * actually throws.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./test-db";
import * as schema from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/ledger";

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seedOrder(db: Db) {
  await db
    .insert(schema.user)
    .values({ id: "user-1", email: "buyer@example.com", name: "Buyer" });
  const [design] = await db
    .insert(schema.design)
    .values({ userId: "user-1" })
    .returning();
  const [order] = await db
    .insert(schema.order)
    .values({
      userId: "user-1",
      designId: design.id,
      totalPrice: 24.12,
      status: "canceled",
    })
    .returning();
  return order;
}

describe("isUniqueViolation against real driver errors", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("recognises a bare db.insert() that trips ledger_entry(order_id, type)", async () => {
    const order = await seedOrder(db);
    const row = {
      orderId: order.id,
      type: "refund" as const,
      amount: -24.12,
      description: "first",
    };
    await db.insert(schema.ledgerEntry).values(row);

    let caught: unknown;
    try {
      await db.insert(schema.ledgerEntry).values(row);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    // The reason this test exists: drizzle's own message says nothing about
    // the constraint, so a .message-only check can never see this.
    expect((caught as Error).message).not.toMatch(/UNIQUE constraint failed/i);
    expect(isUniqueViolation(caught)).toBe(true);
  });

  it("still recognises the same violation raised through db.batch()", async () => {
    const order = await seedOrder(db);
    const row = {
      orderId: order.id,
      type: "refund" as const,
      amount: -24.12,
      description: "first",
    };
    await db.insert(schema.ledgerEntry).values(row);

    let caught: unknown;
    try {
      await db.batch([db.insert(schema.ledgerEntry).values(row)]);
    } catch (err) {
      caught = err;
    }

    expect(isUniqueViolation(caught)).toBe(true);
  });

  it("does not mistake a foreign-key violation for a unique violation", async () => {
    let caught: unknown;
    try {
      await db.insert(schema.design).values({ userId: "no-such-user" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(isUniqueViolation(caught)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && npx vitest run src/lib/__tests__/unique-violation.integration.test.ts`

Expected: PASS (Task 1's fix is already in). If the FK test's `caught` is undefined, foreign keys are not enforced in the harness — stop and report rather than weakening the assertion.

- [ ] **Step 3: Mutation-verify these tests would have failed before the fix**

Temporarily replace the body of `isUniqueViolation` in `src/lib/ledger.ts` with the old one-liner:

```ts
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(message);
```

Run: `cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && npx vitest run src/lib/__tests__/unique-violation.integration.test.ts`

Expected: the bare-insert test FAILS; the batch test and the FK test still pass. Then `git checkout src/lib/ledger.ts` to restore, and re-run to confirm PASS. Record the observed output in the ledger — a test that cannot fail is not a test.

- [ ] **Step 4: Write the refund concurrent-click test**

In `src/lib/__tests__/refund-order.integration.test.ts`, extend the imports:

```ts
import { refundLedgerRow } from "@/lib/ledger";
```

and append this `it` inside the existing `describe("refundOrderCore")` block, directly after the existing `"is idempotent: a second refund is a no-op..."` test:

```ts
  it("treats a row booked by a concurrent click during the Stripe call as a no-op success (#209)", async () => {
    // The existing idempotency test returns early at the up-front ledger
    // lookup. This one reaches the catch around the insert: the rival click
    // books the refund row while we are awaiting Stripe — after our check
    // passed, before our insert. Both clicks share the idempotency key
    // `refund-${orderId}`, so Stripe issued exactly one refund; the loser
    // must report the benign no-op, not throw.
    const { order } = await seedCanceledOrder(db);
    const deps = makeDeps(db, {
      createRefund: vi.fn(async () => {
        await db
          .insert(schema.ledgerEntry)
          .values(
            refundLedgerRow(order.id, order.totalPrice, "booked by the rival click")
          );
      }),
    });

    const result = await refundOrderCore(order.id, deps);

    expect(result).toEqual({ ok: true, refunded: false });
    const entries = await db.query.ledgerEntry.findMany({
      where: eq(schema.ledgerEntry.orderId, order.id),
    });
    expect(entries.filter((e) => e.type === "refund")).toHaveLength(1);
    expect(entries[0].description).toBe("booked by the rival click");
  });
```

- [ ] **Step 5: Run it**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && npx vitest run src/lib/__tests__/refund-order.integration.test.ts`

Expected: PASS, whole file.

- [ ] **Step 6: Mutation-verify the refund test too**

Same as Step 3: restore the old one-liner body of `isUniqueViolation`, run the refund file, and confirm the new test FAILS (it should reject with the `Failed query: ...` error rather than returning). Then `git checkout src/lib/ledger.ts` and re-run to confirm PASS. Record both outputs in the ledger.

- [ ] **Step 7: Commit**

```bash
cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation
git add src/lib/__tests__/unique-violation.integration.test.ts src/lib/__tests__/refund-order.integration.test.ts
git commit -m "$(cat <<'EOF'
test: real-DB cover for the bare-insert unique violation (#209)

Hand-built chains prove the walk; only a real drizzle call proves we walk
the shape the driver throws. Plus the refund path's concurrent-click race,
which reaches the catch at refund-order.ts:103 by booking the rival row
from inside the mocked Stripe call — the real race window. Both
mutation-verified against the old .message-only check.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

### Task 3: Drop the `db.batch` workaround and sweep the now-stale comments

**Files:**
- Modify: `/Users/nico/src/prntd/.claude/worktrees/209-unique-violation/src/app/design/actions.ts:265-297` (the `if (!found)` block inside `generateDesign`)
- Modify: `/Users/nico/src/prntd/.claude/worktrees/209-unique-violation/src/lib/refund-order.ts:98-107` (comment only — see ruling)

**Interfaces:**
- Consumes: `isUniqueViolation` from Task 1, now cause-walking.
- Produces: nothing. This is the cleanup the fix unblocks.

**Ruling to apply, not re-decide:** `refund-order.ts`'s catch is already the simplest correct form — one `try`, one `isUniqueViolation` check, one rethrow. There is nothing to simplify there; the code was always right and the helper was wrong. Do NOT restructure it. The only change is comment accuracy if the comment misstates anything. Its current comment is accurate, so expect a no-op — if you conclude otherwise, say why in the ledger rather than editing on instinct.

**Why the `generateDesign` change is behaviour-preserving:** `db.batch([oneStatement])` and a bare `.insert().returning()` execute the identical SQL; libSQL's batch is an implicit transaction, which over a single statement is what a lone statement already gets. The only difference was the thrown error's shape, which Task 1 removed. Destructuring changes from `const [[created]]` to `const [created]`. The two paths through this block are already covered by `src/app/design/__tests__/refused-submit-no-row.integration.test.ts`: `describe("concurrent double-submit on a fresh id")` (unique violation → continue on the winner's row) and `describe("non-unique insert failure refunds and rethrows")` (FK violation → refund + rethrow).

- [ ] **Step 1: Run the covering tests first and record that they pass**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && npx vitest run src/app/design/__tests__/refused-submit-no-row.integration.test.ts`

Expected: PASS. This is the before-picture — the change below must not move it.

- [ ] **Step 2: Replace the batch with a bare insert**

In `src/app/design/actions.ts`, inside `generateDesign`'s `if (!found)` block, replace:

```ts
        const [[created]] = await db.batch([
          db.insert(designTable).values({ id: designId, userId }).returning(),
        ]);
        found = created;
```

with:

```ts
        const [created] = await db
          .insert(designTable)
          .values({ id: designId, userId })
          .returning();
        found = created;
```

- [ ] **Step 3: Delete the comment paragraph that justified the batch**

In the same block, the comment above it ends with a paragraph beginning "Wrapped in a one-statement `db.batch` (not a bare `.insert()`)" and running through "...use this check as-is." Delete that whole paragraph — it documents a workaround that no longer exists and asserts an invariant (`isUniqueViolation` reads only `.message`) that is now false. Leave the paragraphs above it (the ones explaining the double-submit race and why the loser continues on the winner's row) exactly as they are; they are still true.

- [ ] **Step 4: Re-run the covering tests**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && npx vitest run src/app/design/__tests__/refused-submit-no-row.integration.test.ts src/app/design/__tests__/generation-races.integration.test.ts`

Expected: PASS, identical results to Step 1.

- [ ] **Step 5: Sweep for any other comment that asserts the old invariant**

Run:

```bash
cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && grep -rn "isUniqueViolation\|DrizzleQueryError\|db.batch" src --include='*.ts' --include='*.tsx' | grep -v "__tests__"
```

Read every hit's surrounding comment. Fix any comment that claims `isUniqueViolation` reads only `.message`, or that a `db.batch` exists *in order to* be recognised by it. Do NOT change any other `db.batch` — every other one exists for atomicity, which is a real reason. In particular `src/lib/webhook-handlers.ts` batches the paid-claim with the ledger inserts because they must be atomic; leave it alone.

- [ ] **Step 6: Full suite**

Run: `cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation && npm test`

Expected: all pass. Test count should be baseline 1594 + 9 (Task 1) + 3 (Task 2 new file) + 1 (Task 2 refund) = 1607, in 147 files.

- [ ] **Step 7: Commit**

```bash
cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation
git add -A
git commit -m "$(cat <<'EOF'
refactor: drop generateDesign's one-statement db.batch workaround (#209)

#211 wrapped this insert in a batch solely so a primary-key collision would
surface in the shape isUniqueViolation could see. It can see the bare shape
now, so the batch and the paragraph explaining it both go. Same SQL, same
two covered paths: unique violation continues on the winner's row, FK
violation refunds and rethrows.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018gyyDkawjSPfsD7s4QeSsN
EOF
)"
```

---

## Verification (controller runs this after all tasks)

```bash
cd /Users/nico/src/prntd/.claude/worktrees/209-unique-violation
npm run lint && npm run typecheck && npm test && npm run build
```

All four must be green before the PR opens.

**No prod smoke is possible for this change.** Observing it requires two genuinely concurrent Refund clicks on the same canceled order, on an order that has a live Stripe charge — not something to arrange on production. The real-DB tests are the evidence.

## Self-Review

**Spec coverage:**
- Spec item 1 (walk `.cause`, bounded, cycle-safe, non-Error tolerant; six named unit cases) → Task 1, Steps 1 and 3. All six named cases plus a depth-bound case are present.
- Spec item 2 (real-DB bare-insert recognition; real-DB refund duplicate path returning `{ok:true,refunded:false}`; mock only Stripe) → Task 2. `makeDeps` mocks only `retrievePaymentIntentId` and `createRefund`; the DB is real.
- Spec item 3 (simplify only if behaviour-preserving and covered) → Task 3, with the `generateDesign` argument stated and the `refund-order.ts` ruling pre-made.
- Spec item 4 (grep other callers and other `err.message` SQLite inspections) → the four callers are listed in Background; Task 3 Step 5 is the comment sweep. The controller ran the broader `err.message` grep on 2026-09-07: no other site inspects an error message for SQLite text, so there is no second instance of this defect to fix. That goes in the PR body.
- Out of scope (schema, migration, retry logic) → stated in Global Constraints.

**Placeholder scan:** no TBD/TODO/"similar to Task N"; every code step carries the actual code.

**Type consistency:** `isUniqueViolation(err: unknown): boolean` is unchanged and used identically in all three tasks. `errorMessageOf`, `UNIQUE_VIOLATION_TEXT`, `MAX_CAUSE_DEPTH` are module-private to `ledger.ts` and referenced only inside it. `refundLedgerRow(orderId, amount, description)` matches its existing use in `refund-order.ts`.
