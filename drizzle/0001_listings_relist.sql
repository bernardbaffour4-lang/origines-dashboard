CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relist_log" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_account_id" text NOT NULL REFERENCES "public"."channel_accounts"("id") ON DELETE cascade,
	"old_item_id" text NOT NULL,
	"new_item_id" text,
	"title" text,
	"sku" text,
	"quantity" integer,
	"age_days" integer,
	"status" text NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"trigger" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN IF NOT EXISTS "listing_type" text;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN IF NOT EXISTS "has_variations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN IF NOT EXISTS "start_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN IF NOT EXISTS "quantity_sold" integer;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN IF NOT EXISTS "watch_count" integer;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN IF NOT EXISTS "view_url" text;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN IF NOT EXISTS "image_url" text;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relist_status" ON "relist_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relist_created" ON "relist_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_start" ON "channel_listings" USING btree ("start_time");
