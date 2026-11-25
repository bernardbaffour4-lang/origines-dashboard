CREATE TABLE IF NOT EXISTS "pricing_items" (
	"sku" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cost" numeric(10, 2),
	"postage" numeric(10, 2),
	"original_price" numeric(10, 2),
	"stocked_since" timestamp with time zone,
	"market_price" numeric(10, 2),
	"base_price" numeric(10, 2),
	"last_base_change_at" timestamp with time zone,
	"last_pushed_price" numeric(10, 2),
	"last_pushed_at" timestamp with time zone,
	"views_30d" integer,
	"views_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricing_log" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"item_id" text,
	"title" text,
	"kind" text NOT NULL,
	"old_price" numeric(10, 2),
	"new_price" numeric(10, 2),
	"note" text,
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricing_log_created" ON "pricing_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricing_log_sku" ON "pricing_log" USING btree ("sku");