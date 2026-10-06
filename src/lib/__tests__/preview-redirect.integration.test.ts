/**
 * resolvePreviewRedirect (#278 slice 4) against a real in-memory libSQL: where
 * an old `/preview` link goes. The db singleton is mocked to the real test DB;
 * the viewer is an argument, so no auth mock is needed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/__tests__/test-db";
import * as schema from "@/lib/db/schema";
import { makeUser, makeDesign, makeSourceImage } from "@/lib/__tests__/factories";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import { resolvePreviewRedirect } from "@/lib/preview-redirect";

type Db = Awaited<ReturnType<typeof createTestDb>>;

const P = "bella-canvas-3001";

async function seed(db: Db) {
  await makeUser(db, "owner");
  await makeUser(db, "stranger");

  const conv = await makeDesign(db, "owner");
  const primary = await makeSourceImage(db, {
    designId: conv.id,
    ownerId: "owner",
    imageUrl: "https://img.example/primary.png",
  });
  const second = await makeSourceImage(db, {
    designId: conv.id,
    ownerId: "owner",
    imageUrl: "https://img.example/second.png",
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: primary })
    .where(eq(schema.design.id, conv.id));

  const otherConv = await makeDesign(db, "owner");
  const elsewhere = await makeSourceImage(db, {
    designId: otherConv.id,
    ownerId: "owner",
    imageUrl: "https://img.example/elsewhere.png",
  });

  const empty = await makeDesign(db, "owner");
  await makeSourceImage(db, {
    designId: empty.id,
    ownerId: "owner",
    imageUrl: "https://img.example/empty.png",
  });

  const hiddenConv = await makeDesign(db, "owner");
  const hiddenPrimary = await makeSourceImage(db, {
    designId: hiddenConv.id,
    ownerId: "owner",
    imageUrl: "https://img.example/hidden.png",
    publishedAt: new Date(),
    isHidden: true,
  });
  await db
    .update(schema.design)
    .set({ primaryImageId: hiddenPrimary })
    .where(eq(schema.design.id, hiddenConv.id));

  return {
    conv: conv.id,
    otherConv: otherConv.id,
    empty: empty.id,
    hiddenConv: hiddenConv.id,
    primary,
    second,
    elsewhere,
    hiddenPrimary,
  };
}

beforeEach(async () => {
  h.db = await createTestDb();
});

describe("resolvePreviewRedirect (#278 slice 4)", () => {
  it("no id, or a malformed one, goes to /design", async () => {
    await seed(h.db as Db);
    expect(await resolvePreviewRedirect({}, "owner")).toBe("/design");
    expect(await resolvePreviewRedirect({ id: "a b" }, "owner")).toBe("/design");
  });

  it("a signed-out viewer signs in and comes back to the same link", async () => {
    const ids = await seed(h.db as Db);
    expect(await resolvePreviewRedirect({ id: ids.conv, size: "M" }, null)).toBe(
      "/sign-in?next=" + encodeURIComponent(`/preview?id=${ids.conv}&size=M`)
    );
  });

  it("the sign-in return carries neither unknown keys nor invalid picks", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolvePreviewRedirect({ id: ids.conv, junk: "x", size: "9XL" }, null)
    ).toBe("/sign-in?next=" + encodeURIComponent(`/preview?id=${ids.conv}`));
  });

  it("the owner lands on the primary's page with the panel open", async () => {
    const ids = await seed(h.db as Db);
    expect(await resolvePreviewRedirect({ id: ids.conv }, "owner")).toBe(
      `/d/${ids.primary}?order=1`
    );
  });

  it("carries product, size and colour", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolvePreviewRedirect(
        { id: ids.conv, product: P, size: "M", color: "Black" },
        "owner"
      )
    ).toBe(`/d/${ids.primary}?order=1&product=${P}&size=M&color=Black`);
  });

  it("drops a discontinued product and sizes or colours nothing offers", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolvePreviewRedirect(
        { id: ids.conv, product: "discontinued-tee", size: "9XL", color: "Plaid" },
        "owner"
      )
    ).toBe(`/d/${ids.primary}?order=1`);
  });

  it("a conversation with no primary goes to /design?id=", async () => {
    const ids = await seed(h.db as Db);
    expect(await resolvePreviewRedirect({ id: ids.empty }, "owner")).toBe(
      `/design?id=${ids.empty}`
    );
  });

  it("the front names the page", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolvePreviewRedirect({ id: ids.conv, front: ids.second }, "owner")
    ).toBe(`/d/${ids.second}?order=1`);
  });

  it("carries the back", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolvePreviewRedirect(
        { id: ids.conv, front: ids.primary, back: ids.second },
        "owner"
      )
    ).toBe(`/d/${ids.primary}?order=1&back=${ids.second}`);
  });

  it("a swapped link (front from elsewhere, back from this conversation) opens the back's page with swap=1", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolvePreviewRedirect(
        { id: ids.conv, front: ids.elsewhere, back: ids.primary },
        "owner"
      )
    ).toBe(`/d/${ids.primary}?order=1&back=${ids.elsewhere}&swap=1`);
  });

  it("neither image in the conversation keeps the front as the page", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolvePreviewRedirect(
        { id: ids.conv, front: ids.elsewhere, back: "img-shop" },
        "owner"
      )
    ).toBe(`/d/${ids.elsewhere}?order=1&back=img-shop`);
  });

  it("a back equal to the front is dropped", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolvePreviewRedirect(
        { id: ids.conv, front: ids.second, back: ids.second },
        "owner"
      )
    ).toBe(`/d/${ids.second}?order=1`);
  });

  it("a hidden primary is still the target; the page decides", async () => {
    const ids = await seed(h.db as Db);
    expect(await resolvePreviewRedirect({ id: ids.hiddenConv }, "owner")).toBe(
      `/d/${ids.hiddenPrimary}?order=1`
    );
  });

  it("a signed-in viewer who does not own the conversation never sees its primary", async () => {
    const ids = await seed(h.db as Db);
    const noFront = await resolvePreviewRedirect({ id: ids.conv }, "stranger");
    expect(noFront).toBe("/design");
    expect(noFront).not.toContain(ids.primary);
    expect(
      await resolvePreviewRedirect(
        { id: ids.conv, front: ids.second, size: "L" },
        "stranger"
      )
    ).toBe(`/d/${ids.second}?order=1&size=L`);
  });

  it("a conversation that does not exist is treated like someone else's", async () => {
    await seed(h.db as Db);
    expect(await resolvePreviewRedirect({ id: "no-such-design" }, "owner")).toBe(
      "/design"
    );
  });

  it("takes the first of a repeated id", async () => {
    const ids = await seed(h.db as Db);
    expect(
      await resolvePreviewRedirect({ id: [ids.conv, ids.otherConv] }, "owner")
    ).toBe(`/d/${ids.primary}?order=1`);
  });

  it("an old Stripe cancel_url from /preview lands on the same shirt", async () => {
    const ids = await seed(h.db as Db);
    const qs = `id=${ids.conv}&size=${encodeURIComponent("M")}&color=${encodeURIComponent("Athletic Heather")}&product=${P}&front=${ids.second}&back=${ids.primary}`;
    const search = Object.fromEntries(new URLSearchParams(qs));
    const target = new URL(
      await resolvePreviewRedirect(search, "owner"),
      "http://x.invalid"
    );
    expect(target.pathname).toBe(`/d/${ids.second}`);
    expect(Object.fromEntries(target.searchParams)).toEqual({
      order: "1",
      product: P,
      size: "M",
      color: "Athletic Heather",
      back: ids.primary,
    });
  });
});
