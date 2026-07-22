import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  // Better-Auth anonymous plugin: true for guest browsers that haven't signed
  // in yet (#26 guest funnel). On sign-in/up the plugin's onLinkAccount
  // re-parents their designs/orders to the real account, then deletes the anon
  // row. Nullable/default-false so existing rows and the plugin agree.
  isAnonymous: integer("is_anonymous", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const design = sqliteTable("design", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id),
  status: text("status", { enum: ["draft", "approved", "ordered", "archived"] }).notNull().default("draft"),
  // The user's anchor pick — the design_image they want products
  // built from. Resolved via getDesignDisplayImageUrl helpers; falls
  // back to the latest source design_image when null.
  primaryImageId: text("primary_image_id"),
  generationCount: integer("generation_count").notNull().default(0),
  generationCost: real("generation_cost").notNull().default(0),
  mockupUrls: text("mockup_urls", { mode: "json" }).$type<Record<string, string>>(),
  // Fork lineage. forked_from_image_id records which published image
  // seeded this thread (null on original threads). original_designer_id
  // is the user at the root of the attribution chain — denormalized so
  // attribution lookups don't have to walk the chain.
  originalDesignerId: text("original_designer_id"),
  forkedFromImageId: text("forked_from_image_id"),
  // Multi-generator: the thread's active image generator (adapter id).
  // Null resolves to DEFAULT_GENERATOR_ID. Set when the user adopts a
  // compared image.
  activeGeneratorId: text("active_generator_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const chatMessage = sqliteTable("chat_message", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  designId: text("design_id").notNull().references(() => design.id),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  imageId: text("image_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const designImage = sqliteTable("design_image", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  designId: text("design_id").notNull().references(() => design.id),
  // Provenance: the image this one was derived from (regenerated at a
  // different aspect, or iterated via chat). Null for the original
  // generation in a thread.
  parentImageId: text("parent_image_id"),
  aspectRatio: text("aspect_ratio").notNull(), // "1:1", "4:5", "1:2"
  // When this image was generated for a specific product placement
  // (Phase 3), these get set. Null on exploratory 1:1 generations.
  productId: text("product_id"),
  placementId: text("placement_id"),
  imageUrl: text("image_url").notNull(),
  prompt: text("prompt"),
  generationCost: real("generation_cost").notNull().default(0),
  isApproved: integer("is_approved", { mode: "boolean" }).notNull().default(false),
  // Publish model. published_at is set once on first publish; non-null
  // implies the image is in the discover feed and the row is immortal
  // (deleteDesignImage refuses). is_hidden is admin moderation —
  // excludes from feed but leaves the row intact. title + description
  // are the public listing; AI-proposed on publish, owner-editable.
  publishedAt: integer("published_at", { mode: "timestamp" }),
  isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
  title: text("title"),
  description: text("description"),
  // Storefront backdrop. Published art is a transparent PNG; the owner can
  // pin a shirt color behind it (a color name from the default product
  // palette). Null → checkerboard, the neutral default.
  backgroundColor: text("background_color"),
  // Multi-generator: which adapter produced this image ("ideogram",
  // "recraft"). Null on historical rows (pre-feature).
  generator: text("generator"),
  // Admin-controlled Shop feed position. Lower ranks list first; null
  // (the default) falls back to recency, so unranked images behave as
  // before. Set from /admin/published.
  feedRank: integer("feed_rank"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const order = sqliteTable("order", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id),
  designId: text("design_id").notNull().references(() => design.id),
  // Phase 2: maps placement id → design_image id. Today only "front" is
  // populated; multi-placement is Phase 4. Null on pre-Phase-2 orders;
  // resolution falls back to the design's primary image.
  placements: text("placements", { mode: "json" }).$type<Record<string, string>>(),
  printfulOrderId: text("printful_order_id"),
  stripeSessionId: text("stripe_session_id"),
  size: text("size").notNull(),
  color: text("color").notNull(),
  productId: text("product_id").notNull().default("bella-canvas-3001"),
  // Organizer-pivot Phase 3 attribution (nullable, no backfill). A storefront
  // sale links to the store + the organizer `product` (the design × blank ×
  // price sellable) so a later payout phase can sum proceeds per org.
  // `storeProductId` is distinct from the legacy `productId` above, which holds
  // a *blank* catalog id, not a `product.id`. Null for non-storefront orders.
  storeId: text("store_id").references(() => store.id),
  storeProductId: text("store_product_id").references(() => product.id),
  displayName: text("display_name"),
  quality: text("quality"),  // deprecated — kept for historical orders
  totalPrice: real("total_price").notNull(),
  // Phase 1B/1C price split. totalPrice stays the grand total (back-compat
  // for admin margin math); these break it down so it's auditable:
  // totalPrice = itemPrice + shippingPrice + taxCollected. All nullable —
  // no backfill (pre-split orders leave these null, same convention as the
  // April-1 ledger start). shippingPrice = the real-time Printful quote
  // charged as a separate Stripe shipping line (excluded from % promos).
  // taxCollected = customer tax (1C — null while unregistered; Printful's
  // fulfillment tax stays in COGS, never here).
  itemPrice: real("item_price"),
  shippingPrice: real("shipping_price"),
  taxCollected: real("tax_collected"),
  status: text("status", { enum: ["pending", "paid", "submitted", "shipped", "delivered", "canceled"] }).notNull().default("pending"),
  shippingName: text("shipping_name"),
  shippingAddress1: text("shipping_address1"),
  shippingAddress2: text("shipping_address2"),
  shippingCity: text("shipping_city"),
  shippingState: text("shipping_state"),
  shippingZip: text("shipping_zip"),
  shippingCountry: text("shipping_country"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  printfulCost: real("printful_cost"),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  classification: text("classification"),
  discountCode: text("discount_code"),
  discountAmount: real("discount_amount"),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/**
 * Order line items (#26 Stage B). One row per shirt in a multi-item order:
 * its own product/size/color/placements and price split. The parent `order`
 * keeps order-level money (totalPrice, shippingPrice — shipping is charged once
 * per order, not per item) and the ledger linkage. Single-item orders may keep
 * using the scalar columns on `order`; the cart flow writes order_item rows.
 * printfulCost is the per-item COGS read back from Printful's invoice.
 */
export const orderItem = sqliteTable("order_item", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text("order_id").notNull().references(() => order.id),
  designId: text("design_id").notNull().references(() => design.id),
  productId: text("product_id").notNull(),
  size: text("size").notNull(),
  color: text("color").notNull(),
  // placement id → design_image id (front + optional back, #25 shape per item).
  placements: text("placements", { mode: "json" }).$type<Record<string, string>>(),
  quantity: integer("quantity").notNull().default(1),
  itemPrice: real("item_price").notNull(),
  printfulCost: real("printful_cost"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/**
 * Persistent cart (#26 Stage B). Keyed by user — one cart per account, anon or
 * real — so it survives the guest→account claim (re-parented in auth.ts's
 * onLinkAccount alongside design/order). One row per line the customer added;
 * checkout turns these into an order + order_item rows, and the Stripe webhook
 * clears the purchased lines on payment (#38) — never at session creation, so
 * backing out of checkout keeps the cart.
 */
export const cartItem = sqliteTable("cart_item", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id),
  designId: text("design_id").notNull().references(() => design.id),
  productId: text("product_id").notNull(),
  size: text("size").notNull(),
  color: text("color").notNull(),
  placements: text("placements", { mode: "json" }).$type<Record<string, string>>(),
  quantity: integer("quantity").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/**
 * Organizer-first pivot (Phase 1). A named, shareable shop owned by an
 * organizer. Many-per-organizer, optimized-for-one: no unique constraint on
 * ownerId, but the dashboard defaults hard to a single store. `slug` is the
 * public URL key (/shop/<slug>), unique across all stores. Re-parented to the
 * real account on the guest→account claim (auth.ts onLinkAccount), alongside
 * design/order/cart. Object model: docs/organizer-pivot-plan.md.
 */
export const store = sqliteTable("store", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id").notNull().references(() => user.id),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  // The one per-store brand color (a name from the blank palette, or a hex).
  // Null → falls back to the monochrome chrome.
  accentColor: text("accent_color"),
  status: text("status", { enum: ["draft", "live", "hidden"] }).notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/**
 * A catalog category of blanks with an availability window (new / seasonal /
 * expiring). Maps to Printful's catalog-categories; the dated window is ours
 * and generalizes the per-blank `discontinued` flag. PRNTD-owned (no ownerId).
 * `availableFrom`/`availableUntil` null → always on.
 */
export const productOffering = sqliteTable("product_offering", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  // Join to Printful's category id when this mirrors one of theirs.
  printfulCategoryId: integer("printful_category_id"),
  availableFrom: integer("available_from", { mode: "timestamp" }),
  availableUntil: integer("available_until", { mode: "timestamp" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/**
 * The organizer's sellable: a design placed on a blank at one or more
 * placements, priced. Persists the config that today is assembled at
 * /preview → /order and thrown away. One design → many products. `blankId` is
 * a catalog blank id (blanks.ts, e.g. "bella-canvas-3001") — NOT a FK, the
 * catalog is config not a table. `placements` maps a placement key
 * (front_large/back/…) → the design_image id printed there. `storeId` nullable:
 * a product can exist loose before it's added to a shop. `price` null → the
 * computed default (computeOrderTotal). Re-parented on the guest→account claim.
 */
export const product = sqliteTable("product", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id").notNull().references(() => user.id),
  storeId: text("store_id").references(() => store.id),
  designId: text("design_id").notNull().references(() => design.id),
  blankId: text("blank_id").notNull(),
  // placement key → design_image id (e.g. { front_large: "<imageId>" }).
  placements: text("placements", { mode: "json" }).$type<Record<string, string>>(),
  // Organizer price override; null = computed default at checkout.
  price: real("price"),
  status: text("status", { enum: ["draft", "listed", "hidden"] }).notNull().default("draft"),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const ledgerEntry = sqliteTable(
  "ledger_entry",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orderId: text("order_id").references(() => order.id),
    type: text("type").notNull(), // sale, stripe_fee, cogs, refund, refund_cogs_reversal
    amount: real("amount").notNull(), // positive = money in, negative = money out
    currency: text("currency").notNull().default("USD"),
    description: text("description").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  // #37 idempotency backstop: every current entry type occurs at most once per
  // order, so a webhook redelivery that races the live run trips this index and
  // its whole db.batch rolls back. Rows with NULL order_id (manual entries) are
  // exempt — SQLite treats NULLs as distinct in unique indexes.
  (t) => [uniqueIndex("ledger_entry_order_type_unique").on(t.orderId, t.type)]
);

/**
 * Per-day generation counters for the guest-funnel abuse guard (#26 A3).
 * One row per (bucket, day): bucket is "user:<id>" (the anon or real user) or
 * "ip:<addr>". Incremented before each Replicate/Anthropic generation; over the
 * daily cap → the action returns a "sign in to keep designing" message with no
 * API spend. Ephemeral accounting, not financial — safe to prune old days.
 */
export const generationUsage = sqliteTable(
  "generation_usage",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    bucket: text("bucket").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD (UTC)
    count: integer("count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("generation_usage_bucket_day").on(t.bucket, t.day)]
);

/**
 * Model B (conversation/image split, docs/model-b-migration-plan.md). The
 * standalone artifact: a generated image, owned by a user, reusable across
 * conversations. On backfill every row keeps its `design_image.id` (id reuse
 * §2) so order/product/cart placement refs — which store image ids as opaque
 * strings — never move.
 *
 * Slice 1 dual-writes this alongside `design_image` for source generations;
 * readers stay on `design_image` until slice 2. Immutability guardrail
 * (§3): nothing may update `imageUrl`/`r2Key`/`prompt` after insert — the
 * write layer (src/lib/model-b-writes.ts) exposes no such helper, so a listing
 * that points at a row is a snapshot by construction.
 *
 * Image-id columns (parent/seed/original-designer/source-design) are opaque
 * text, no FK — matching the existing schema (design.forkedFromImageId,
 * design_image.parentImageId are FK-less) and the id-reuse contract, and
 * avoiding backfill/dual-write ordering hazards. Only `ownerId` (→ user) is a
 * FK, so reparenting and owner joins stay sound.
 */
export const image = sqliteTable("image", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id").notNull().references(() => user.id),
  // Null when a legacy URL can't be parsed to a key; imageUrl is authoritative
  // for display, r2Key is best-effort for object operations.
  r2Key: text("r2_key"),
  imageUrl: text("image_url").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  prompt: text("prompt"),
  generator: text("generator"),
  generationCost: real("generation_cost").notNull().default(0),
  // Within-thread iteration chain (was design_image.parentImageId).
  parentImageId: text("parent_image_id"),
  // Cross-conversation lineage (was design.forkedFromImageId).
  seedImageId: text("seed_image_id"),
  // Denormalized attribution root (was design.originalDesignerId).
  originalDesignerId: text("original_designer_id"),
  // The conversation that generated it (mirrors the role=output link).
  sourceDesignId: text("source_design_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/**
 * Model B join between a conversation (`design`) and an `image`. `output` =
 * the conversation generated it; `seed` = it was carried into the conversation
 * as a starting point (replaces the copy-based fork in a later slice). Many
 * conversations can reference one image. `imageId` is opaque text (no FK) per
 * the id-reuse contract; `designId` FKs `design` (always present).
 */
export const conversationImage = sqliteTable(
  "conversation_image",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    designId: text("design_id").notNull().references(() => design.id),
    imageId: text("image_id").notNull(),
    role: text("role", { enum: ["output", "seed"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("conversation_image_unique").on(t.designId, t.imageId, t.role)]
);

/**
 * Model B published-listing state, split off `design_image` (simplification
 * item 3). One listing per image (PK = imageId). A row exists iff the image is
 * published — unpublish deletes it. Naming/hidden/feed-rank edits update it in
 * lockstep with the `design_image` publish columns during the dual-write
 * window (risky spot §3). `imageId` is opaque text (no FK).
 */
export const listing = sqliteTable("listing", {
  imageId: text("image_id").primaryKey(),
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
  isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
  title: text("title"),
  description: text("description"),
  backgroundColor: text("background_color"),
  feedRank: integer("feed_rank"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/**
 * Model B placement-render cache, split off `design_image` (simplification
 * item 3). These are derived renders (a source image composed onto a blank's
 * placement), not artifacts — they never appear as `image` rows. On backfill
 * each keeps its `design_image.id` (id reuse) so orders that pin a render id in
 * their placements keep resolving. `sourceImageId` is the #25 anchor (was
 * design_image.parentImageId); `blankId` was design_image.productId.
 */
export const placementRender = sqliteTable("placement_render", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  designId: text("design_id").notNull().references(() => design.id),
  sourceImageId: text("source_image_id"),
  blankId: text("blank_id").notNull(),
  placementId: text("placement_id").notNull(),
  imageUrl: text("image_url").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  generationCost: real("generation_cost").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type ChatMessage = {
  id: string;
  designId: string;
  role: "user" | "assistant";
  content: string;
  imageId: string | null;
  createdAt: Date;
};

/**
 * Shape of rows in the legacy `design.chat_history` JSON column. Used only
 * by the backfill migration script. Production code reads from the
 * `chat_message` table instead.
 */
export type LegacyChatMessage = {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  fluxPrompt?: string;
  generationNumber?: number;
};
