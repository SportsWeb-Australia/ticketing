// SportsWeb One — Ticketing Module
// EventSalesPage.tsx — public, brandable, phone-first ticket sales page.
//
// White-label by design: a quiet chassis that takes on each club's identity
// via the event's brand colour, logo and cover image. Multi-tenant — nothing
// here is specific to any one club.
//
// No-surcharge model: the buyer pays FACE VALUE only. The platform cut + the
// Stripe cost come out of the club's proceeds at checkout (Connect direct
// charge), never added to the buyer.
//
// embed=true renders inside an iframe on a club site: the summary flows inline
// and the page posts its height to the parent for auto-resize.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { renderMarkdown } from '../lib/markdown';
import { BRAND } from './brand';
import type { TkEvent, TkTicketType, TkQuote, CartItem, BuyerDetails } from './types';

interface Props {
  eventId?: string;
  slug?: string;
  clubId?: string;
  /** true when rendered inside an iframe embed on a club website */
  embed?: boolean;
}

const money = (cents: number, currency = 'aud') =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default function EventSalesPage({ eventId, slug, clubId, embed = false }: Props) {
  const [event, setEvent] = useState<TkEvent | null>(null);
  const [types, setTypes] = useState<TkTicketType[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [buyer, setBuyer] = useState<BuyerDetails>({ name: '', email: '', phone: '' });
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [quote, setQuote] = useState<TkQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ----- iframe auto-height -------------------------------------------
  useEffect(() => {
    if (!embed) return;
    const send = () =>
      window.parent?.postMessage(
        { type: 'sportsweb-ticketing-height', height: document.documentElement.scrollHeight },
        '*',
      );
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    return () => ro.disconnect();
  }, [embed]);

  // ----- load event + ticket types ------------------------------------
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        let q = supabase.from('tk_events').select('*').eq('status', 'published');
        if (eventId) q = q.eq('id', eventId);
        else if (slug) {
          q = q.eq('slug', slug);
          if (clubId) q = q.eq('club_id', clubId);
        }
        const { data: ev, error: evErr } = await q.limit(1).maybeSingle();
        if (evErr) throw evErr;
        if (!ev) {
          if (active) setLoadError('This event is not available right now.');
          return;
        }
        const { data: tt, error: ttErr } = await supabase
          .from('tk_ticket_types')
          .select('*')
          .eq('event_id', ev.id)
          .eq('is_active', true)
          .order('sort_order', { ascending: true });
        if (ttErr) throw ttErr;
        if (!active) return;
        setEvent(ev as TkEvent);
        setTypes((tt ?? []) as TkTicketType[]);
      } catch {
        if (active) setLoadError('Something went wrong loading this event.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [eventId, slug, clubId]);

  const brand = event?.ticket_template?.brandColor || '#1f6feb';
  const logo = event?.ticket_template?.logoUrl;

  const statusOf = useCallback((t: TkTicketType) => {
    const now = Date.now();
    if (t.sales_start_at && now < Date.parse(t.sales_start_at)) return 'soon';
    if (t.sales_end_at && now > Date.parse(t.sales_end_at)) return 'closed';
    if (t.quantity_total != null && t.quantity_sold >= t.quantity_total) return 'soldout';
    return 'open';
  }, []);

  const setQty = (t: TkTicketType, qty: number) => {
    const max =
      t.quantity_total != null
        ? Math.min(t.max_per_order, t.quantity_total - t.quantity_sold)
        : t.max_per_order;
    const clamped = Math.max(0, Math.min(qty, max));
    setCart((c) => {
      const next = { ...c };
      if (clamped === 0) delete next[t.id];
      else next[t.id] = clamped;
      return next;
    });
  };

  const cartItems: CartItem[] = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, q]) => q > 0)
        .map(([ticket_type_id, quantity]) => ({ ticket_type_id, quantity })),
    [cart],
  );
  const hasSelection = cartItems.length > 0;

  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!event || !hasSelection) {
      setQuote(null);
      return;
    }
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(async () => {
      setQuoting(true);
      const { data, error } = await supabase.rpc('tk_quote_order', {
        p_event_id: event.id,
        p_items: cartItems,
      });
      setQuoting(false);
      if (error) {
        setFormError(error.message);
        setQuote(null);
      } else {
        setFormError(null);
        setQuote(data as TkQuote);
      }
    }, 250);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    };
  }, [event, cartItems, hasSelection]);

  const isFree = !!quote && quote.total_cents === 0;
  const canSubmit =
    hasSelection &&
    !!quote &&
    first.trim().length > 0 &&
    last.trim().length > 0 &&
    emailOk(buyer.email) &&
    !submitting &&
    !quoting;

  const startCheckout = async () => {
    if (!event || !canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tk-checkout`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          event_id: event.id,
          items: cartItems,
          buyer,
          success_url: `${window.location.origin}/tickets/confirm`,
          cancel_url: window.location.href,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Checkout is not available right now.');
      if (out.checkout_url) window.location.href = out.checkout_url;
      else if (out.order_id) window.location.href = `/tickets/confirm?order=${out.order_id}`;
      else throw new Error('Unexpected checkout response.');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not start checkout.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="mx-auto max-w-2xl p-6 text-slate-500">Loading…</div>;

  if (loadError || !event)
    return (
      <div className="mx-auto max-w-2xl p-10 text-center">
        <p className="text-lg font-medium text-slate-700">{loadError}</p>
      </div>
    );

  // Past events auto-close: a direct link to a finished event shows a clean
  // "ended" state rather than a buyable cart. (Listings/embeds drop them entirely.)
  const ended = event.ends_at ? Date.now() > Date.parse(event.ends_at) : false;
  if (ended)
    return (
      <div className={`${embed ? '' : 'min-h-screen'} flex items-center justify-center bg-slate-50 p-10 text-center`}>
        <div>
          {logo && <img src={logo} alt="" className="mx-auto mb-4 h-14 w-14 rounded-lg bg-white object-contain p-1 shadow" />}
          <h1 className="text-xl font-semibold text-slate-800">{event.name}</h1>
          <p className="mt-2 text-slate-500">This event has ended — tickets are no longer on sale.</p>
        </div>
      </div>
    );

  const dateLabel = event.starts_at
    ? new Intl.DateTimeFormat('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: event.timezone,
      }).format(new Date(event.starts_at))
    : null;

  const Summary = quote ? (
    <>
      <div className="mb-2 flex items-center justify-between text-base font-semibold">
        <span>
          Total
          <span className="ml-2 text-sm font-normal text-slate-500">
            {quote.ticket_count} {quote.ticket_count === 1 ? 'ticket' : 'tickets'}
          </span>
        </span>
        <span>{money(quote.total_cents, quote.currency)}</span>
      </div>
      <button
        type="button"
        onClick={startCheckout}
        disabled={!canSubmit}
        className="w-full rounded-xl py-3.5 text-center text-base font-semibold text-white transition disabled:opacity-40"
        style={{ backgroundColor: brand }}
      >
        {submitting
          ? 'Working…'
          : isFree
            ? 'Get tickets'
            : `Pay ${money(quote.total_cents, quote.currency)}`}
      </button>
    </>
  ) : null;

  return (
    <div
      className={`${embed ? '' : 'min-h-screen'} bg-slate-50 pb-8 text-slate-900`}
      style={{ ['--brand' as string]: brand }}
    >
      {!embed && (
        <header className="relative">
          {event.cover_image_url ? (
            <div className="h-52 w-full overflow-hidden sm:h-64">
              <img src={event.cover_image_url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
            </div>
          ) : (
            <div className="h-28 w-full" style={{ backgroundColor: brand }} />
          )}
          {logo && (
            <img
              src={logo}
              alt=""
              className="absolute left-5 top-4 h-12 w-12 rounded-lg bg-white object-contain p-1 shadow"
            />
          )}
        </header>
      )}

      <main className={`relative z-10 mx-auto max-w-2xl px-4 ${embed ? 'pt-4' : '-mt-10'}`}>
        <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
          <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{event.name}</h1>
          <div className="mt-2 space-y-1 text-sm text-slate-600">
            {dateLabel && <p>{dateLabel}</p>}
            {event.venue_name && (
              <p>
                {event.venue_name}
                {event.venue_address ? ` · ${event.venue_address}` : ''}
              </p>
            )}
          </div>
          {(event.venue_address || event.venue_name) && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
              <iframe
                title="Venue map"
                src={`https://www.google.com/maps?q=${encodeURIComponent(
                  (event.venue_address || event.venue_name) as string,
                )}&output=embed`}
                className="h-44 w-full"
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          )}
          {event.description && (
            <div
              className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(event.description) }}
            />
          )}
        </div>

        <section className="mt-5 space-y-3">
          <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Tickets
          </h2>
          {types.length === 0 && (
            <div className="rounded-xl bg-white p-5 text-sm text-slate-500 shadow-sm">
              No tickets are on sale yet.
            </div>
          )}
          {types.map((t) => {
            const st = statusOf(t);
            const qty = cart[t.id] ?? 0;
            const left = t.quantity_total != null ? t.quantity_total - t.quantity_sold : null;
            return (
              <div
                key={t.id}
                className="flex items-center justify-between gap-4 rounded-xl bg-white p-4 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{t.name}</p>
                  {t.description && <p className="mt-0.5 text-sm text-slate-500">{t.description}</p>}
                  <p className="mt-1 text-sm font-semibold">
                    {t.price_cents === 0 ? 'Free' : money(t.price_cents, event.currency)}
                  </p>
                  {left != null && left <= 10 && st === 'open' && (
                    <p className="mt-0.5 text-xs text-amber-600">{left} left</p>
                  )}
                </div>
                {st === 'open' ? (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      aria-label={`Remove one ${t.name}`}
                      onClick={() => setQty(t, qty - 1)}
                      disabled={qty === 0}
                      className="h-9 w-9 rounded-full border border-slate-300 text-lg leading-none text-slate-700 transition disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="w-5 text-center tabular-nums">{qty}</span>
                    <button
                      type="button"
                      aria-label={`Add one ${t.name}`}
                      onClick={() => setQty(t, qty + 1)}
                      className="h-9 w-9 rounded-full text-lg leading-none text-white transition"
                      style={{ backgroundColor: brand }}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <span className="shrink-0 text-sm font-medium text-slate-400">
                    {st === 'soldout' ? 'Sold out' : st === 'soon' ? 'Not yet on sale' : 'Closed'}
                  </span>
                )}
              </div>
            );
          })}
        </section>

        {hasSelection && (
          <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Your details
            </h2>
            <div className="mt-3 grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
                placeholder="First name"
                autoComplete="given-name"
                value={first}
                onChange={(e) => {
                  const v = e.target.value;
                  setFirst(v);
                  setBuyer((b) => ({ ...b, name: `${v} ${last}`.trim() }));
                }}
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
                placeholder="Last name"
                autoComplete="family-name"
                value={last}
                onChange={(e) => {
                  const v = e.target.value;
                  setLast(v);
                  setBuyer((b) => ({ ...b, name: `${first} ${v}`.trim() }));
                }}
              />
            </div>
              <input
                className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
                placeholder="Email (your tickets are sent here)"
                type="email"
                value={buyer.email}
                onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
                placeholder="Mobile (optional)"
                type="tel"
                value={buyer.phone}
                onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })}
              />
            </div>
          </section>
        )}

        {formError && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>
        )}

        {/* Order summary: in-flow + sticky. Sits under the form on desktop
            (short content), sticks to the bottom while scrolling on mobile.
            Full-bleed bar on phones, rounded card on larger screens. */}
        {hasSelection && (
          <div className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-5 sm:shadow-lg">
            {Summary}
          </div>
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <img src={BRAND.icon} alt="" className="h-3.5 w-3.5 object-contain" />
          Powered by {BRAND.name}
        </p>
      </main>
    </div>
  );
}
