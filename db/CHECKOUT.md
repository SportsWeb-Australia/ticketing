# Ticket One — Checkout deploy guide

The checkout layer is three Supabase Edge Functions + one SQL file. Nothing
here goes to Vercel — the functions live in Supabase, the SQL runs on
sportsweb-one. Do these in order.

## 0. Prerequisites
- `sportsweb_ticketing.sql` and `tk_quote_order.sql` already applied.
- Supabase CLI installed and logged in: `supabase login`, then link the repo:
  `supabase link --project-ref uzibfawcwoapfbigpzum`
- Stripe **Connect** enabled (test mode).

## 1. Apply the checkout SQL
Run `db/tk_checkout.sql` in the Supabase SQL editor (adds `tk_club_stripe`,
`tk_checkout_pricing`, `tk_issue_tickets`, and the service_role grants).

## 2. Set the function secrets
These are Edge Function secrets — NOT Vercel env vars. The Stripe secret key
must never go in the frontend bundle.
```
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
# STRIPE_WEBHOOK_SECRET is set in step 4, after the endpoint exists
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

## 3. Deploy the functions
```
supabase functions deploy tk-checkout
supabase functions deploy tk-connect-onboard
supabase functions deploy tk-stripe-webhook --no-verify-jwt
```
The webhook MUST be `--no-verify-jwt` (Stripe can't send a Supabase JWT).
`tk-checkout` keeps JWT on — the sales page sends the anon key as Bearer.

## 4. Register the Stripe webhook (Connect)
Stripe Dashboard → Developers → Webhooks → Add endpoint:
- URL: `https://uzibfawcwoapfbigpzum.functions.supabase.co/tk-stripe-webhook`
- Events: `checkout.session.completed`, `account.updated`
- **Enable "Listen to events on Connected accounts"** (these are direct
  charges on the club's account, so the events come via Connect).
Copy the endpoint's **Signing secret** (`whsec_...`) and set it:
```
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
supabase functions deploy tk-stripe-webhook --no-verify-jwt   # re-deploy to pick it up
```

## 5. Connect a club (so paid checkout can be tested)
Call the onboarding function for your test club, then open the returned URL and
complete Stripe's test onboarding:
```
curl -X POST https://uzibfawcwoapfbigpzum.functions.supabase.co/tk-connect-onboard \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"club_id":"7a841f7f-c6ac-4181-aec2-e91c53103512",
       "return_url":"https://ticketing-lime.vercel.app/connect/done",
       "refresh_url":"https://ticketing-lime.vercel.app/connect/retry"}'
```
Finish onboarding in the browser. The `account.updated` webhook then flips
`charges_enabled` in `tk_club_stripe`, and paid checkout goes live for that club.

## How the money flows (no-surcharge model)
- Buyer pays **face value** at Stripe-hosted Checkout.
- Charge is a **direct charge on the club's connected account** → the club is
  merchant of record and bears Stripe's processing fee automatically.
- Our cut rides as `application_fee_amount` → routes to the platform account.
- Net to club = face − Stripe fee − our cut. Buyer pays nothing extra.

## What happens on success
- Free order: tickets issued immediately by `tk-checkout`.
- Paid order: `checkout.session.completed` → webhook marks the order paid and
  calls `tk_issue_tickets`, which HMAC-signs each ticket and decrements stock.
- Buyer is redirected to `/tickets/confirm?order=<id>` (the confirm page renders
  the tickets/QRs in the next build).

## Known v1 limitations (to revisit)
- **No inventory hold** during the Stripe redirect window — two simultaneous
  buyers could oversell the last few tickets. Fine for community events; a
  reservation/hold is a later enhancement.
- Refund/void handling and the QR rendering on the confirm page are the next
  pieces after this is verified.
