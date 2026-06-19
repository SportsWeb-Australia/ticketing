// SportsWeb One — Ticketing — tk-checkout
// Called by the sales page "Pay" button.
//
// Flow:
//   1. Re-price the cart server-side (tk_checkout_pricing) — never trust the
//      browser for amounts.
//   2. Create a pending order + order items.
//   3. FREE order (total 0)  -> issue tickets immediately, return { order_id }.
//   4. PAID order            -> needs a charges-enabled club Connect account;
//      create a Stripe Checkout session as a DIRECT charge on that account
//      with our cut as application_fee_amount; return { checkout_url }.
//
// The buyer always pays face value. The club bears Stripe's fee (direct
// charge) and our application fee. Tickets for paid orders are issued by the
// webhook on checkout.session.completed, not here.

import Stripe from 'npm:stripe@16';
import { createClient } from 'npm:@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Send the buyer their ticket link via the shared SportsWeb One notify
// endpoint (ZeptoMail under the hood). Best-effort — never blocks issuing.
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
    // swallow — email is best-effort
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { event_id, items, buyer, success_url, cancel_url } = await req.json();

    if (!event_id || !Array.isArray(items) || items.length === 0)
      return json({ error: 'Missing event or tickets.' }, 400);
    if (!buyer?.email)
      return json({ error: 'An email address is required.' }, 400);

    // 1. server-authoritative pricing + the club's Connect status
    const { data: pricing, error: pErr } = await supabase.rpc('tk_checkout_pricing', {
      p_event_id: event_id,
      p_items: items,
    });
    if (pErr) return json({ error: pErr.message }, 400);

    const {
      club_id,
      currency,
      total_cents,
      application_fee_cents,
      lines,
      stripe_account_id,
      charges_enabled,
    } = pricing as {
      club_id: string;
      currency: string;
      total_cents: number;
      application_fee_cents: number;
      lines: Array<{ ticket_type_id: string; name: string; quantity: number; unit_price_cents: number }>;
      stripe_account_id: string | null;
      charges_enabled: boolean;
    };

    // 2. create the pending order
    const { data: order, error: oErr } = await supabase
      .from('tk_orders')
      .insert({
        club_id,
        event_id,
        buyer_name: buyer.name ?? null,
        buyer_email: buyer.email,
        buyer_phone: buyer.phone ?? null,
        channel: 'online',
        status: 'pending',
        subtotal_cents: total_cents,
        fee_cents: application_fee_cents,
        total_cents,
        fee_absorbed_by: 'club',
      })
      .select('id')
      .single();
    if (oErr) return json({ error: oErr.message }, 400);

    const { error: iErr } = await supabase.from('tk_order_items').insert(
      lines.map((l) => ({
        order_id: order.id,
        ticket_type_id: l.ticket_type_id,
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
      })),
    );
    if (iErr) return json({ error: iErr.message }, 400);

    // 3. FREE order -> issue now, skip Stripe entirely
    if (total_cents === 0) {
      await supabase
        .from('tk_orders')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', order.id);
      const { error: issErr } = await supabase.rpc('tk_issue_tickets', {
        p_order_id: order.id,
      });
      if (issErr) return json({ error: issErr.message }, 400);

      // confirmation email (best-effort)
      const { data: ev } = await supabase.from('tk_events').select('name').eq('id', event_id).single();
      const { data: cl } = await supabase.from('clubs').select('name').eq('id', club_id).single();
      await sendTicketEmail({
        clubId: club_id, to: buyer.email,
        eventName: ev?.name ?? 'your event', clubName: cl?.name ?? 'your club',
        confirmUrl: success_url ? `${success_url}?order=${order.id}` : '',
      });

      return json({ order_id: order.id });
    }

    // 4. PAID order -> requires a charges-enabled club Connect account
    if (!stripe_account_id || !charges_enabled) {
      await supabase.from('tk_orders').update({ status: 'cancelled' }).eq('id', order.id);
      return json({ error: 'Online payments are not set up for this club yet.' }, 400);
    }

    const paidLines = lines.filter((l) => l.unit_price_cents > 0);
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: buyer.email,
        line_items: paidLines.map((l) => ({
          quantity: l.quantity,
          price_data: {
            currency,
            unit_amount: l.unit_price_cents,
            product_data: { name: l.name },
          },
        })),
        payment_intent_data: {
          // our cut; clamp below the charge so the club can always cover Stripe
          application_fee_amount: Math.max(
            0,
            Math.min(application_fee_cents, total_cents - 1),
          ),
          metadata: { order_id: order.id },
        },
        metadata: { order_id: order.id },
        success_url: `${success_url}?order=${order.id}`,
        cancel_url,
      },
      { stripeAccount: stripe_account_id }, // DIRECT charge on the club's account
    );

    await supabase
      .from('tk_orders')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', order.id);

    return json({ checkout_url: session.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Checkout failed.' }, 500);
  }
});
