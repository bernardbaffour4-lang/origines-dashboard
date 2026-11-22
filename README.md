# Origines Parts — Multi-channel Dashboard

One place for eBay and website (Wix) orders, stock and performance.

**Rule of the architecture:** channels are synced *into your own Postgres database*,
and the dashboard only ever reads from that database. That keeps it fast, lets you
combine channels, and keeps history beyond what each API returns.

```
eBay APIs ─┐
Wix APIs  ─┼─► /api/sync (cron, every 15 min) ─► Postgres ─► Dashboard pages
           │                                       │
           └──────── (next: push stock + tracking back to channels)
```

## What's in this first version

| Area | Status |
|---|---|
| Database schema: products, fitment, listings, stock movements, orders, items, shipments, fees, returns, sync log | ✅ |
| eBay OAuth (connect, callback, auto token refresh) | ✅ |
| eBay order sync (Sell Fulfillment API, incremental, incl. marketplace fees) | ✅ |
| Wix order sync (eCommerce Search Orders) | ✅ |
| Matching order lines to your products by SKU; stock is taken off once per new order and logged | ✅ |
| Overview: revenue, orders, AOV, revenue after fees (vs previous period), daily revenue by channel, channel split, alerts, latest orders | ✅ |
| Orders: unified list, search (order no., buyer, postcode, SKU, item title), filter by channel/status, late-dispatch highlight | ✅ |
| Connections: connect eBay, sync log | ✅ |
| Password protection for the whole dashboard | ✅ |
| Inventory, listings, shipping labels, returns, messages, reports | Next |

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Drizzle ORM · Postgres · Recharts

## 1. Run it locally

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL and DASHBOARD_PASSWORD at least
npm run db:migrate                # creates the tables
npm run db:seed                   # optional: demo products + 60 days of fake orders
npm run dev                       # http://localhost:3000  (login: DASHBOARD_USER / DASHBOARD_PASSWORD)
```

Remove the demo data any time with `npm run db:seed -- --clear`.

**Database:** create a free Postgres on [Supabase](https://supabase.com) or [Neon](https://neon.tech)
and paste its connection string into `DATABASE_URL`. (Use the *pooled* connection string on Vercel.)

## 2. Connect eBay

1. developer.ebay.com → **Application Keys** → Production keyset: copy **App ID** → `EBAY_CLIENT_ID`
   and **Cert ID** → `EBAY_CLIENT_SECRET`.
2. **User Tokens** → *Get a Token from eBay via Your Application* → add / edit your **RuName**:
   - **Your auth accepted URL:** `https://YOUR-DOMAIN/api/ebay/callback`
   - Production only accepts **HTTPS** URLs, so localhost won't work. Either deploy first (step 4)
     or run `ngrok http 3000` and use the `https://….ngrok-free.app/api/ebay/callback` address.
   - Put the **RuName string** (looks like `Your_Name-YourApp-PRD-abc123-xyz`) in `EBAY_RUNAME`.
3. Open the dashboard → **Connections** → **Connect eBay** → sign in and agree.
4. Press **Sync now**. The first run pulls the last 90 days.

The refresh token lasts about 18 months; the Connections page shows when you'll need to reconnect.

> Item SKUs: stock matching works by SKU. Make sure your eBay listings (Custom label / SKU)
> and Wix products use the same SKU as the `products` table.

## 3. Connect Wix

1. Wix → **Account settings → API Keys** → generate a key with permission to read
   eCommerce / Stores orders → `WIX_API_KEY`.
2. Your site ID is the GUID in your Wix dashboard URL (`/dashboard/<site-id>/…`) → `WIX_SITE_ID`.
3. Press **Sync now**.

Wix's search can't filter by "last updated", so each sync re-reads the last 30 days of
orders to catch status changes (paid → shipped → refunded).

## 4. Deploy (Vercel)

1. Push this folder to a GitHub repo and import it in Vercel.
2. Add every variable from `.env.example` in Vercel → Settings → Environment Variables.
3. Run migrations against the production database once: `DATABASE_URL=... npm run db:migrate`.
4. **Scheduled sync:** `vercel.json` asks Vercel Cron to call `/api/sync` every 15 minutes and Vercel
   sends your `CRON_SECRET` automatically. Vercel's free Hobby plan only allows **daily** cron jobs;
   on Hobby, use [cron-job.org](https://cron-job.org) (free) to call
   `https://YOUR-DOMAIN/api/sync` every 15 min with header `Authorization: Bearer <CRON_SECRET>`.

## Project map

```
src/
  db/schema.ts               ← all tables (edit here, then npm run db:generate && npm run db:migrate)
  db/index.ts                ← database connection
  lib/ebay/config.ts         ← env + scopes
  lib/ebay/auth.ts           ← consent URL, code exchange, token refresh, ebayFetch()
  lib/ebay/orders.ts         ← eBay → unified order mapping + sync
  lib/wix/orders.ts          ← Wix → unified order mapping + sync
  lib/sync/upsert-order.ts   ← shared upsert, SKU matching, stock movements
  lib/queries.ts             ← all dashboard read queries (KPIs, charts, alerts, order list)
  app/page.tsx               ← Overview
  app/orders/page.tsx        ← Orders
  app/settings/page.tsx      ← Connections + sync log
  app/api/ebay/connect       ← starts eBay OAuth
  app/api/ebay/callback      ← eBay redirects here
  app/api/sync               ← runs all syncs (cron + "Sync now")
  middleware.ts              ← dashboard password + cron secret
scripts/seed.ts              ← demo data
drizzle/                     ← SQL migrations
```

## Suggested next steps

1. **Inventory page** – products table with OEM numbers, fitment, bin location, stock edits (writes `stock_movements`).
2. **Push stock to channels** – after each sale, update quantity on the *other* channel
   (eBay Inventory API `bulkUpdatePriceQuantity`, Wix Inventory API). Check first whether your eBay
   listings were made in Seller Hub: those must be migrated (`bulkMigrateListing`) before the
   Inventory API can manage them.
3. **Shipping** – Royal Mail Click & Drop API for labels, then send tracking back to eBay
   (Fulfillment API `createShippingFulfillment`) and Wix (Order Fulfillments API).
4. **Real profit** – add cost price + postage + eBay Finances API transactions for exact fees.
5. **Webhooks** – eBay Notification API and Wix webhooks for near-instant new orders.
6. Replace the Basic-auth login with proper user accounts (Auth.js or Clerk) when staff need access.

## Notes

- The original API payload of every order is kept in `orders.raw`, so if a field isn't mapped
  the way you want, check the real payload there and adjust the `normalise…Order` function.
- Never commit `.env.local` — it holds your eBay and Wix secrets.
