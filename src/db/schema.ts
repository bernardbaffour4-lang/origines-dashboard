// Origines Parts — unified multi-channel e-commerce data model.
// Every channel (eBay, Wix, ...) is synced INTO these tables;
// the dashboard only ever reads from here.

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const money = (name: string) => numeric(name, { precision: 10, scale: 2 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

// ---------- Enums ----------

export const channelEnum = pgEnum("channel", ["EBAY", "WIX", "MANUAL"]);
export const conditionEnum = pgEnum("condition", [
  "NEW",
  "USED_A",
  "USED_B",
  "USED_C",
  "REFURBISHED",
  "FOR_PARTS",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "AWAITING_PAYMENT",
  "PAID",
  "PICKED",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);
export const returnStatusEnum = pgEnum("return_status", [
  "REQUESTED",
  "APPROVED",
  "IN_TRANSIT",
  "RECEIVED",
  "INSPECTED",
  "REFUNDED",
  "REJECTED",
]);
export const stockReasonEnum = pgEnum("stock_reason", [
  "SALE",
  "RETURN_RESTOCK",
  "MANUAL_ADJUST",
  "PURCHASE",
  "DAMAGED",
  "CANCELLATION",
]);

export type ChannelName = (typeof channelEnum.enumValues)[number];
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

// ---------- Channel connections ----------

export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: id(),
    channel: channelEnum("channel").notNull(),
    label: text("label").notNull(), // "eBay UK", "Wix site"
    externalAccountId: text("external_account_id"), // eBay username / Wix site ID
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    lastOrderSyncAt: timestamp("last_order_sync_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("channel_accounts_channel_label").on(t.channel, t.label)],
);

// ---------- Catalogue ----------

export const products = pgTable(
  "products",
  {
    id: id(),
    sku: text("sku").notNull().unique(), // internal SKU — single source of truth
    title: text("title").notNull(),
    brand: text("brand"), // BMW, Mercedes, Audi...
    category: text("category"), // Headlight, Tail light, Lens...
    oemPartNumber: text("oem_part_number"),
    altPartNumbers: text("alt_part_numbers").array().notNull().default([]),
    side: text("side"), // LEFT / RIGHT / PAIR
    drive: text("drive"), // LHD / RHD
    lightingType: text("lighting_type"), // HALOGEN / XENON / LED / ADAPTIVE_LED / LASER
    facelift: text("facelift"), // PRE_LCI / LCI
    condition: conditionEnum("condition").notNull().default("USED_A"),
    conditionNotes: text("condition_notes"),
    costPrice: money("cost_price"),
    quantity: integer("quantity").notNull().default(0),
    lowStockAt: integer("low_stock_at").notNull().default(1),
    binLocation: text("bin_location"),
    sourceNote: text("source_note"), // donor car / supplier / auction
    imageUrls: text("image_urls").array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_oem").on(t.oemPartNumber),
    index("products_brand_cat").on(t.brand, t.category),
  ],
);

export const fitments = pgTable(
  "fitments",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    make: text("make").notNull(),
    model: text("model").notNull(),
    chassisCode: text("chassis_code"), // F30, G20, W205...
    yearFrom: integer("year_from"),
    yearTo: integer("year_to"),
    engine: text("engine"),
    notes: text("notes"),
  },
  (t) => [index("fitments_lookup").on(t.make, t.model, t.chassisCode)],
);

export const channelListings = pgTable(
  "channel_listings",
  {
    id: id(),
    channelAccountId: text("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id),
    externalId: text("external_id").notNull(), // eBay listingId / Wix product ID
    externalSku: text("external_sku"),
    title: text("title"),
    price: money("price"),
    currency: text("currency").notNull().default("GBP"),
    quantity: integer("quantity"),
    status: text("status"), // ACTIVE / ENDED / ERROR
    lastError: text("last_error"),
    // eBay listing details (filled by the listing sync)
    listingType: text("listing_type"), // FixedPriceItem / Chinese (auction)
    hasVariations: boolean("has_variations").notNull().default(false),
    startTime: timestamp("start_time", { withTimezone: true }),
    quantitySold: integer("quantity_sold"),
    watchCount: integer("watch_count"),
    viewUrl: text("view_url"),
    imageUrl: text("image_url"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("listings_account_ext").on(t.channelAccountId, t.externalId),
    index("listings_start").on(t.startTime),
  ],
);

// One row per end-and-relist attempt. Status flow:
// PENDING → ENDED → RELISTED   (or FAILED / SKIPPED)
// A row left in ENDED means the item is offline and is retried automatically.
export const relistLog = pgTable(
  "relist_log",
  {
    id: id(),
    channelAccountId: text("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    oldItemId: text("old_item_id").notNull(),
    newItemId: text("new_item_id"),
    title: text("title"),
    sku: text("sku"),
    quantity: integer("quantity"),
    ageDays: integer("age_days"),
    status: text("status").notNull(), // PENDING / ENDED / RELISTED / FAILED / SKIPPED
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    trigger: text("trigger"), // CRON / MANUAL
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("relist_status").on(t.status), index("relist_created").on(t.createdAt)],
);

// Simple key/value settings editable from the dashboard (e.g. auto-relist on/off)
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: updatedAt(),
});

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    change: integer("change").notNull(), // +ve in, -ve out
    reason: stockReasonEnum("reason").notNull(),
    reference: text("reference"), // order ID, PO number
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("stock_product_time").on(t.productId, t.createdAt)],
);

// ---------- Orders ----------

export const orders = pgTable(
  "orders",
  {
    id: id(),
    channelAccountId: text("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    externalId: text("external_id").notNull(),
    orderNumber: text("order_number"),
    status: orderStatusEnum("status").notNull(),
    buyerName: text("buyer_name"),
    buyerUsername: text("buyer_username"),
    buyerEmail: text("buyer_email"),
    shipName: text("ship_name"),
    shipLine1: text("ship_line1"),
    shipLine2: text("ship_line2"),
    shipCity: text("ship_city"),
    shipPostcode: text("ship_postcode"),
    shipCountry: text("ship_country"),
    currency: text("currency").notNull().default("GBP"),
    subtotal: money("subtotal").notNull(),
    shippingCharged: money("shipping_charged").notNull().default("0"),
    tax: money("tax").notNull().default("0"),
    total: money("total").notNull(),
    dispatchBy: timestamp("dispatch_by", { withTimezone: true }),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    notes: text("notes"),
    tags: text("tags").array().notNull().default([]),
    raw: jsonb("raw"), // original payload, for debugging
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_account_ext").on(t.channelAccountId, t.externalId),
    index("orders_placed").on(t.placedAt),
    index("orders_status").on(t.status),
  ],
);

export const orderItems = pgTable("order_items", {
  id: id(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id").references(() => products.id),
  externalSku: text("external_sku"),
  externalLineId: text("external_line_id"),
  title: text("title").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
});

export const shipments = pgTable("shipments", {
  id: id(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  carrier: text("carrier").notNull(), // ROYAL_MAIL, DPD, EVRI...
  service: text("service"),
  trackingNumber: text("tracking_number"),
  labelUrl: text("label_url"),
  cost: money("cost"),
  weightGrams: integer("weight_grams"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  syncedToChannel: boolean("synced_to_channel").notNull().default(false),
});

export const fees = pgTable("fees", {
  id: id(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // FINAL_VALUE, PROMOTED, PAYMENT...
  amount: money("amount").notNull(),
});

export const returns = pgTable("returns", {
  id: id(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  status: returnStatusEnum("status").notNull().default("REQUESTED"),
  reason: text("reason"), // DOESNT_FIT, DAMAGED, NOT_AS_DESCRIBED, CHANGED_MIND
  refundAmount: money("refund_amount"),
  restocked: boolean("restocked").notNull().default(false),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const syncLogs = pgTable("sync_logs", {
  id: id(),
  channel: channelEnum("channel").notNull(),
  job: text("job").notNull(),
  ok: boolean("ok").notNull(),
  message: text("message"),
  count: integer("count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

// ---------- Relations ----------

export const productsRelations = relations(products, ({ many }) => ({
  fitments: many(fitments),
  listings: many(channelListings),
  orderItems: many(orderItems),
  stockMovements: many(stockMovements),
}));

export const fitmentsRelations = relations(fitments, ({ one }) => ({
  product: one(products, { fields: [fitments.productId], references: [products.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  account: one(channelAccounts, {
    fields: [orders.channelAccountId],
    references: [channelAccounts.id],
  }),
  items: many(orderItems),
  shipments: many(shipments),
  fees: many(fees),
  returns: many(returns),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order: one(orders, { fields: [shipments.orderId], references: [orders.id] }),
}));

export const feesRelations = relations(fees, ({ one }) => ({
  order: one(orders, { fields: [fees.orderId], references: [orders.id] }),
}));

export const returnsRelations = relations(returns, ({ one }) => ({
  order: one(orders, { fields: [returns.orderId], references: [orders.id] }),
}));
