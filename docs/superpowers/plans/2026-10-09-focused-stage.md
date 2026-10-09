# Focused Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cell tap on the Studio bench opens a state of `/studio` that shows that result large on its backdrop, the composer under it anchored to it, the conversation's other results as a strip, and the chat transcript behind a collapsed disclosure.

**Architecture:** The stage is rendered by `StudioClient` in place of the bench when `focus` resolves to a cell of one of the viewer's lanes. `focus` comes from the URL (`?conversation=&image=`), is read by the page on the server for the first render and by the client on `popstate`; in-stage moves use `history.pushState`/`replaceState` so the lanes in client state are reused. All submit, poll, optimistic, cancel and lost-submit machinery stays in `StudioClient`; the new `FocusedStage` component is presentational plus one lazy fetch for the transcript. The bench lightbox is removed.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (Paper tokens in `src/app/globals.css`), Drizzle + libSQL (in-memory for tests), Vitest + Testing Library (jsdom for client tests, node for `src/lib`).

**Spec:** `docs/superpowers/specs/2026-10-09-focused-stage.md`

## Global Constraints

- Branch `claude/focused-stage`, one PR, no migration. Nico merges.
- Copy is persona C "The Clean Label": neutral, no whimsy. Every string in this plan is verbatim; do not reword.
- Paper look only: ink borders, no shadows, mono uppercase 11px labels (`font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted`), rose only on the wordmark and Generate. No checkerboard.
- Touch targets 44px (`min-h-11`) except the documented 28px Cancel inside a pending cell.
- No price anywhere (guard test `src/lib/__tests__/no-preselection-price.test.ts`).
- "Image detail page", not "/d", in any prose for Nico.
- Phone-first: the 390px layout is primary; `lg` adds the two-column layout.
- `catch (err)` with `err instanceof Error ? err.message : String(err)`; no `any` in product code.
- Gate before the PR: `npm run lint && npm run typecheck && npm test && npm run build` (build needs the CI dummy env block from `.github/workflows/ci.yml`).
- Do not touch `src/app/design/**`, `src/lib/preview-redirect.ts`, `src/proxy.ts`, `e2e/**` (slice 2 owns `/design`).
- Timestamps: UTC at rest; nothing here displays a calendar date.

## Review Focus

1. A `?conversation=&image=` pair that names a seed image (one image id in two conversations) must open the conversation named, not the first lane holding the image. Test: Task 3 `resolveFocus` with the same image id in two lanes.
2. An edit submitted from the stage must not lose the anchor on acceptance (the bench's `spendAnchor` rule); a second line typed right after the first must still edit. Test: Task 5 "a second Generate on the stage still passes anchorImageId".
3. A landed result must move the stage without clobbering a draft in the composer. Test: Task 5 "landing moves the stage and keeps the draft".
4. The focused lane disappearing (closed elsewhere, archived) must fall back to the bench, not render a blank stage or throw on `lane.cells[index]`. Test: Task 5 "a poll that drops the focused lane returns to the bench".
5. `getConversationHistory` must refuse another user's conversation and a guest-less request, like every Studio action. Test: Task 2.

---

### Task 1: Lane data carries the backdrop and the message count

**Files:**
- Modify: `src/lib/studio.ts:31-37` (StudioCell), `:51-59` (StudioLane), `:185-196` (image read), `:220-232` (first-turn read), `:252-266` (assembly)
- Test: `src/lib/__tests__/studio.integration.test.ts`

**Interfaces:**
- Produces: `StudioCell.backdropColor: string | null`; `StudioLane.messageCount: number`. Both are plain data on the shape every later task reads.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("getStudioLanesData", …)` in `src/lib/__tests__/studio.integration.test.ts`:

```ts
  it("a published cell carries its pinned backdrop; unpublished and hidden carry null", async () => {
    const design = await makeOpenDesign("owner");
    const published = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/pub.png",
      createdAt: minutesAgo(30),
      publishedAt: minutesAgo(20),
      backgroundColor: "Navy",
    });
    const hidden = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/hidden.png",
      createdAt: minutesAgo(25),
      publishedAt: minutesAgo(20),
      backgroundColor: "Black",
      isHidden: true,
    });
    const privateId = await makeSourceImage(db, {
      designId: design.id,
      ownerId: "owner",
      imageUrl: "https://cdn.example/private.png",
      createdAt: minutesAgo(10),
    });

    const [lane] = await getStudioLanesData("owner", { db });

    const byId = new Map(lane.cells.map((c) => [c.imageId, c.backdropColor]));
    expect(byId.get(published)).toBe("Navy");
    expect(byId.get(hidden)).toBeNull();
    expect(byId.get(privateId)).toBeNull();
  });

  it("counts the conversation's chat messages", async () => {
    const design = await makeOpenDesign("owner");
    const other = await makeOpenDesign("owner");
    await db.insert(schema.chatMessage).values([
      { designId: design.id, role: "user", content: "a", createdAt: minutesAgo(3) },
      { designId: design.id, role: "assistant", content: "b", createdAt: minutesAgo(2) },
      { designId: other.id, role: "user", content: "c", createdAt: minutesAgo(1) },
    ]);

    const lanes = await getStudioLanesData("owner", { db });

    expect(lanes.find((l) => l.designId === design.id)?.messageCount).toBe(2);
    expect(lanes.find((l) => l.designId === other.id)?.messageCount).toBe(1);
  });

  it("a lane with no chat has messageCount 0", async () => {
    await makeOpenDesign("owner");
    const [lane] = await getStudioLanesData("owner", { db });
    expect(lane.messageCount).toBe(0);
  });
```

Check first that `makeSourceImage` with `publishedAt` + `backgroundColor` writes both an `image_publication` row and a `product` mirror row (read `src/lib/__tests__/factories.ts:35-110`). If it does not write the `product` row, call `setPublication(db, id, { backgroundColor: "Navy" })` after it in the test instead of passing `backgroundColor`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/__tests__/studio.integration.test.ts`
Expected: the three new tests fail (`backdropColor` / `messageCount` undefined).

- [ ] **Step 3: Extend the types and the reads**

In `src/lib/studio.ts`:

```ts
/** One image in a lane. */
export type StudioCell = {
  imageId: string;
  imageUrl: string;
  /** The conversation's primary_image_id — the marked cell. */
  isPrimary: boolean;
  createdAt: Date;
  /**
   * The pinned Shop backdrop (`product.backdrop_color`) when the image is
   * published and not admin-hidden (`image_publication` is the one
   * visibility reader, #300); null otherwise. The focused stage paints a
   * published result on it; unpublished artwork sits on the paper well.
   */
  backdropColor: string | null;
};
```

Add to `StudioLane` after `lastActiveAt`:

```ts
  /** `chat_message` rows in this conversation — the stage's history label. */
  messageCount: number;
```

Add imports:

```ts
import {
  design as designTable,
  chatMessage as chatMessageTable,
  conversationImage as conversationImageTable,
  image as imageTable,
  imageGeneration as imageGenerationTable,
  imagePublication as imagePublicationTable,
  product as productTable,
} from "./db/schema";
import { mirrorFrontImageId } from "./composition-reads";
```

Replace the image read (the first element of the `Promise.all`) with:

```ts
    db
      .select({
        designId: conversationImageTable.designId,
        imageId: imageTable.id,
        imageUrl: imageTable.imageUrl,
        prompt: imageTable.prompt,
        createdAt: imageTable.createdAt,
        publishedAt: imagePublicationTable.publishedAt,
        isHidden: imagePublicationTable.isHidden,
        backdropColor: productTable.backdropColor,
      })
      .from(conversationImageTable)
      .innerJoin(imageTable, eq(imageTable.id, conversationImageTable.imageId))
      // Visibility from image_publication (#300); the backdrop off the Shop
      // mirror. front_image_id is unique, so the mirror join yields ≤ 1 row.
      .leftJoin(
        imagePublicationTable,
        eq(imagePublicationTable.imageId, imageTable.id)
      )
      .leftJoin(productTable, eq(mirrorFrontImageId, imageTable.id))
      .where(inArray(conversationImageTable.designId, designIds))
      .orderBy(asc(imageTable.createdAt), sql`image.rowid asc`),
```

Add a fourth element to the `Promise.all` (after the first-turn read) and a fourth name to the destructuring (`const [imageRows, jobRows, firstTurnRows, countRows] = …`):

```ts
    db
      .select({
        designId: chatMessageTable.designId,
        n: sql<number>`count(*)`,
      })
      .from(chatMessageTable)
      .where(inArray(chatMessageTable.designId, designIds))
      .groupBy(chatMessageTable.designId),
```

In the `cellsByDesign` loop, build the cell as:

```ts
      cell: {
        imageId: row.imageId,
        imageUrl: row.imageUrl,
        isPrimary: false, // filled in per-design below
        createdAt: row.createdAt,
        backdropColor:
          row.publishedAt && !row.isHidden ? (row.backdropColor ?? null) : null,
      },
```

After `titleByDesign`:

```ts
  const countByDesign = new Map(countRows.map((row) => [row.designId, Number(row.n)]));
```

And in the lane object returned by `designs.map`, after `lastActiveAt: …`:

```ts
      messageCount: countByDesign.get(design.id) ?? 0,
```

- [ ] **Step 4: Fix every constructor of these types**

`npm run typecheck` will list them. Known: `src/lib/studio-view.ts` (if it builds a synthetic lane for an unanchored submit — give it `messageCount: 0`), `src/lib/__tests__/studio-view.test.ts`, `src/app/studio/__tests__/studio-client.test.tsx` (`lane()` gets `messageCount: 0`, `cell()` gets `backdropColor: null`), `src/app/studio/__tests__/studio-hydration.test.tsx`, `src/app/studio/__tests__/guest-keep-line.test.tsx`. Add the fields with these defaults; change nothing else.

- [ ] **Step 5: Run the gate**

Run: `npx vitest run src/lib/__tests__/studio.integration.test.ts src/lib/__tests__/studio-view.test.ts src/app/studio && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/studio.ts src/lib/studio-view.ts src/lib/__tests__ src/app/studio/__tests__
git commit -m "Studio lanes: cell backdrop colour and per-lane message count"
```

---

### Task 2: `getConversationHistory` server action

**Files:**
- Modify: `src/app/studio/actions.ts` (append)
- Test: `src/app/studio/__tests__/studio-actions.integration.test.ts`

**Interfaces:**
- Produces: `getConversationHistory(designId: string): Promise<HistoryTurn[]>` with `export type HistoryTurn = { id: string; role: "user" | "assistant"; content: string; imageId: string | null; createdAt: Date }`.

- [ ] **Step 1: Read the existing test file's mocking of the session**

Open `src/app/studio/__tests__/studio-actions.integration.test.ts` and reuse exactly its way of faking `auth.api.getSession` and injecting the test db (the `getStudioLanes` tests there are the model). Add the new tests in the same style.

- [ ] **Step 2: Write the failing tests**

```ts
describe("getConversationHistory", () => {
  it("returns the owner's turns oldest first", async () => {
    // seed a design for the session user with three chat_message rows at
    // t-3m (user, imageId null), t-2m (assistant, imageId "img-a"), t-1m (user)
    const turns = await getConversationHistory(design.id);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[1].imageId).toBe("img-a");
    expect(turns[0].createdAt.getTime()).toBeLessThan(turns[2].createdAt.getTime());
  });

  it("refuses a conversation the session does not own", async () => {
    // seed a design owned by another user
    await expect(getConversationHistory(other.id)).rejects.toThrow("Unauthorized");
  });

  it("refuses with no session", async () => {
    // make the session mock return null
    await expect(getConversationHistory("any")).rejects.toThrow("Unauthorized");
  });
});
```

Write the seeding with the file's existing helpers; the comments above say what to seed.

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run src/app/studio/__tests__/studio-actions.integration.test.ts`
Expected: FAIL, `getConversationHistory` is not exported.

- [ ] **Step 4: Implement**

Append to `src/app/studio/actions.ts`:

```ts
export type HistoryTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageId: string | null;
  createdAt: Date;
};

/**
 * The transcript behind the focused stage's "History" disclosure: every
 * chat_message of one conversation, oldest first. Owner-scoped (the design
 * row must belong to the session's user); same gate as getStudioLanes, so
 * guests read their own threads while the guest funnel is on. Read on
 * demand when the disclosure opens, never on the poll — a lane's transcript
 * is not bench state.
 */
export async function getConversationHistory(
  designId: string
): Promise<HistoryTurn[]> {
  const session = await requireStudioActionSession();
  const [owned] = await db
    .select({ id: designTable.id })
    .from(designTable)
    .where(and(eq(designTable.id, designId), eq(designTable.userId, session.user.id)))
    .limit(1);
  if (!owned) throw new Error("Unauthorized");
  const rows = await getDesignMessages(designId);
  return rows.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    imageId: m.imageId ?? null,
    createdAt: m.createdAt,
  }));
}
```

Add the imports the file lacks: `db` from `@/lib/db`, `design as designTable` from `@/lib/db/schema`, `and, eq` from `drizzle-orm`, `getDesignMessages` from `@/lib/design-images`. If the file injects the db through a different pattern for tests (check how `getStudioLanes` reaches the test db in the integration test), follow that pattern instead of importing `db` directly.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/app/studio/__tests__/studio-actions.integration.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/app/studio/actions.ts src/app/studio/__tests__/studio-actions.integration.test.ts
git commit -m "Studio: getConversationHistory action for the stage's history disclosure"
```

---

### Task 3: Pure focus helpers

**Files:**
- Create: `src/lib/studio-focus.ts`
- Test: `src/lib/__tests__/studio-focus.test.ts`

**Interfaces:**
- Produces:
  - `type StudioFocus = { designId: string; imageId: string }`
  - `parseFocus(params: { conversation?: string | string[]; image?: string | string[] } | URLSearchParams): StudioFocus | null`
  - `focusHref(focus: StudioFocus): string` → `/studio?conversation=<id>&image=<id>` (URL-encoded)
  - `BENCH_HREF = "/studio"`
  - `resolveFocus(lanes: StudioLane[], focus: StudioFocus | null): { lane: StudioLane; index: number } | null`
  - `laneStageHref(lane: StudioLane): string | null` — primary cell, else newest cell, else null
  - `historyTurnLabel(turn: { role: "user" | "assistant"; imageId: string | null }, cells: { imageId: string }[]): string` → `You`, `PRNTD`, `You · Result 3`, `PRNTD · Result 3`
  - `newestUnseenCell(lane: StudioLane, seen: ReadonlySet<string>): StudioCell | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import type { StudioLane } from "@/lib/studio";
import {
  BENCH_HREF,
  focusHref,
  historyTurnLabel,
  laneStageHref,
  newestUnseenCell,
  parseFocus,
  resolveFocus,
} from "@/lib/studio-focus";

function cell(imageId: string, isPrimary = false) {
  return { imageId, imageUrl: `https://cdn.example/${imageId}.png`, isPrimary, createdAt: new Date(), backdropColor: null };
}
function lane(designId: string, cells: ReturnType<typeof cell>[]): StudioLane {
  return { designId, title: null, lastActiveAt: new Date(), messageCount: 0, cells, pending: [] };
}

describe("parseFocus", () => {
  it("reads both params from a searchParams object", () => {
    expect(parseFocus({ conversation: "d1", image: "i1" })).toEqual({ designId: "d1", imageId: "i1" });
  });
  it("reads both params from URLSearchParams", () => {
    expect(parseFocus(new URLSearchParams("conversation=d1&image=i1"))).toEqual({ designId: "d1", imageId: "i1" });
  });
  it("is null when either is missing, empty, or repeated", () => {
    expect(parseFocus({ conversation: "d1" })).toBeNull();
    expect(parseFocus({ image: "i1" })).toBeNull();
    expect(parseFocus({ conversation: "", image: "i1" })).toBeNull();
    expect(parseFocus({ conversation: ["d1", "d2"], image: "i1" })).toBeNull();
    expect(parseFocus({})).toBeNull();
  });
});

describe("focusHref", () => {
  it("builds the stage URL, encoded", () => {
    expect(focusHref({ designId: "d 1", imageId: "i&1" })).toBe("/studio?conversation=d+1&image=i%261");
    expect(BENCH_HREF).toBe("/studio");
  });
});

describe("resolveFocus", () => {
  it("finds the cell in the named conversation, not the first lane holding the image", () => {
    const seed = cell("shared");
    const lanes = [lane("d1", [seed, cell("a")]), lane("d2", [seed])];
    expect(resolveFocus(lanes, { designId: "d2", imageId: "shared" })).toEqual({ lane: lanes[1], index: 0 });
    expect(resolveFocus(lanes, { designId: "d1", imageId: "a" })).toEqual({ lane: lanes[0], index: 1 });
  });
  it("is null for a missing lane, a missing cell, or no focus", () => {
    const lanes = [lane("d1", [cell("a")])];
    expect(resolveFocus(lanes, { designId: "d9", imageId: "a" })).toBeNull();
    expect(resolveFocus(lanes, { designId: "d1", imageId: "zz" })).toBeNull();
    expect(resolveFocus(lanes, null)).toBeNull();
  });
});

describe("laneStageHref", () => {
  it("prefers the primary cell, else the newest, else null", () => {
    expect(laneStageHref(lane("d1", [cell("a"), cell("b", true), cell("c")]))).toBe("/studio?conversation=d1&image=b");
    expect(laneStageHref(lane("d1", [cell("a"), cell("c")]))).toBe("/studio?conversation=d1&image=c");
    expect(laneStageHref(lane("d1", []))).toBeNull();
  });
});

describe("historyTurnLabel", () => {
  const cells = [cell("a"), cell("b"), cell("c")];
  it("names the speaker and the result the turn carries", () => {
    expect(historyTurnLabel({ role: "user", imageId: null }, cells)).toBe("You");
    expect(historyTurnLabel({ role: "assistant", imageId: null }, cells)).toBe("PRNTD");
    expect(historyTurnLabel({ role: "assistant", imageId: "c" }, cells)).toBe("PRNTD · Result 3");
    expect(historyTurnLabel({ role: "user", imageId: "a" }, cells)).toBe("You · Result 1");
  });
  it("ignores an image that is not a cell of this conversation", () => {
    expect(historyTurnLabel({ role: "assistant", imageId: "gone" }, cells)).toBe("PRNTD");
  });
});

describe("newestUnseenCell", () => {
  it("returns the last cell whose id is not in `seen`, else null", () => {
    const l = lane("d1", [cell("a"), cell("b"), cell("c")]);
    expect(newestUnseenCell(l, new Set(["a", "b"]))?.imageId).toBe("c");
    expect(newestUnseenCell(l, new Set(["a", "b", "c"]))).toBeNull();
    expect(newestUnseenCell(l, new Set())?.imageId).toBe("c");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/lib/__tests__/studio-focus.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { StudioCell, StudioLane } from "@/lib/studio";

/**
 * The focused stage's address (#188 slice 4): which conversation and which
 * of its cells is shown. Both ids are needed — a seed image is a link, so
 * one image id can be a cell of two conversations.
 */
export type StudioFocus = { designId: string; imageId: string };

export const BENCH_HREF = "/studio";

type ParamSource =
  | { conversation?: string | string[]; image?: string | string[] }
  | URLSearchParams;

function one(source: ParamSource, key: "conversation" | "image"): string | null {
  if (source instanceof URLSearchParams) {
    const all = source.getAll(key);
    return all.length === 1 && all[0] !== "" ? all[0] : null;
  }
  const v = source[key];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Both params present exactly once and non-empty, else null (the bench). */
export function parseFocus(source: ParamSource): StudioFocus | null {
  const designId = one(source, "conversation");
  const imageId = one(source, "image");
  return designId && imageId ? { designId, imageId } : null;
}

export function focusHref(focus: StudioFocus): string {
  const params = new URLSearchParams();
  params.set("conversation", focus.designId);
  params.set("image", focus.imageId);
  return `${BENCH_HREF}?${params.toString()}`;
}

/** The lane and cell index a focus names, or null when it names nothing on
 * the bench (closed conversation, foreign id, deleted image). */
export function resolveFocus(
  lanes: StudioLane[],
  focus: StudioFocus | null
): { lane: StudioLane; index: number } | null {
  if (!focus) return null;
  const lane = lanes.find((l) => l.designId === focus.designId);
  if (!lane) return null;
  const index = lane.cells.findIndex((c) => c.imageId === focus.imageId);
  return index === -1 ? null : { lane, index };
}

/** Where a lane's title links: the stage on its primary cell, else its newest
 * cell; null for a lane with no cells yet. */
export function laneStageHref(lane: StudioLane): string | null {
  const target = lane.cells.find((c) => c.isPrimary) ?? lane.cells[lane.cells.length - 1];
  return target ? focusHref({ designId: lane.designId, imageId: target.imageId }) : null;
}

/** "You" / "PRNTD", with " · Result N" when the turn's image is cell N. */
export function historyTurnLabel(
  turn: { role: "user" | "assistant"; imageId: string | null },
  cells: { imageId: string }[]
): string {
  const who = turn.role === "user" ? "You" : "PRNTD";
  if (!turn.imageId) return who;
  const n = cells.findIndex((c) => c.imageId === turn.imageId);
  return n === -1 ? who : `${who} · Result ${n + 1}`;
}

/** The newest cell the stage has not shown yet — a landed result to follow. */
export function newestUnseenCell(
  lane: StudioLane,
  seen: ReadonlySet<string>
): StudioCell | null {
  for (let i = lane.cells.length - 1; i >= 0; i--) {
    const c = lane.cells[i];
    if (!seen.has(c.imageId)) return c;
  }
  return null;
}
```

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/lib/__tests__/studio-focus.test.ts`
Expected: PASS.

```bash
git add src/lib/studio-focus.ts src/lib/__tests__/studio-focus.test.ts
git commit -m "studio-focus: parse, build and resolve the focused stage address"
```

---

### Task 4: `FocusedStage` component

**Files:**
- Create: `src/app/studio/focused-stage.tsx`
- Test: `src/app/studio/__tests__/focused-stage.test.tsx`

**Interfaces:**
- Consumes: `StudioLane`, `StudioCell` (Task 1), `historyTurnLabel` (Task 3), `getConversationHistory`/`HistoryTurn` (Task 2), `publishedBackdrop` and `getColorHex` from `@/lib/blanks`, `buyPageHref` from `@/lib/buy-page-picks`, `formatElapsed` from `@/lib/studio-view`.
- Produces:

```ts
export function FocusedStage(props: {
  lane: StudioLane;
  index: number;                 // the shown cell
  nowMs: number;
  composer: ReactNode;           // StudioClient's <Composer/> (and the guest line)
  unresolvedCellIds: Set<string>;
  onBack: (e: MouseEvent<HTMLAnchorElement>) => void;        // "← Studio"
  onPickResult: (index: number, e: MouseEvent<HTMLAnchorElement>) => void;
  onNewDesign: (e: MouseEvent<HTMLAnchorElement>) => void;   // "New design"
  onCancel: (jobId: string) => void;
  focusHrefFor: (index: number) => string;
  benchHref: string;
}): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { StudioLane } from "@/lib/studio";

vi.mock("../actions", () => ({
  getConversationHistory: vi.fn(async () => [
    { id: "m1", role: "user", content: "a bear reading", imageId: null, createdAt: new Date(1) },
    { id: "m2", role: "assistant", content: "Rendered.", imageId: "b", createdAt: new Date(2) },
  ]),
}));
import { getConversationHistory } from "../actions";
import { FocusedStage } from "../focused-stage";

window.HTMLElement.prototype.scrollIntoView = vi.fn();

function cell(imageId: string, over: Partial<StudioLane["cells"][number]> = {}) {
  return { imageId, imageUrl: `https://cdn.example/${imageId}.png`, isPrimary: false, createdAt: new Date(), backdropColor: null, ...over };
}
function lane(over: Partial<StudioLane> = {}): StudioLane {
  return { designId: "d1", title: "woodcut bear", lastActiveAt: new Date(), messageCount: 4, cells: [cell("a"), cell("b"), cell("c")], pending: [], ...over };
}

function renderStage(over: Partial<Parameters<typeof FocusedStage>[0]> = {}) {
  const props = {
    lane: lane(),
    index: 1,
    nowMs: Date.now(),
    composer: <div data-testid="composer-slot" />,
    unresolvedCellIds: new Set<string>(),
    onBack: vi.fn((e) => e.preventDefault()),
    onPickResult: vi.fn((_i, e) => e.preventDefault()),
    onNewDesign: vi.fn((e) => e.preventDefault()),
    onCancel: vi.fn(),
    focusHrefFor: (i: number) => `/studio?conversation=d1&image=${["a", "b", "c"][i]}`,
    benchHref: "/studio",
    ...over,
  };
  render(<FocusedStage {...props} />);
  return props;
}

beforeEach(() => vi.clearAllMocks());

describe("FocusedStage", () => {
  it("shows the result count, the image, and the composer slot", () => {
    renderStage();
    expect(screen.getByText("Result 2 of 3")).toBeTruthy();
    expect(screen.getByTestId("stage-image").getAttribute("alt")).toBe("");
    expect(screen.getByTestId("composer-slot")).toBeTruthy();
  });

  it("paints a published result on its backdrop with the caption; unpublished on the well without one", () => {
    const { unmount } = render(
      <FocusedStage {...renderStageProps({ lane: lane({ cells: [cell("a", { backdropColor: "Navy" })] }), index: 0 })} />
    );
    const frame = screen.getByTestId("stage-frame");
    expect(frame.style.backgroundColor).not.toBe("");
    expect(screen.getByText("Shown on Navy")).toBeTruthy();
    unmount();
    renderStage({ index: 0 });
    expect(screen.getByTestId("stage-frame").className).toContain("bg-surface-well");
    expect(screen.queryByText(/Shown on/)).toBeNull();
  });

  it("links Order, Open and New design", () => {
    const props = renderStage();
    expect(screen.getByRole("link", { name: "Order" }).getAttribute("href")).toBe("/d/b?order=1&from=%2Fstudio");
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/d/b");
    fireEvent.click(screen.getByRole("link", { name: "New design" }));
    expect(props.onNewDesign).toHaveBeenCalled();
  });

  it("← Studio and the result thumbnails are real links that report the click", () => {
    const props = renderStage();
    const back = screen.getByRole("link", { name: "← Studio" });
    expect(back.getAttribute("href")).toBe("/studio");
    fireEvent.click(back);
    expect(props.onBack).toHaveBeenCalled();
    const strip = screen.getByTestId("stage-results");
    const thumbs = within(strip).getAllByRole("link");
    expect(thumbs).toHaveLength(3);
    expect(thumbs[1].getAttribute("aria-current")).toBe("true");
    expect(thumbs[2].getAttribute("href")).toBe("/studio?conversation=d1&image=c");
    fireEvent.click(thumbs[2]);
    expect(props.onPickResult).toHaveBeenCalledWith(2, expect.anything());
  });

  it("renders pending jobs as dashed cells with a Cancel line, inert until resolved", () => {
    const props = renderStage({
      lane: lane({ pending: [{ jobId: "j1", generationNumber: 4, startedAt: new Date(Date.now() - 12_000) }, { jobId: "local-2", generationNumber: 0, startedAt: new Date(), optimistic: true }] }),
      unresolvedCellIds: new Set(["local-2"]),
    });
    expect(screen.getAllByTestId("stage-pending-cell")).toHaveLength(2);
    const cancels = screen.getAllByTestId("cancel-generation");
    expect(cancels).toHaveLength(1);
    fireEvent.click(cancels[0]);
    expect(props.onCancel).toHaveBeenCalledWith("j1");
    expect(screen.getAllByTestId("cancel-generation-placeholder")).toHaveLength(1);
  });

  it("history is collapsed, fetches once on open, and labels turns", async () => {
    renderStage();
    const toggle = screen.getByRole("button", { name: "History · 4 messages" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(getConversationHistory).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText("a bear reading")).toBeTruthy());
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("PRNTD · Result 2")).toBeTruthy();
    expect(getConversationHistory).toHaveBeenCalledTimes(1);
    expect(getConversationHistory).toHaveBeenCalledWith("d1");
    fireEvent.click(toggle);
    expect(screen.queryByText("a bear reading")).toBeNull();
    fireEvent.click(toggle);
    expect(getConversationHistory).toHaveBeenCalledTimes(1);
  });

  it("history shows a plain failure line when the fetch throws", async () => {
    vi.mocked(getConversationHistory).mockRejectedValueOnce(new Error("boom"));
    renderStage();
    fireEvent.click(screen.getByRole("button", { name: "History · 4 messages" }));
    await waitFor(() => expect(screen.getByText("Couldn't load the history.")).toBeTruthy());
  });
});
```

Write `renderStageProps` as the props-only half of `renderStage` (the second test needs to render twice). Singular copy: `History · 1 message`; add one assertion for it with `messageCount: 1`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/app/studio/__tests__/focused-stage.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the component**

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type MouseEvent, type ReactNode } from "react";
import type { StudioLane } from "@/lib/studio";
import { buyPageHref } from "@/lib/buy-page-picks";
import { DEFAULT_BLANK_ID, getColorHex, publishedBackdrop } from "@/lib/blanks";
import { formatElapsed } from "@/lib/studio-view";
import { historyTurnLabel } from "@/lib/studio-focus";
import { getConversationHistory, type HistoryTurn } from "./actions";

const MONO = "font-mono text-[11px] leading-4 tracking-[0.08em] uppercase text-text-muted";
const HISTORY_FAILED_COPY = "Couldn't load the history.";

/**
 * The focused stage (#188 slice 4, board C/F/G of the 2026-10-08 canvas):
 * one result large on its backdrop, the composer under it, the
 * conversation's other results as a strip, the transcript behind a
 * collapsed disclosure. Presentational: StudioClient owns focus, submit,
 * poll and cancel, and passes its own <Composer/> in through `composer`.
 * Every in-stage link is a real <a href> (new-tab works); StudioClient's
 * handlers preventDefault and pushState so the lanes in client state are
 * reused instead of re-fetched.
 */
export function FocusedStage({
  lane,
  index,
  nowMs,
  composer,
  unresolvedCellIds,
  onBack,
  onPickResult,
  onNewDesign,
  onCancel,
  focusHrefFor,
  benchHref,
}: {
  lane: StudioLane;
  index: number;
  nowMs: number;
  composer: ReactNode;
  unresolvedCellIds: Set<string>;
  onBack: (e: MouseEvent<HTMLAnchorElement>) => void;
  onPickResult: (index: number, e: MouseEvent<HTMLAnchorElement>) => void;
  onNewDesign: (e: MouseEvent<HTMLAnchorElement>) => void;
  onCancel: (jobId: string) => void;
  focusHrefFor: (index: number) => string;
  benchHref: string;
}) {
  const cell = lane.cells[index];
  const published = cell.backdropColor !== null;
  // Published: the pinned Shop backdrop (#302 rule for admin grids). Not
  // published: the paper well; the #139 slice decides its tone later.
  const frame = published
    ? publishedBackdrop(cell.backdropColor)
    : { className: "bg-surface-well", style: undefined };

  return (
    <div data-testid="focused-stage" className="lg:grid lg:grid-cols-[600px_1fr] lg:gap-12">
      <div className={`h-11 flex items-center justify-between ${MONO} lg:col-span-2`}>
        <a href={benchHref} onClick={onBack} className="text-text-muted no-underline hover:text-foreground min-h-11 inline-flex items-center">
          ← Studio
        </a>
        <span>Result {index + 1} of {lane.cells.length}</span>
      </div>

      <div>
        <div
          data-testid="stage-frame"
          className={`relative w-full max-w-[600px] aspect-square border border-border p-6 ${frame.className}`}
          style={frame.style}
        >
          <Image
            data-testid="stage-image"
            src={cell.imageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 600px, 100vw"
            className="object-contain p-6"
            priority
          />
        </div>
        {published && (
          <div className={`mt-1.5 flex items-center gap-2 ${MONO}`}>
            <span
              className="inline-block w-3 h-3 border border-border"
              style={{ backgroundColor: getColorHex(DEFAULT_BLANK_ID, cell.backdropColor) }}
            />
            <span>Shown on {cell.backdropColor}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5 mt-2 lg:mt-0">
        {composer}

        <div className="h-11 flex items-center gap-5 text-sm">
          <Link href={buyPageHref(cell.imageId, { order: true, from: "/studio" })} className="underline underline-offset-[3px]">
            Order
          </Link>
          <Link href={`/d/${cell.imageId}`} className="underline underline-offset-[3px]">
            Open
          </Link>
          <a href={benchHref} onClick={onNewDesign} className="underline underline-offset-[3px]">
            New design
          </a>
        </div>

        <div className="flex flex-col gap-2">
          <span className={MONO}>Other results</span>
          <div data-testid="stage-results" className="flex gap-2 overflow-x-auto pb-1">
            {lane.cells.map((c, i) => {
              const shown = i === index;
              return (
                <a
                  key={c.imageId}
                  href={focusHrefFor(i)}
                  onClick={(e) => onPickResult(i, e)}
                  aria-label={`Result ${i + 1}${shown ? ", shown" : ""}`}
                  aria-current={shown ? "true" : undefined}
                  className={`relative shrink-0 w-14 h-14 lg:w-22 lg:h-22 bg-surface-well ${
                    shown ? "border-2 border-foreground" : "border border-border"
                  }`}
                >
                  <Image src={c.imageUrl} alt="" fill sizes="88px" className="object-contain" />
                </a>
              );
            })}
            {lane.pending.map((job) => (
              <div
                key={job.jobId}
                data-testid="stage-pending-cell"
                className="shrink-0 w-14 h-14 lg:w-22 lg:h-22 border border-dashed border-foreground bg-surface flex items-center justify-center"
              >
                <span className={`${MONO} animate-pulse`}>…</span>
              </div>
            ))}
          </div>
          {lane.pending.map((job) => {
            // Same contract as the bench's pending cell: Cancel is inert and
            // invisible until generateDesign has returned a real job id.
            const unresolved = unresolvedCellIds.has(job.jobId);
            return (
              <div key={job.jobId} className={`h-11 flex items-center gap-2 ${MONO}`}>
                <span className="animate-pulse">Generating…</span>
                <span className="tabular-nums text-text-faint">{formatElapsed(nowMs - job.startedAt.getTime())}</span>
                <span>·</span>
                <button
                  type="button"
                  disabled={unresolved}
                  aria-hidden={unresolved || undefined}
                  tabIndex={unresolved ? -1 : undefined}
                  onClick={unresolved ? undefined : () => onCancel(job.jobId)}
                  className={`min-h-11 px-2 text-foreground underline underline-offset-[3px] normal-case tracking-normal text-xs ${unresolved ? "invisible" : ""}`}
                  data-testid={unresolved ? "cancel-generation-placeholder" : "cancel-generation"}
                >
                  Cancel
                </button>
              </div>
            );
          })}
        </div>

        <History lane={lane} />
      </div>
    </div>
  );
}

function History({ lane }: { lane: StudioLane }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<HistoryTurn[] | null>(null);
  const [failed, setFailed] = useState(false);
  const label = `History · ${lane.messageCount} ${lane.messageCount === 1 ? "message" : "messages"}`;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || turns !== null) return;
    try {
      setTurns(await getConversationHistory(lane.designId));
    } catch (err) {
      console.error("History load failed:", err instanceof Error ? err.message : String(err));
      setFailed(true);
    }
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => void toggle()}
        className={`w-full min-h-11 border-t border-border flex items-center justify-between ${MONO}`}
      >
        <span>{label}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d={open ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} />
        </svg>
      </button>
      {open && (
        <div className="flex flex-col text-sm leading-5">
          {failed && <p className="py-2.5 text-text-muted">{HISTORY_FAILED_COPY}</p>}
          {turns?.map((t) => (
            <div key={t.id} className="py-2.5 border-t border-border flex flex-col gap-1">
              <span className={`${MONO} text-text-faint`}>{historyTurnLabel(t, lane.cells)}</span>
              <p className={`m-0 whitespace-pre-wrap ${t.role === "assistant" ? "text-text-muted" : ""}`}>{t.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Check that `DEFAULT_BLANK_ID` is exported from `@/lib/blanks` (grep); if not, use the exported constant that `publishedBackdrop` itself uses. If `lg:w-22` is not a Tailwind v4 size, use `lg:w-[88px] lg:h-[88px]`. If `next/image` complains about `data-testid`, wrap the image in a `<span data-testid="stage-image-wrap">` and adjust the test's first assertion to look for an `img` inside it.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/app/studio/__tests__/focused-stage.test.tsx && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add src/app/studio/focused-stage.tsx src/app/studio/__tests__/focused-stage.test.tsx
git commit -m "Studio: FocusedStage component (image on backdrop, strip, history disclosure)"
```

---

### Task 5: Wire the stage into `StudioClient` and the page; remove the bench lightbox

**Files:**
- Modify: `src/app/studio/studio-client.tsx` (state, submit, Lane cell tap, Lane title link, render), `src/app/studio/page.tsx`
- Test: `src/app/studio/__tests__/studio-client.test.tsx` (rewrite the lightbox/anchor tests), `src/app/studio/__tests__/studio-hydration.test.tsx` (should pass unchanged)

**Interfaces:**
- Consumes: `FocusedStage` (Task 4), `parseFocus`, `focusHref`, `resolveFocus`, `laneStageHref`, `newestUnseenCell`, `BENCH_HREF`, `StudioFocus` (Task 3).
- Produces: `StudioClient` prop `initialFocus?: StudioFocus | null`; `StudioPage` reads `searchParams`.

- [ ] **Step 1: Rewrite the affected client tests first**

In `src/app/studio/__tests__/studio-client.test.tsx`:

1. Replace the `anchorCell` helper's body: a cell tap now opens the stage, which anchors.

```ts
function openStage(index = 0) {
  fireEvent.click(screen.getAllByTestId("studio-cell")[index]);
}
```

   Every call site of `anchorCell(i)` becomes `openStage(i)`, and assertions that the anchor chip is inside `studio-composer-panel` still hold (the stage renders the same Composer).

2. Delete the tests at `:219-320` that assert the lightbox (`image-lightbox`, `lightbox-edit`, `lightbox-order`, "Open" inside the lightbox, "a tap alone does not anchor"). Replace with:

```ts
describe("focused stage", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/studio");
  });

  it("a cell tap opens the stage for that cell and pushes its URL", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1"), cell("img-2")] })]} />);
    openStage(1);
    expect(screen.getByTestId("focused-stage")).toBeTruthy();
    expect(screen.getByText("Result 2 of 2")).toBeTruthy();
    expect(window.location.search).toBe("?conversation=design-1&image=img-2");
    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    expect(screen.queryByTestId("studio-lane")).toBeNull();
  });

  it("renders the stage from initialFocus on first render", () => {
    render(
      <StudioClient
        initialLanes={[lane({ cells: [cell("img-1"), cell("img-2")] })]}
        initialFocus={{ designId: "design-1", imageId: "img-1" }}
      />
    );
    expect(screen.getByText("Result 1 of 2")).toBeTruthy();
  });

  it("an initialFocus that names nothing renders the bench and drops the params", () => {
    window.history.replaceState(null, "", "/studio?conversation=design-1&image=zz");
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} initialFocus={{ designId: "design-1", imageId: "zz" }} />);
    expect(screen.queryByTestId("focused-stage")).toBeNull();
    expect(screen.getByTestId("studio-lane")).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("← Studio returns to the bench and Back re-opens the stage", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
    openStage(0);
    fireEvent.click(screen.getByRole("link", { name: "← Studio" }));
    expect(screen.queryByTestId("focused-stage")).toBeNull();
    expect(window.location.search).toBe("");
    act(() => {
      window.history.back();
    });
    // jsdom's back() is async; drive popstate by hand with the URL it restores
    act(() => {
      window.history.replaceState(null, "", "/studio?conversation=design-1&image=img-1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("focused-stage")).toBeTruthy();
  });

  it("the lane title links to the stage of the primary cell, else the newest", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1"), cell("img-2", { isPrimary: true }), cell("img-3")] }), lane({ designId: "design-2", cells: [cell("x"), cell("y")] }), lane({ designId: "design-3", cells: [] })]} />);
    const links = screen.getAllByRole("link", { name: "geometric wolf head" });
    expect(links[0].getAttribute("href")).toBe("/studio?conversation=design-1&image=img-2");
    expect(links[1].getAttribute("href")).toBe("/studio?conversation=design-2&image=y");
    expect(links[2].getAttribute("href")).toBe("/design?id=design-3");
  });

  it("Generate on the stage edits the shown image and a second line still edits", async () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
    openStage(0);
    fireEvent.change(screen.getByTestId("studio-composer"), { target: { value: "bigger" } });
    fireEvent.click(screen.getByTestId("studio-generate"));
    await waitFor(() => expect(generateDesign).toHaveBeenCalledTimes(1));
    expect(vi.mocked(generateDesign).mock.calls[0][2]).toMatchObject({ anchorImageId: "img-1" });
    expect(screen.getAllByTestId("stage-pending-cell")).toHaveLength(1);
    expect(screen.getByTestId("anchor-chip")).toBeTruthy();
    fireEvent.change(screen.getByTestId("studio-composer"), { target: { value: "and red" } });
    fireEvent.click(screen.getByTestId("studio-generate"));
    await waitFor(() => expect(generateDesign).toHaveBeenCalledTimes(2));
    expect(vi.mocked(generateDesign).mock.calls[1][2]).toMatchObject({ anchorImageId: "img-1" });
  });

  it("landing moves the stage to the new result and keeps the draft", async () => {
    const l = lane({ cells: [cell("img-1")] });
    render(<StudioClient initialLanes={[l]} />);
    openStage(0);
    fireEvent.change(screen.getByTestId("studio-composer"), { target: { value: "bigger" } });
    fireEvent.click(screen.getByTestId("studio-generate"));
    await waitFor(() => expect(generateDesign).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("studio-composer"), { target: { value: "next idea" } });
    h.polledLanes = [lane({ cells: [cell("img-1"), cell("img-new")] })];
    await act(async () => {
      await (getStudioLanes as ReturnType<typeof vi.fn>)();
    });
    // trigger a poll the way the existing poll tests do (timers or the wake handler)
    await waitFor(() => expect(screen.getByText("Result 2 of 2")).toBeTruthy());
    expect(window.location.search).toBe("?conversation=design-1&image=img-new");
    expect((screen.getByTestId("studio-composer") as HTMLInputElement).value).toBe("next idea");
    expect(vi.mocked(generateDesign).mock.calls.length).toBe(1);
  });

  it("clearing the chip and generating starts a new lane and returns to the bench", async () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
    openStage(0);
    fireEvent.click(screen.getByLabelText("Clear anchor"));
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
    fireEvent.change(screen.getByTestId("studio-composer"), { target: { value: "a fox" } });
    fireEvent.click(screen.getByTestId("studio-generate"));
    await waitFor(() => expect(generateDesign).toHaveBeenCalled());
    expect(vi.mocked(generateDesign).mock.calls[0][2]).not.toHaveProperty("anchorImageId");
    expect(screen.queryByTestId("focused-stage")).toBeNull();
    expect(window.location.search).toBe("");
    expect(screen.getAllByTestId("studio-lane").length).toBe(2);
  });

  it("New design goes to the bench with the composer unanchored", () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
    openStage(0);
    fireEvent.click(screen.getByRole("link", { name: "New design" }));
    expect(screen.queryByTestId("focused-stage")).toBeNull();
    expect(screen.queryByTestId("anchor-chip")).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("a poll that drops the focused lane returns to the bench", async () => {
    render(<StudioClient initialLanes={[lane({ cells: [cell("img-1")] })]} />);
    openStage(0);
    h.polledLanes = [];
    // drive one poll the way the existing poll tests do
    await waitFor(() => expect(screen.queryByTestId("focused-stage")).toBeNull());
    expect(window.location.search).toBe("");
  });
});
```

   Look at how the existing poll tests in this file drive a poll (fake timers plus `pollNonce`, or the `visibilitychange` wake handler) and use the same mechanism where the comments say "drive one poll". The lane section must carry `data-testid="studio-lane"` — check `Lane`'s `<section>`; the e2e `guest-funnel.spec.ts:59-70` already looks for it, so it exists.

3. Keep every other test. The anchor tests that relied on "Edit this one" now open the stage; the "anchor clears when its image leaves" test still holds because the stage falls back to the bench and clears the anchor.

- [ ] **Step 2: Run to see the new tests fail**

Run: `npx vitest run src/app/studio/__tests__/studio-client.test.tsx`
Expected: the `focused stage` describe fails; `openStage` tests fail (a tap opens the lightbox today).

- [ ] **Step 3: Page reads the params**

`src/app/studio/page.tsx`:

```tsx
import { parseFocus } from "@/lib/studio-focus";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string | string[]; image?: string | string[] }>;
}) {
  const { session, isGuest } = await requireStudioUser("/studio");
  after(() => sweepStudioForUser(session.user.id));
  // The focused stage's address (#188 slice 4). Parsed here so the first
  // render is the stage, not a bench that flips on hydration; the client
  // owns it from then on (pushState/popstate), see StudioClient.
  const focus = parseFocus(await searchParams);
  const lanes = await getStudioLanesData(session.user.id);
  // eslint-disable-next-line react-hooks/purity
  const renderedAtMs = Date.now();
  return (
    <StudioClient
      initialLanes={lanes}
      initialNowMs={renderedAtMs}
      isGuest={isGuest}
      initialFocus={focus}
    />
  );
}
```

Keep the existing docblock comments. `searchParams` is a Promise in Next 16 (`node_modules/next/dist/docs/` confirms the shape; check `src/app/studio/archive/page.tsx:17` for the project's existing usage).

- [ ] **Step 4: Client state and handlers**

In `src/app/studio/studio-client.tsx`:

Imports: remove `ImageLightbox, type LightboxImage`; add

```ts
import type { MouseEvent } from "react";
import { FocusedStage } from "./focused-stage";
import {
  BENCH_HREF,
  focusHref,
  laneStageHref,
  newestUnseenCell,
  parseFocus,
  resolveFocus,
  type StudioFocus,
} from "@/lib/studio-focus";
```

Props: add `initialFocus?: StudioFocus | null` to `StudioClient`'s props type with the doc comment "The stage address the page parsed from the URL, or null for the bench."

State, after `revealDesignId`:

```ts
  // The focused stage's address (#188 slice 4). Lives in the URL
  // (?conversation=&image=) so Back and reload work; moves are pushState /
  // replaceState on the client, not router navigations — the lanes are
  // already here and a soft navigation would re-run the page's DB read on
  // every tap. popstate re-reads the URL (below). Null is the bench.
  const [focus, setFocus] = useState<StudioFocus | null>(initialFocus ?? null);
  // Cells the stage has already shown for its lane, so a result landing
  // from this stage's own Generate can be told apart from cells that were
  // there when the stage opened (the follow effect below).
  const seenCellIds = useRef<Set<string>>(new Set());
  // Set by the chip's ✕ on the stage: the stage image stops being the
  // anchor until the focus changes.
  const [anchorCleared, setAnchorCleared] = useState(false);
```

Derived, after `renderedLanes`:

```ts
  const stage = resolveFocus(renderedLanes, focus);
```

Navigation helpers, next to `editFromLightbox` (which is deleted):

```ts
  function go(next: StudioFocus | null, mode: "push" | "replace") {
    const url = next ? focusHref(next) : BENCH_HREF;
    const fn = mode === "push" ? window.history.pushState : window.history.replaceState;
    fn.call(window.history, window.history.state, "", url);
    setFocus(next);
    setAnchorCleared(false);
  }

  function openStage(lane: StudioLane, index: number) {
    const c = lane.cells[index];
    if (!c) return;
    seenCellIds.current = new Set(lane.cells.map((x) => x.imageId));
    go({ designId: lane.designId, imageId: c.imageId }, "push");
    window.scrollTo({ top: 0 });
  }

  function leaveStage(e?: MouseEvent<HTMLAnchorElement>) {
    e?.preventDefault();
    go(null, "push");
  }
```

Effects, after the existing wake handler effect:

```ts
  // Back/forward: the URL is the truth for which state is on screen.
  useEffect(() => {
    function onPop() {
      setFocus(parseFocus(new URLSearchParams(window.location.search)));
      setAnchorCleared(false);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A focus that names nothing on the bench (closed elsewhere, archived by
  // the sweep, a stale link) falls back to the bench and drops the params,
  // so a reload does not try again.
  useEffect(() => {
    if (focus && !stage) go(null, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, stage === null]);

  // Follow a landed result: when the focused lane gains a cell this stage
  // has not shown, show it (the user asked for the change; seeing it is the
  // point). replaceState, not push: Back should leave the stage, not step
  // through every result that landed.
  useEffect(() => {
    if (!stage) return;
    const fresh = newestUnseenCell(stage.lane, seenCellIds.current);
    if (!fresh) return;
    seenCellIds.current = new Set(stage.lane.cells.map((c) => c.imageId));
    go({ designId: stage.lane.designId, imageId: fresh.imageId }, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage?.lane.cells.length, stage?.lane.designId]);
```

The anchor on the stage is derived, not stored. Replace reads of `anchor` in the render path and in `submit` with `effectiveAnchor`:

```ts
  // On the stage the shown image is the anchor unless the chip was cleared;
  // on the bench the anchor is whatever state holds (nothing sets it there
  // any more, so it is null — kept for giveBack's restore after a refused
  // submit).
  const effectiveAnchor: Anchor | null =
    stage && !anchorCleared
      ? {
          designId: stage.lane.designId,
          imageId: stage.lane.cells[stage.index].imageId,
          imageUrl: stage.lane.cells[stage.index].imageUrl,
          title: stage.lane.title,
        }
      : stage
        ? null
        : anchor;
```

In `submit()`: `const submitAnchor = effectiveAnchor;` and change the accepted branch to

```ts
        // An accepted turn spends the anchor on the BENCH (Nico, 2026-10-01):
        // the next idea typed there starts a new lane. On the stage the shown
        // image stays the anchor — the next line is another change to it.
        if (!stage) spendAnchor(submitAnchor);
        // An unanchored submit from the stage starts a new conversation,
        // which lives on the bench: go there, where the reveal nudge finds
        // the new lane.
        if (stage && !submitAnchor) go(null, "push");
```

Keep the `setRevealDesignId(targetDesignId)` call as is (it fires for every unanchored submit).

The chip's ✕ on the stage: pass `onClearAnchor={() => (stage ? setAnchorCleared(true) : setAnchor(null))}`.

Remove `editFromLightbox` and the `onEditImage` prop; delete the `anchor === submitted` reference-equality trick's dependence on `effectiveAnchor` being a fresh object each render by comparing ids inside `spendAnchor`:

```ts
  function spendAnchor(submitted: Anchor | null) {
    if (!submitted) return;
    setAnchor((a) => (a && a.imageId === submitted.imageId && a.designId === submitted.designId ? null : a));
  }
```

- [ ] **Step 5: Render**

Replace the `<main>` body: when `stage` is set, render the stage instead of composer + lanes (select mode is unreachable from the stage, so the `selectMode` branches stay as they are for the bench):

```tsx
        {stage ? (
          <div className="py-2">
            <FocusedStage
              lane={stage.lane}
              index={stage.index}
              nowMs={nowMs}
              unresolvedCellIds={unresolvedCellIds}
              onBack={leaveStage}
              onPickResult={(i, e) => {
                e.preventDefault();
                openStage(stage.lane, i);
              }}
              onNewDesign={(e) => {
                e.preventDefault();
                setAnchor(null);
                go(null, "push");
                composerPanelRef.current?.querySelector("input")?.focus();
              }}
              onCancel={(jobId) => cancelJob(stage.lane, jobId)}
              focusHrefFor={(i) => focusHref({ designId: stage.lane.designId, imageId: stage.lane.cells[i].imageId })}
              benchHref={BENCH_HREF}
              composer={
                <>
                  <Composer
                    panelRef={composerPanelRef}
                    text={text}
                    anchor={effectiveAnchor}
                    atCap={atCap}
                    capNotice={AT_CAP_COPY}
                    notice={notice}
                    onChangeText={setText}
                    onSubmit={() => void submit()}
                    onClearAnchor={() => setAnchorCleared(true)}
                  />
                  {isGuest && <GuestKeepLine className="-mt-2" />}
                </>
              }
            />
          </div>
        ) : (
          <>
            {/* existing selectMode ? null : (composer + guest line) block, unchanged,
                with anchor={effectiveAnchor} */}
            {/* existing renderedLanes.length === 0 ? EmptyState : lanes map, unchanged
                except: anchoredImageId={effectiveAnchor?.imageId ?? null},
                remove onEditImage, add onOpenCell={openStage} */}
          </>
        )}
```

The focus call on the composer input after "New design" must happen after the bench renders: use a `useEffect` keyed on a `focusComposerNonce` state that `onNewDesign` bumps, rather than the inline `querySelector` call, if the inline call finds no input (the bench is not mounted yet in the same tick).

In `Lane`: rename the `onEditImage` prop to `onOpenCell: (lane: StudioLane, index: number) => void` (doc: "A plain cell tap opens the focused stage for that cell; select mode keeps its own tap, see onTapCell"). In the cell `onClick`, replace `setLightboxIndex(index)` with `onOpenCell(lane, index)`. Delete `lightboxIndex` state, the `ImageLightbox` block at the end of `Lane`, and the `setLightboxIndex(null)` in the Select menu item (update that comment: the lightbox is gone; the item just enters select mode). Update the cell button's `aria-label` to `Open result #${index + 1}…` and its explanatory comments to say the tap opens the stage. Title link:

```tsx
          <Link
            href={laneStageHref(lane) ?? `/design?id=${lane.designId}`}
            onClick={(e) => {
              const href = laneStageHref(lane);
              if (!href) return;
              e.preventDefault();
              const target = lane.cells.findIndex((c) => c.isPrimary);
              onOpenCell(lane, target === -1 ? lane.cells.length - 1 : target);
            }}
            className="min-w-0 flex-1 hover:underline"
          >
```

- [ ] **Step 6: Run the Studio tests and the type check**

Run: `npx vitest run src/app/studio && npm run typecheck && npm run lint`
Expected: PASS. If `studio-hydration.test.tsx` fails on the new `searchParams` prop of the page, pass `searchParams={Promise.resolve({})}` where it renders the page.

- [ ] **Step 7: Commit**

```bash
git add src/app/studio
git commit -m "Studio: focused stage replaces the bench lightbox (#188 slice 4)"
```

---

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md` (Routes block `/studio` line; Current state 2026-10-08 bullet's "Parked for his call: … the focused stage" → the slice; Open issues #188), `docs/design-system.md` only if it lists Studio surfaces (grep "lightbox" and "Studio" first; add one line for the stage if there is a per-surface list, otherwise leave it)

- [ ] **Step 1: Edit CLAUDE.md**

Routes line becomes:

```
/studio                 → Studio bench: composer on top, one lane per conversation (guests with a session allowed while GUEST_FUNNEL_ENABLED; #248); `?conversation=&image=` is the focused stage (#188 slice 4): one result large on its backdrop, composer under it, other results, history disclosure
```

In the 2026-10-08 bullet replace `Parked for his call: rose `#a83250` keep vs candidates (#188 slice 4 mock round), the focused stage.` with `Rose kept (2026-10-08). Focused stage built as #188 slice 4 (branch `claude/focused-stage`): spec `docs/superpowers/specs/2026-10-09-focused-stage.md`; the `/design?id=` thread stays until slice 2 makes it a redirect.`

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md docs
git commit -m "docs: focused stage (CLAUDE.md routes and current state)"
```

---

## Self-review notes

- Spec coverage: URL (T3, T5), layout items 1–8 (T4), laptop (T4 classes), behaviours (T5: tap, anchor not spent, follow, fallback, ✕, New design; T4: Cancel inert), data (T1, T2), smoke (spec). Not covered on purpose: zoom, `/design` redirect.
- Type consistency: `StudioFocus {designId, imageId}` everywhere; `onOpenCell(lane, index)`; `HistoryTurn` fields `id, role, content, imageId, createdAt`; `FocusedStage` props as listed in T4 and used in T5.
- Review Focus 1 → T3 `resolveFocus` seed test; 2 → T5 "second Generate"; 3 → T5 "landing moves"; 4 → T5 "poll drops the lane"; 5 → T2 refusal tests.
