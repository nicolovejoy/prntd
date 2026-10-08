/**
 * Render tests for /admin/usage and /admin/usage/[userId] over a real
 * in-memory libSQL: the real actions feed the real server components.
 * Clock: 2026-10-08 20:00Z (Pacific today starts 07:00Z).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import * as schema from "@/lib/db/schema";
import { createTestDb } from "@/lib/__tests__/test-db";

const h = vi.hoisted(() => {
  process.env.ADMIN_EMAIL = "admin@example.com";
  return { db: null as unknown, email: "admin@example.com" as string | null };
});

vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (h.email ? { user: { email: h.email } } : null),
    },
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import AdminUsagePage from "../page";
import AdminUsageUserPage from "../[userId]/page";

type Db = Awaited<ReturnType<typeof createTestDb>>;
const db = () => h.db as Db;
const t = (iso: string) => new Date(iso);

const ACCOUNT = "acct-0001-aaaa";
const EMPTY_GUEST = "guest-empty-cccc";
const LONG_PROMPT = `${"a long prompt ".repeat(14)}END-OF-PROMPT`;

beforeEach(async () => {
  h.db = await createTestDb();
  h.email = "admin@example.com";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(t("2026-10-08T20:00:00Z"));

  await db().insert(schema.user).values([
    { id: ACCOUNT, email: "acct@example.com", name: "A", isAnonymous: false, createdAt: t("2026-09-01T00:00:00Z") },
    { id: EMPTY_GUEST, email: "e@guest.invalid", name: "E", isAnonymous: true, createdAt: t("2026-10-07T01:00:00Z") },
  ]);
  const [d1] = await db().insert(schema.design).values({ userId: ACCOUNT }).returning();
  const [ed] = await db().insert(schema.design).values({ userId: EMPTY_GUEST }).returning();

  let n = 0;
  const job = (userId: string, designId: string, status: "succeeded" | "failed", operation: "generate" | "edit", at: string, cost: number) => {
    n += 1;
    return db().insert(schema.imageGeneration).values({
      userId, designId, status, operation, imageId: `ji-${n}`, r2Key: `images/ji-${n}.png`,
      generationNumber: n, dayKey: "2026-10-08", cost, startedAt: t(at),
    });
  };
  await job(ACCOUNT, d1.id, "succeeded", "generate", "2026-10-08T10:00:00Z", 0.03);
  await job(ACCOUNT, d1.id, "succeeded", "edit", "2026-10-05T10:00:00Z", 0.2);
  await job(ACCOUNT, d1.id, "failed", "generate", "2026-10-06T10:00:00Z", 0);
  await job(EMPTY_GUEST, ed.id, "failed", "generate", "2026-10-07T11:00:00Z", 0);

  await db().insert(schema.image).values([
    { id: "img-pub", ownerId: ACCOUNT, imageUrl: "https://pub.r2.dev/images/img-pub.png", aspectRatio: "1:1", prompt: "a red fox", operation: "generate", sourceDesignId: d1.id, createdAt: t("2026-10-08T10:00:00Z") },
    { id: "img-priv", ownerId: ACCOUNT, imageUrl: "https://pub.r2.dev/images/img-priv.png", aspectRatio: "1:1", prompt: LONG_PROMPT, operation: "edit", sourceDesignId: d1.id, createdAt: t("2026-10-05T10:00:00Z") },
  ]);
  await db().insert(schema.conversationImage).values([
    { designId: d1.id, imageId: "img-pub", role: "output" },
    { designId: d1.id, imageId: "img-priv", role: "output" },
  ]);
  await db().insert(schema.imagePublication).values({ imageId: "img-pub", publishedAt: t("2026-10-08T10:00:00Z") });
  await db().insert(schema.chatMessage).values({ designId: d1.id, role: "user", content: "hi", createdAt: t("2026-10-08T09:00:00Z") });
  await db().insert(schema.order).values({ userId: ACCOUNT, designId: d1.id, totalPrice: 30, status: "paid", createdAt: t("2026-10-06T10:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

const listProps = { searchParams: Promise.resolve({}) };

describe("/admin/usage", () => {
  it("redirects a non-admin", async () => {
    h.email = "someone@example.com";
    await expect(AdminUsagePage(listProps)).rejects.toThrow("REDIRECT:/");
    h.email = null;
    await expect(AdminUsagePage(listProps)).rejects.toThrow("REDIRECT:/");
  });

  it("renders the totals row and one card per listed user", async () => {
    render(await AdminUsagePage(listProps));
    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();

    // The totals row is the first <dl>; cards carry some of the same labels.
    const totalsRow = within(document.querySelector("dl") as HTMLElement);
    const totalOf = (label: string) =>
      totalsRow.getByText(label).parentElement!.querySelector("dd")!.textContent;
    expect(totalOf("Active users, 7 d")).toBe("1");
    expect(totalOf("Generations, 7 d")).toBe("2");
    expect(totalOf("Failed or cancelled, 7 d")).toBe("2");
    expect(totalOf("Spend, 7 d")).toBe("$0.23");
    expect(totalOf("Paid orders, 7 d")).toBe("1");

    // The empty guest has no card; the account has one linking to its page.
    const cards = screen.getAllByTestId("usage-card");
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card).toHaveAttribute("href", `/admin/usage/${ACCOUNT}`);
    const c = within(card);
    expect(c.getByText("acct@example.com")).toBeInTheDocument();
    expect(c.getByText("ACCOUNT")).toBeInTheDocument();
    const valueOf = (label: string) =>
      c.getByText(label).parentElement!.querySelector("dd")!.textContent;
    expect(valueOf("Generations today · 7 d · all")).toBe("1 · 2 · 2");
    expect(valueOf("Generate · edit")).toBe("1 · 1");
    expect(valueOf("Failed or cancelled, 7 d")).toBe("1");
    expect(valueOf("Spend")).toBe("$0.23");
    expect(valueOf("Conversations")).toBe("1");
    expect(valueOf("Messages sent, 7 d")).toBe("1");
    expect(valueOf("Published")).toBe("1");
    expect(valueOf("Paid orders · revenue")).toBe("1 · $30.00");
    expect(valueOf("Last IP")).toBe("—");
    expect(c.queryByText("Open cart lines")).toBeNull();
    expect(screen.getByText(/Showing 1 of 1 users/)).toBeInTheDocument();
  });
});

describe("/admin/usage/[userId]", () => {
  const props = (userId: string) => ({
    params: Promise.resolve({ userId }),
    searchParams: Promise.resolve({}),
  });

  it("redirects a non-admin", async () => {
    h.email = "someone@example.com";
    await expect(AdminUsageUserPage(props(ACCOUNT))).rejects.toThrow("REDIRECT:/");
  });

  it("404s for an unknown user id", async () => {
    await expect(AdminUsageUserPage(props("nope"))).rejects.toThrow("NOT_FOUND");
  });

  it("renders the card and the user's images, private ones with an open-image link", async () => {
    render(await AdminUsageUserPage(props(ACCOUNT)));
    const card = screen.getByTestId("usage-card");
    expect(card).not.toHaveAttribute("href");
    expect(within(card).getByText("acct@example.com")).toBeInTheDocument();

    const cells = screen.getAllByTestId("usage-image");
    expect(cells.map((c) => c.getAttribute("data-image-id"))).toEqual(["img-pub", "img-priv"]);

    const [pub, priv] = cells.map((c) => within(c));
    expect(pub.getByText("Published")).toBeInTheDocument();
    expect(pub.getByText("a red fox")).toBeInTheDocument();
    expect(pub.queryByText("open image")).toBeNull();
    expect(pub.getByRole("link", { name: "Image img-pub" })).toHaveAttribute("href", "/d/img-pub");

    expect(priv.queryByText("Published")).toBeNull();
    expect(priv.getByText("open image")).toHaveAttribute(
      "href",
      "https://pub.r2.dev/images/img-priv.png",
    );
    // Long prompt: first 140 chars in the summary, everything in the body.
    const details = cells[1].querySelector("details")!;
    expect(details.querySelector("summary")!.textContent).toBe(`${LONG_PROMPT.slice(0, 140)}…`);
    expect(details.textContent).toContain("END-OF-PROMPT");
    expect(screen.getByText(/Showing 2 of 2 images/)).toBeInTheDocument();
  });

  it("renders a card and no images for a guest with none", async () => {
    render(await AdminUsageUserPage(props(EMPTY_GUEST)));
    expect(
      within(screen.getByTestId("usage-card")).getByText("guest · guest-em"),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("usage-card")).getByText("GUEST")).toBeInTheDocument();
    expect(screen.getByText("No images.")).toBeInTheDocument();
  });
});
