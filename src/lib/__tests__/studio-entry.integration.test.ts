/**
 * conversationStudioHref (#188 slice 2c) against a real in-memory libSQL:
 * where an old /design?id= link lands. The rule is the bench's own
 * (laneStageHref over getStudioLanesData), so these cases also pin that the
 * redirect and a lane's title link agree.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import {
  makeDesign,
  makeSourceImage,
  makeUser,
  setPublication,
} from "@/lib/__tests__/factories";
import * as schema from "@/lib/db/schema";
import { getStudioLanesData } from "@/lib/studio";
import { conversationStudioHref } from "@/lib/studio-entry";
import { BENCH_HREF, focusHref, laneStageHref } from "@/lib/studio-focus";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

function href(userId: string, designId: string) {
  return conversationStudioHref(userId, designId, { db });
}

async function output(designId: string, ownerId: string, minutes: number) {
  return makeSourceImage(db, {
    designId,
    ownerId,
    imageUrl: `https://r2.example/${crypto.randomUUID()}.png`,
    createdAt: at(minutes),
  });
}

beforeEach(async () => {
  db = await createTestDb();
  await makeUser(db, "owner");
  await makeUser(db, "other");
});

describe("conversationStudioHref", () => {
  it("an open conversation with a primary goes to that result's stage", async () => {
    const d = await makeDesign(db, "owner");
    const first = await output(d.id, "owner", 1);
    await output(d.id, "owner", 2);
    await db
      .update(schema.design)
      .set({ primaryImageId: first })
      .where(eq(schema.design.id, d.id));

    expect(await href("owner", d.id)).toBe(focusHref({ designId: d.id, imageId: first }));
  });

  it("with no primary, goes to the newest of its outputs", async () => {
    const d = await makeDesign(db, "owner");
    await output(d.id, "owner", 1);
    const newest = await output(d.id, "owner", 5);

    expect(await href("owner", d.id)).toBe(focusHref({ designId: d.id, imageId: newest }));
  });

  it("a conversation with no result goes to the bench", async () => {
    const d = await makeDesign(db, "owner");
    expect(await href("owner", d.id)).toBe(BENCH_HREF);
  });

  it("a closed conversation goes to the bench and stays closed", async () => {
    const d = await makeDesign(db, "owner");
    await output(d.id, "owner", 1);
    const closedAt = at(10);
    await db.update(schema.design).set({ closedAt }).where(eq(schema.design.id, d.id));

    expect(await href("owner", d.id)).toBe(BENCH_HREF);

    const [row] = await db.select().from(schema.design).where(eq(schema.design.id, d.id));
    expect(row.closedAt?.getTime()).toBe(closedAt.getTime());
  });

  it("an archived conversation goes to the bench", async () => {
    const d = await makeDesign(db, "owner");
    await output(d.id, "owner", 1);
    await db
      .update(schema.design)
      .set({ status: "archived" })
      .where(eq(schema.design.id, d.id));

    expect(await href("owner", d.id)).toBe(BENCH_HREF);
  });

  it("another user's conversation goes to the bench", async () => {
    const d = await makeDesign(db, "other");
    await output(d.id, "other", 1);

    expect(await href("owner", d.id)).toBe(BENCH_HREF);
  });

  it("an unknown id goes to the bench", async () => {
    expect(await href("owner", crypto.randomUUID())).toBe(BENCH_HREF);
  });

  it("an admin-hidden primary: lands where the bench's lane points, never on the hidden image", async () => {
    const d = await makeDesign(db, "owner");
    const visible = await output(d.id, "owner", 1);
    const hiddenPrimary = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "owner",
      imageUrl: "https://r2.example/hidden.png",
      createdAt: at(2),
      publishedAt: at(3),
    });
    await setPublication(db, hiddenPrimary, { isHidden: true });
    await db
      .update(schema.design)
      .set({ primaryImageId: hiddenPrimary })
      .where(eq(schema.design.id, d.id));

    const lanes = await getStudioLanesData("owner", { db });
    const lane = lanes.find((l) => l.designId === d.id);
    expect(lane).toBeDefined();
    const expected = laneStageHref(lane!);

    const got = await href("owner", d.id);
    expect(got).toBe(expected);
    expect(got).toBe(focusHref({ designId: d.id, imageId: visible }));
    expect(got).not.toContain(hiddenPrimary);
  });

  it("a conversation whose only result is hidden goes to the bench", async () => {
    const d = await makeDesign(db, "owner");
    const only = await makeSourceImage(db, {
      designId: d.id,
      ownerId: "owner",
      imageUrl: "https://r2.example/only.png",
      createdAt: at(1),
      publishedAt: at(2),
    });
    await setPublication(db, only, { isHidden: true });

    expect(await href("owner", d.id)).toBe(BENCH_HREF);
  });

  it("does not write: no row changes for an id it redirects to the bench", async () => {
    const d = await makeDesign(db, "owner");
    const before = await db.select().from(schema.design);
    await href("owner", d.id);
    const after = await db.select().from(schema.design);
    expect(after).toEqual(before);
  });
});
