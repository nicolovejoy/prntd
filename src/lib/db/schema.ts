import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
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
  chatHistory: text("chat_history", { mode: "json" }).$type<ChatMessage[]>(),
  currentImageUrl: text("current_image_url"),
  generationCount: integer("generation_count").notNull().default(0),
  generationCost: real("generation_cost").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const order = sqliteTable("order", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => user.id),
  designId: text("design_id").notNull().references(() => design.id),
  printfulOrderId: text("printful_order_id"),
  stripeSessionId: text("stripe_session_id"),
  size: text("size").notNull(),
  color: text("color").notNull(),
  quality: text("quality", { enum: ["standard", "premium"] }).notNull(),
  totalPrice: real("total_price").notNull(),
  status: text("status", { enum: ["pending", "paid", "submitted", "shipped", "delivered"] }).notNull().default("pending"),
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
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  fluxPrompt?: string;
  generationNumber?: number;
};
