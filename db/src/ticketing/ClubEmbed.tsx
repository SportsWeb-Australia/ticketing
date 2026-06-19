import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { BRAND } from './brand';

// Club-level events widget. Designed to be iframed into a club website or
// the SportsWeb One platform. Lists only PUBLISHED, not-yet-ended events and
// re-queries live on every load, so past events drop off on their own.

interface Ev {
  id: string;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  venue_name: string | null;
  ticket_template: { brandColor?: string } | null;
}

export default function ClubEmbed() {
  const { clubId } = useParams();
  const [sp] = useSearchParams();
  const embed = sp.get('embed') === '1';
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const nowIso = new Date().toISOString();
      let q = supabase
        .from('tk_events')
        .select('id,name,starts_at,ends_at,venue_name,ticket_template')
        .eq('status', 'published')
        .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
        .order('starts_at', { ascending: true, nullsFirst: false });
      if (clubId) q = q.eq('club_id', clubId);
      const { data } = await q;
      if (active) {
        setEvents((data ?? []) as Ev[]);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [clubId]);

  // Tell the parent page our height so the iframe can auto-resize.
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
  }, [embed, events, loading]);

  const fmtDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('en-AU', {
          weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
        }).format(new Date(iso))
      : null;

  return (
    <div className={`${embed ? '' : 'min-h-screen'} bg-slate-50 p-4`}>
      <div className="mx-auto max-w-2xl space-y-3">
        {loading && <p className="text-sm text-slate-400">Loading events…</p>}
        {!loading && events.length === 0 && (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
            No upcoming events right now.
          </p>
        )}
        {events.map((e) => {
          const accent = e.ticket_template?.brandColor || '#1f6feb';
          return (
            <a
              key={e.id}
              href={`/e/${e.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-4 rounded-xl bg-white p-4 shadow-sm transition hover:shadow"
              style={{ borderLeft: `4px solid ${accent}` }}
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800">{e.name}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {fmtDate(e.starts_at) ?? 'Date TBC'}
                  {e.venue_name ? ` · ${e.venue_name}` : ''}
                </p>
              </div>
              <span
                className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: accent }}
              >
                Get tickets
              </span>
            </a>
          );
        })}
        {!embed && (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <img src={BRAND.icon} alt="" className="h-3.5 w-3.5 object-contain" /> Powered by {BRAND.name}
          </p>
        )}
      </div>
    </div>
  );
}
