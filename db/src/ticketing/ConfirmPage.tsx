// SportsWeb One — Ticketing — ConfirmPage
// Post-purchase screen. Loads the order's issued tickets via the
// tk_get_order_tickets RPC (anon-safe, keyed by the order UUID) and renders a
// signed QR per ticket. Free orders have tickets immediately; paid orders are
// issued by the webhook a moment after redirect, so we poll briefly.

import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { supabase } from '../lib/supabase';
import { BRAND } from './brand';
import BrandHeader from './BrandHeader';
import BrandFooter from './BrandFooter';

interface Ticket {
  id: string;
  serial_no: number;
  type: string;
  holder_name: string | null;
  status: string;
  qr: string;
}
interface OrderData {
  found: boolean;
  order_id?: string;
  buyer_name?: string | null;
  event?: {
    name: string;
    venue_name: string | null;
    venue_address: string | null;
    starts_at: string | null;
    timezone: string;
    brand_color: string | null;
  };
  tickets?: Ticket[];
}

const MAX_TRIES = 6;

export default function ConfirmPage() {
  const orderId = new URLSearchParams(window.location.search).get('order');
  const [data, setData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: res } = await supabase.rpc('tk_get_order_tickets', {
        p_order_id: orderId,
      });
      if (cancelled) return;
      const ok = res?.found && (res.tickets?.length ?? 0) > 0;
      if (ok) {
        setData(res);
        setLoading(false);
      } else if (tries < MAX_TRIES) {
        setTimeout(() => setTries((t) => t + 1), 1500); // wait for the webhook
      } else {
        setData(res ?? { found: false });
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, tries]);

  const accent = data?.event?.brand_color || BRAND.colors.orange;

  const dateLabel = data?.event?.starts_at
    ? new Intl.DateTimeFormat('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: data.event.timezone,
      }).format(new Date(data.event.starts_at))
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-brand-mist">
      <BrandHeader />

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        {loading ? (
          <p className="py-16 text-center text-slate-500">Finalising your tickets…</p>
        ) : !orderId || !data?.found || !(data.tickets && data.tickets.length) ? (
          <div className="py-16 text-center">
            <h1 className="text-xl font-semibold text-brand-graphite">
              We couldn&rsquo;t find those tickets
            </h1>
            <p className="mt-2 text-slate-500">
              If you&rsquo;ve just paid, give it a few seconds and refresh &mdash;
              your tickets are being issued.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
                &#10003;
              </div>
              <h1 className="text-2xl font-bold text-brand-graphite">You&rsquo;re in</h1>
              <p className="mt-1 text-slate-600">
                {data.event?.name}
                {dateLabel ? ` \u00b7 ${dateLabel}` : ''}
              </p>
              {data.event?.venue_name && (
                <p className="text-sm text-slate-500">{data.event.venue_name}</p>
              )}
            </div>

            <p className="mt-5 rounded-lg bg-white px-4 py-3 text-center text-sm text-slate-600 shadow-sm">
              Save or screenshot this screen and show the QR at the gate.
            </p>

            <div className="mt-5 space-y-5">
              {data.tickets.map((t) => (
                <div key={t.id} className="relative overflow-hidden rounded-2xl bg-white shadow-md">
                  {/* brand band */}
                  <div className="px-5 py-4 text-white" style={{ backgroundColor: accent }}>
                    <p className="text-[11px] font-medium uppercase tracking-wide opacity-80">
                      {data.event?.name}
                    </p>
                    <p className="mt-0.5 text-lg font-bold leading-tight">{t.type}</p>
                    {(dateLabel || data.event?.venue_name) && (
                      <p className="mt-0.5 text-xs opacity-90">
                        {dateLabel}
                        {dateLabel && data.event?.venue_name ? ' · ' : ''}
                        {data.event?.venue_name}
                      </p>
                    )}
                  </div>

                  {/* perforation */}
                  <div className="relative">
                    <div className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-brand-mist" />
                    <div className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-brand-mist" />
                    <div className="mx-5 border-t-2 border-dashed border-slate-200" />
                  </div>

                  {/* body */}
                  <div className="flex items-center gap-4 p-5">
                    <div className="shrink-0 rounded-lg border border-slate-100 bg-white p-2">
                      <QRCode value={t.qr} size={118} />
                    </div>
                    <div className="min-w-0">
                      {t.holder_name && (
                        <p className="truncate font-semibold text-brand-graphite">{t.holder_name}</p>
                      )}
                      <p className="text-sm text-slate-500">{t.type}</p>
                      <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-slate-400">
                        Ticket #{String(t.serial_no).padStart(4, '0')}
                      </p>
                      {t.status !== 'valid' && (
                        <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                          {t.status}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      <BrandFooter />
    </div>
  );
}
