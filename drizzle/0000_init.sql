CREATE TYPE "public"."channel" AS ENUM('EBAY', 'WIX', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."condition" AS ENUM('NEW', 'USED_A', 'USED_B', 'USED_C', 'REFURBISHED', 'FOR_PARTS');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('AWAITING_PAYMENT', 'PAID', 'PICKED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTED', 'REFUNDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."stock_reason" AS ENUM('SALE', 'RETURN_RESTOCK', 'MANUAL_ADJUST', 'PURCHASE', 'DAMAGED', 'CANCELLATION');--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" "channel" NOT NULL,
	"label" text NOT NULL,
	"external_account_id" text,
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp with time zone,
	"last_order_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_account_id" text NOT NULL,
	"product_id" text,
	"external_id" text NOT NULL,
	"external_sku" text,
	"title" text,
	"price" numeric(10, 2),
	"currency" text DEFAULT 'GBP' NOT NULL,
	"quantity" integer,
	"status" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fees" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitments" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"chassis_code" text,
	"year_from" integer,
	"year_to" integer,
	"engine" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text,
	"external_sku" text,
	"external_line_id" text,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_account_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"external_id" text NOT NULL,
	"order_number" text,
	"status" "order_status" NOT NULL,
	"buyer_name" text,
	"buyer_username" text,
	"buyer_email" text,
	"ship_name" text,
	"ship_line1" text,
	"ship_line2" text,
	"ship_city" text,
	"ship_postcode" text,
	"ship_country" text,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"shipping_charged" numeric(10, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"dispatch_by" timestamp with time zone,
	"placed_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"notes" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"brand" text,
	"category" text,
	"oem_part_number" text,
	"alt_part_numbers" text[] DEFAULT '{}' NOT NULL,
	"side" text,
	"drive" text,
	"lighting_type" text,
	"facelift" text,
	"condition" "condition" DEFAULT 'USED_A' NOT NULL,
	"condition_notes" text,
	"cost_price" numeric(10, 2),
	"quantity" integer DEFAULT 0 NOT NULL,
	"low_stock_at" integer DEFAULT 1 NOT NULL,
	"bin_location" text,
	"source_note" text,
	"image_urls" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"status" "return_status" DEFAULT 'REQUESTED' NOT NULL,
	"reason" text,
	"refund_amount" numeric(10, 2),
	"restocked" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"carrier" text NOT NULL,
	"service" text,
	"tracking_number" text,
	"label_url" text,
	"cost" numeric(10, 2),
	"weight_grams" integer,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"synced_to_channel" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"change" integer NOT NULL,
	"reason" "stock_reason" NOT NULL,
	"reference" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" "channel" NOT NULL,
	"job" text NOT NULL,
	"ok" boolean NOT NULL,
	"message" text,
	"count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitments" ADD CONSTRAINT "fitments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_accounts_channel_label" ON "channel_accounts" USING btree ("channel","label");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_account_ext" ON "channel_listings" USING btree ("channel_account_id","external_id");--> statement-breakpoint
CREATE INDEX "fitments_lookup" ON "fitments" USING btree ("make","model","chassis_code");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_account_ext" ON "orders" USING btree ("channel_account_id","external_id");--> statement-breakpoint
CREATE INDEX "orders_placed" ON "orders" USING btree ("placed_at");--> statement-breakpoint
CREATE INDEX "orders_status" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_oem" ON "products" USING btree ("oem_part_number");--> statement-breakpoint
CREATE INDEX "products_brand_cat" ON "products" USING btree ("brand","category");--> statement-breakpoint
CREATE INDEX "stock_product_time" ON "stock_movements" USING btree ("product_id","created_at");