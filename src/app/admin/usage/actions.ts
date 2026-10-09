"use server";

import { headers } from "next/headers";
import { and, count, desc, eq, inArray, max, sql, type SQL } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  cartItem as cartItemTable,
  chatMessage as chatMessageTable,
  conversationImage as conversationImageTable,
  design as designTable,
  image as imageTable,
  imageGeneration as imageGenerationTable,
  imagePublication as imagePublicationTable,
  order as orderTable,
  product as productTable,
  session as sessionTable,
  user as userTable,
} from "@/lib/db/schema";
import { isAdminEmail } from "@/lib/admin";
import { mirrorFrontImageId } from "@/lib/composition-reads";
import {
  USAGE_IMAGES_LIMIT,
  USAGE_LIST_LIMIT,
  buildUsageRow,
  clampLimit,
  mergeUsageRows,
  type GenerationAgg,
  type OrderAgg,
  type UsageAggregates,
  type UsageTotals,
  type UsageUserRow,
} from "@/lib/admin-usage";
import { pacificWindowStarts } from "@/lib/pacific-day";

export type UsageImageStatus = "published" | "hidden" | "private";

export type UsageImage = {
  id: string;
  imageUrl: string;
  createdAt: Date;
  operation: "generate" | "edit" | "upload" | null;
  prompt: string | null;
  status: UsageImageStatus;
  /**
   * Pinned storefront backdrop (colour name) off the mirror product; null for
   * private images, which have none, and for a published image whose mirror
   * is missing (`publishedBackdrop` then paints the default).
   */
  backdropColor: string | null;
  /** The conversation that generated it (role=output link). */
  conversationId: string | null;
  /** Other conversations it was carried into as a seed. */
  seedIn: string[];
  /** image.luminance (#139): picks the tile's well when unpublished. */
  luminance: number | null;
};

async function requireAdmin(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!isAdminEmail(session?.user?.email, process.env.ADMIN_EMAIL)) {
    throw new Error("Unauthorized");
  }
}

// Timestamp columns are integer seconds (`timestamp`) or ms (`timestamp_ms`);
// the conditional sums below compare against raw bounds, so convert here.
const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const ms = (d: Date) => d.getTime();

/**
 * One grouped query per source table, merged in JS (never a query per user).
 * `userId` narrows every query to one user for the detail page; without it
 * each query covers all users. 10 queries run concurrently per call.
 */
async function loadAggregates(userId?: string): Promise<{
  agg: UsageAggregates;
  weekStart: Date;
}> {
  const { todayStart, weekStart } = pacificWindowStarts(new Date());
  const ig = imageGenerationTable;
  const only = (col: Parameters<typeof eq>[0]): SQL | undefined =>
    userId ? eq(col, userId) : undefined;

  const [
    users,
    generations,
    genIps,
    sessionIps,
    lastImages,
    conversations,
    chat,
    publications,
    orders,
    carts,
  ] = await Promise.all([
    db
      .select({
        id: userTable.id,
        email: userTable.email,
        isAnonymous: userTable.isAnonymous,
        createdAt: userTable.createdAt,
      })
      .from(userTable)
      .where(only(userTable.id)),

    // Spend counts succeeded and cancelled jobs: a cancelled render is billed
    // (schema.ts, generation-job.ts). Some failed jobs were billed too and can't
    // be told apart from the row, so Spend is a floor, not the Ideogram bill.
    db
      .select({
        userId: ig.userId,
        today: sql<number>`coalesce(sum(case when ${ig.status} = 'succeeded' and ${ig.startedAt} >= ${secs(todayStart)} then 1 else 0 end), 0)`,
        week: sql<number>`coalesce(sum(case when ${ig.status} = 'succeeded' and ${ig.startedAt} >= ${secs(weekStart)} then 1 else 0 end), 0)`,
        total: sql<number>`coalesce(sum(case when ${ig.status} = 'succeeded' then 1 else 0 end), 0)`,
        generateTotal: sql<number>`coalesce(sum(case when ${ig.status} = 'succeeded' and ${ig.operation} = 'generate' then 1 else 0 end), 0)`,
        editTotal: sql<number>`coalesce(sum(case when ${ig.status} = 'succeeded' and ${ig.operation} = 'edit' then 1 else 0 end), 0)`,
        failedWeek: sql<number>`coalesce(sum(case when (${ig.status} in ('failed', 'cancelled') or ${ig.cancelledAt} is not null) and ${ig.startedAt} >= ${secs(weekStart)} then 1 else 0 end), 0)`,
        spendTotal: sql<number>`coalesce(sum(case when ${ig.status} in ('succeeded', 'cancelled') then ${ig.cost} else 0 end), 0)`,
        spendWeek: sql<number>`coalesce(sum(case when ${ig.status} in ('succeeded', 'cancelled') and ${ig.startedAt} >= ${secs(weekStart)} then ${ig.cost} else 0 end), 0)`,
      })
      .from(ig)
      .where(only(ig.userId))
      .groupBy(ig.userId),

    // Bare `ip` next to max(): SQLite takes the other columns from the row
    // that holds the max, so this is the IP of the newest job with an IP.
    db
      .select({ userId: ig.userId, ip: ig.ip, at: max(ig.startedAt) })
      .from(ig)
      .where(and(sql`${ig.ip} is not null`, only(ig.userId)))
      .groupBy(ig.userId),

    db
      .select({
        userId: sessionTable.userId,
        ip: sessionTable.ipAddress,
        at: max(sessionTable.createdAt),
      })
      .from(sessionTable)
      .where(and(sql`${sessionTable.ipAddress} is not null`, only(sessionTable.userId)))
      .groupBy(sessionTable.userId),

    db
      .select({ userId: imageTable.ownerId, at: max(imageTable.createdAt) })
      .from(imageTable)
      .where(only(imageTable.ownerId))
      .groupBy(imageTable.ownerId),

    db
      .select({ userId: designTable.userId, n: count() })
      .from(designTable)
      .where(only(designTable.userId))
      .groupBy(designTable.userId),

    // User-role turns: chat messages, Generate prompts and uploads all write
    // one, so this is messages sent, not chat-API calls. created_at is ms.
    db
      .select({
        userId: designTable.userId,
        week: sql<number>`coalesce(sum(case when ${chatMessageTable.createdAt} >= ${ms(weekStart)} then 1 else 0 end), 0)`,
        lastAt: max(chatMessageTable.createdAt),
      })
      .from(chatMessageTable)
      .innerJoin(designTable, eq(designTable.id, chatMessageTable.designId))
      .where(and(eq(chatMessageTable.role, "user"), only(designTable.userId)))
      .groupBy(designTable.userId),

    db
      .select({
        userId: imageTable.ownerId,
        published: sql<number>`coalesce(sum(case when ${imagePublicationTable.isHidden} = 0 then 1 else 0 end), 0)`,
        hidden: sql<number>`coalesce(sum(case when ${imagePublicationTable.isHidden} = 1 then 1 else 0 end), 0)`,
      })
      .from(imagePublicationTable)
      .innerJoin(imageTable, eq(imageTable.id, imagePublicationTable.imageId))
      .where(only(imageTable.ownerId))
      .groupBy(imageTable.ownerId),

    db
      .select({
        userId: orderTable.userId,
        paidCount: sql<number>`coalesce(sum(case when ${orderTable.status} not in ('pending', 'canceled') and ${orderTable.abandonedAt} is null then 1 else 0 end), 0)`,
        paidRevenue: sql<number>`coalesce(sum(case when ${orderTable.status} not in ('pending', 'canceled') and ${orderTable.abandonedAt} is null then ${orderTable.totalPrice} else 0 end), 0)`,
        paidWeek: sql<number>`coalesce(sum(case when ${orderTable.status} not in ('pending', 'canceled') and ${orderTable.abandonedAt} is null and ${orderTable.createdAt} >= ${secs(weekStart)} then 1 else 0 end), 0)`,
        lastOrderAt: max(orderTable.createdAt),
      })
      .from(orderTable)
      .where(only(orderTable.userId))
      .groupBy(orderTable.userId),

    db
      .select({ userId: cartItemTable.userId, n: count() })
      .from(cartItemTable)
      .where(only(cartItemTable.userId))
      .groupBy(cartItemTable.userId),
  ]);

  const agg: UsageAggregates = {
    users,
    generations: new Map(
      generations.map((g): [string, GenerationAgg] => [
        g.userId,
        {
          today: Number(g.today),
          week: Number(g.week),
          total: Number(g.total),
          generateTotal: Number(g.generateTotal),
          editTotal: Number(g.editTotal),
          failedWeek: Number(g.failedWeek),
          spendTotal: Number(g.spendTotal),
          spendWeek: Number(g.spendWeek),
        },
      ]),
    ),
    lastImageAt: new Map(
      lastImages.flatMap((r): [string, Date][] => (r.at ? [[r.userId, r.at]] : [])),
    ),
    conversations: new Map(conversations.map((r) => [r.userId, r.n])),
    chat: new Map(
      chat.map((r) => [r.userId, { week: Number(r.week), lastAt: r.lastAt }]),
    ),
    publications: new Map(
      publications.map((r) => [
        r.userId,
        { published: Number(r.published), hidden: Number(r.hidden) },
      ]),
    ),
    orders: new Map(
      orders.map((r): [string, OrderAgg] => [
        r.userId,
        {
          paidCount: Number(r.paidCount),
          paidRevenue: Number(r.paidRevenue),
          paidWeek: Number(r.paidWeek),
          lastOrderAt: r.lastOrderAt,
        },
      ]),
    ),
    cartLines: new Map(carts.map((r) => [r.userId, r.n])),
    genIp: new Map(genIps.flatMap((r): [string, string][] => (r.ip ? [[r.userId, r.ip]] : []))),
    sessionIp: new Map(sessionIps.flatMap((r): [string, string][] => (r.ip ? [[r.userId, r.ip]] : []))),
  };
  return { agg, weekStart };
}

/**
 * Users by most recent activity, plus the last-7-days totals. `listedCount`
 * is how many users qualify before `limit` cuts the list; totals cover all
 * users, not just the listed ones.
 */
export async function getUsageList(limit: number): Promise<{
  rows: UsageUserRow[];
  totals: UsageTotals;
  listedCount: number;
}> {
  await requireAdmin();
  const bound = clampLimit(limit, USAGE_LIST_LIMIT);
  const { agg, weekStart } = await loadAggregates();
  const { rows, totals } = mergeUsageRows(agg, weekStart);
  return { rows: rows.slice(0, bound), totals, listedCount: rows.length };
}

/**
 * One user's card and their images, newest first (private ones included).
 * Null for an unknown id. An empty guest still gets a card here.
 */
export async function getUsageUser(
  userId: string,
  limit: number,
): Promise<{ row: UsageUserRow; images: UsageImage[]; imageCount: number } | null> {
  await requireAdmin();
  const bound = clampLimit(limit, USAGE_IMAGES_LIMIT);
  const { agg } = await loadAggregates(userId);
  const user = agg.users[0];
  if (!user) return null;

  const [imageRows, [countRow]] = await Promise.all([
    db
      .select({
        id: imageTable.id,
        imageUrl: imageTable.imageUrl,
        createdAt: imageTable.createdAt,
        operation: imageTable.operation,
        prompt: imageTable.prompt,
        sourceDesignId: imageTable.sourceDesignId,
        publishedAt: imagePublicationTable.publishedAt,
        isHidden: imagePublicationTable.isHidden,
        backdropColor: productTable.backdropColor,
        luminance: imageTable.luminance,
      })
      .from(imageTable)
      .leftJoin(imagePublicationTable, eq(imagePublicationTable.imageId, imageTable.id))
      .leftJoin(productTable, eq(mirrorFrontImageId, imageTable.id))
      .where(eq(imageTable.ownerId, userId))
      .orderBy(desc(imageTable.createdAt), desc(imageTable.id))
      .limit(bound),
    db.select({ n: count() }).from(imageTable).where(eq(imageTable.ownerId, userId)),
  ]);

  const links = imageRows.length
    ? await db
        .select({
          imageId: conversationImageTable.imageId,
          designId: conversationImageTable.designId,
          role: conversationImageTable.role,
        })
        .from(conversationImageTable)
        .where(inArray(conversationImageTable.imageId, imageRows.map((i) => i.id)))
    : [];

  const images: UsageImage[] = imageRows.map((i) => {
    const mine = links.filter((l) => l.imageId === i.id);
    return {
      id: i.id,
      imageUrl: i.imageUrl,
      createdAt: i.createdAt,
      operation: i.operation,
      prompt: i.prompt,
      status: i.publishedAt ? (i.isHidden ? "hidden" : "published") : "private",
      backdropColor: i.publishedAt ? (i.backdropColor ?? null) : null,
      conversationId:
        mine.find((l) => l.role === "output")?.designId ?? i.sourceDesignId ?? null,
      seedIn: mine.filter((l) => l.role === "seed").map((l) => l.designId),
      luminance: i.luminance,
    };
  });

  return {
    row: buildUsageRow(user, agg),
    images,
    imageCount: countRow?.n ?? 0,
  };
}
