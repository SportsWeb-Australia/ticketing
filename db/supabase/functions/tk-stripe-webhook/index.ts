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

// Buyer ticket-link email via the shared SportsWeb One notify endpoint.
async function sendTicketEmail(opts: {
  clubId: string; to: string; eventName: string; clubName: string; confirmUrl: string;
}) {
  const secret = Deno.env.get('VM_WEBHOOK_SECRET');
  if (!secret || !opts.to) return;
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
      body: JSON.stringify({
        club_id: opts.clubId,
        channel: 'email',
        to: opts.to,
        subject: `Your tickets — ${opts.eventName}`,
        body:
          `Thanks for your order with ${opts.clubName}.\n\n` +
          `Your tickets for ${opts.eventName} are ready. Open this link on your phone ` +
          `and show the QR code at the gate:\n\n${opts.confirmUrl}\n\nSee you there!`,
        category: 'ticket_confirmation',
      }),
    });
  } catch (_e) {
    // best-effort
  }
}

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
          // transition only from pending -> paid (idempotent on replays).
          // The returned rows tell us if THIS call did the transition, so we
          // email exactly once even when Stripe retries the webhook.
          const { data: transitioned } = await supabase
            .from('tk_orders')
            .update({
              status: 'paid',
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id:
                typeof session.payment_intent === 'string' ? session.payment_intent : null,
              stripe_checkout_session_id: session.id,
            })
            .eq('id', orderId)
            .eq('status', 'pending')
            .select('club_id, event_id, buyer_email');

          // issuance is itself idempotent (guards on existing tickets)
          await supabase.rpc('tk_issue_tickets', { p_order_id: orderId });

          if (transitioned && transitioned.length) {
            const ord = transitioned[0] as { club_id: string; event_id: string; buyer_email: string | null };
            const { data: ev } = await supabase.from('tk_events').select('name').eq('id', ord.event_id).single();
            const { data: cl } = await supabase.from('clubs').select('name').eq('id', ord.club_id).single();
            await sendTicketEmail({
              clubId: ord.club_id,
              to: session.customer_email ?? session.customer_details?.email ?? ord.buyer_email ?? '',
              eventName: ev?.name ?? 'your event',
              clubName: cl?.name ?? 'your club',
              confirmUrl: session.success_url ?? '',
            });
          }
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
