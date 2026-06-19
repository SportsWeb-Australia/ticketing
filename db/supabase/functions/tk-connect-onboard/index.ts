// SportsWeb One — Ticketing — tk-connect-onboard
// Creates (or reuses) a Stripe Connect STANDARD account for a club and returns
// a Stripe-hosted onboarding link. Called from the club admin side (later) and
// usable now to connect a club so paid checkout can be tested end to end.
//
// Body: { club_id, return_url, refresh_url }
// Returns: { url }  -> redirect the club admin there to finish onboarding.
//
// Standard accounts mean the club fully owns its Stripe account and Stripe
// handles all onboarding/compliance; with direct charges the club is merchant
// of record and bears Stripe fees, which is exactly the no-surcharge model.

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { club_id, return_url, refresh_url } = await req.json();
    if (!club_id || !return_url || !refresh_url)
      return json({ error: 'club_id, return_url and refresh_url are required.' }, 400);

    // club details to prefill onboarding
    const { data: club } = await supabase
      .from('clubs')
      .select('id, name, contact_email')
      .eq('id', club_id)
      .maybeSingle();
    if (!club) return json({ error: 'Club not found.' }, 404);

    // reuse an existing connected account if we already made one
    const { data: existing } = await supabase
      .from('tk_club_stripe')
      .select('stripe_account_id')
      .eq('club_id', club_id)
      .maybeSingle();

    let accountId = existing?.stripe_account_id as string | undefined;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        country: 'AU',
        email: club.contact_email ?? undefined,
        business_type: 'non_profit',
        metadata: { club_id },
      });
      accountId = account.id;
      await supabase.from('tk_club_stripe').upsert({
        club_id,
        stripe_account_id: accountId,
        updated_at: new Date().toISOString(),
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      return_url,
      refresh_url,
      type: 'account_onboarding',
    });

    return json({ url: link.url });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Onboarding failed.' }, 500);
  }
});
