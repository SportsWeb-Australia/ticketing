// SportsWeb One — Ticketing — tk-stripe-webhook
// Receives Stripe CONNECT webhook events (events from connected accounts).
// Deploy with JWT verification OFF (Stripe doesn't send a Supabase JWT):
//   supabase functions deploy tk-stripe-webhook --no-verify-jwt
//
// Handles:
//   • checkout.session.completed -> mark order paid + issue signed tickets
//   • account.updated            -> keep tk_club_stripe charges/payouts in sync
//
// Register the endpoint in Stripe with "Listen to events on Connected
// accounts" enabled, and copy its signing secret into STRIPE_WEBHOOK_SECRET.

import Stripe from 'npm:stripe@16';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const cryptoProvider = Stripe.createSubtleCryptoProvider();
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig!,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (e) {
    return new Response(
      `Webhook signature verification failed: ${e instanceof Error ? e.message : ''}`,
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;
        if (orderId) {
          // transition only from pending -> paid (idempotent on replays)
          await supabase
            .from('tk_orders')
            .update({
              status: 'paid',
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id:
                typeof session.payment_intent === 'string' ? session.payment_intent : null,
              stripe_checkout_session_id: session.id,
            })
            .eq('id', orderId)
            .eq('status', 'pending');

          // issuance is itself idempotent (guards on existing tickets)
          await supabase.rpc('tk_issue_tickets', { p_order_id: orderId });
        }
        break;
      }

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await supabase
          .from('tk_club_stripe')
          .update({
            charges_enabled: account.charges_enabled ?? false,
            details_submitted: account.details_submitted ?? false,
            payouts_enabled: account.payouts_enabled ?? false,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_account_id', account.id);
        break;
      }

      default:
        // ignore other event types
        break;
    }
  } catch (e) {
    // Log and still 200 where safe; for processing errors, 500 so Stripe retries.
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'handler error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
