# Scanner + Admin — deploy & use

Both ship inside the same app/repo and deploy with your normal zip → GitHub → Vercel flow.
Vercel runs `npm install` on build, so the two new packages (`html5-qrcode`,
`vite-plugin-pwa`) install automatically — nothing to install locally.

## 1. Run the new SQL (Supabase → SQL editor), after the earlier ticketing migrations
Order doesn't matter between these two, but run both:

1. `db/tk_scanner.sql` — `tk_scan_ticket()` (validate QR + admit, atomic) and
   `tk_admit_ticket()` (manual admit by ticket).
2. `db/tk_admin.sql` — `tk_my_clubs()` and `tk_fee_for_club()` (admin helpers).

(`db/tk_checkout.sql` and `db/tk_get_order_tickets.sql` are still for the Stripe
milestone — not needed for scanning or for building events.)

## 2. Who can sign in
Both the scanner and admin use Supabase Auth (email + password) and are scoped by
`club_users`. The signed-in user needs a `club_users` row for the club.

- **Admin** — any `club_users` member of the club can create/edit events.
- **Scanning** — the role must be one of `admin / supervisor / gate / scanner`.
  `gate`/`scanner` may not exist in your role enum yet; `admin` always works.

To make yourself an admin of a club for testing (run once, with real ids):
```sql
insert into club_users (club_id, user_id, role)
values ('<CLUB_ID>', '<YOUR_AUTH_USER_ID>', 'admin')
on conflict do nothing;
```
Your auth user id is in Supabase → Authentication → Users.

## 3. Admin — `/admin`
- `/admin` lists events (with live in/issued counts + collected $).
- **+ New event** → details, ticket types, and ticket look (brand colour + logo).
  Publishing flips status to **published** so the public `/e/<id>` page goes live.
- **Report** tab (saved events): sales numbers, the platform fee being deducted,
  and copy-paste **public link** + **embed iframe**.
- **Payments** tab: "Set up payouts" calls the `tk-connect-onboard` function
  (Stripe milestone). Until `db/tk_checkout.sql` is applied + that function is
  deployed, it shows a friendly "run the migration / deploy the function" note.
  Free events never need this.

No SQL needed to create events any more — this replaces the seed inserts.

## 4. Scanner PWA — `/scan`
- Sign in → pick the event → camera opens.
- Green **ADMIT** / amber **ALREADY IN** / red **INVALID/VOID** with a vibrate buzz.
  The signing secret never touches the device — the server verifies the HMAC and
  flips valid→redeemed in one atomic step, so the same ticket can't enter twice
  even across two phones.
- A **Gate** label (e.g. "Main", "Members") tags each scan for the report.
- **Search & admit manually** — find by name or ticket number and tap Admit
  (for damaged/again-no-phone cases).
- **Offline:** if signal drops, scans validate against the pre-loaded ticket list
  and queue locally ("Saved — will sync"), flushing automatically when back online.
  Online is still recommended at the gate; offline is best-effort.

**Install to a phone:** open `…vercel.app/scan` → browser menu → **Add to Home Screen**.
It then launches full-screen straight into the scanner. (Camera needs HTTPS — Vercel
serves HTTPS, so it just works once deployed.)
