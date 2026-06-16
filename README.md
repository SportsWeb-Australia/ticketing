# SportsWeb One — Ticketing (standalone module)

A self-contained app for the **Ticketing** module, built the same way as the
Volunteer Manager: its own code and tables, **connected into SportsWeb One**
through the shared `sportsweb-one` Supabase project (clubs, club_users, the
`modules` entitlement table, and the `tk_` tables). Multi-tenant — the club is
resolved from the URL, nothing is hardcoded to any one club.

## Two faces, one database
- **Public** sales page (this scaffold): anonymous fans buy tickets.
- **Club admin** (next phases): create/manage events, door sales, scanning,
  reporting — gated by `tk_module_enabled()` / `tk_feature()`, exactly like the
  `vm_` helpers gate Volunteer Manager.

## Get it running
1. `npm install`
2. Copy `.env.example` → `.env` and set `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY` to the **same sportsweb-one project** as the rest of
   SportsWeb One. (Do not create a new Supabase project.)
3. Apply the database migrations on that project, in order:
   `sportsweb_ticketing.sql` (schema) then `db/tk_quote_order.sql` (pricing RPC).
4. `npm run dev` → open the test event link.

## Deploy (Vercel)
- New Vercel project from this repo. Framework preset: **Vite**.
- Add the two env vars (same sportsweb-one project).
- `vercel.json` already rewrites all paths to `index.html` so deep links work.

## Routes
- `/e/:eventId` — sales page by event id (no assumptions about `clubs`).
- `/:clubSlug/e/:eventSlug` — pretty URLs (needs `clubs.slug` readable by anon).
- `/tickets/confirm` — post-purchase confirmation (stub until checkout lands).

## Connecting it into a club site (e.g. Dookie)
Either is fine and neither puts ticketing code in the club's repo:
- **Link out:** a "Buy tickets" button → `https://<this-app>/e/<eventId>`.
- **Embed:** an iframe to `…/e/<eventId>?embed=1`. The page posts its height:
  ```js
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'sportsweb-ticketing-height')
      iframe.style.height = e.data.height + 'px';
  });
  ```
  (Same auto-height pattern as the AFL line-up widget.)

## Status
- Public sales page: **done** (face-value pricing via `tk_quote_order`).
- `tk-checkout` (Stripe Connect direct charge + signed-ticket issuance): **next**.
- Club admin, scanner PWA, reporting: after checkout.
