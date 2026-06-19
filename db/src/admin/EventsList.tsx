import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AdminShell, { RequireAdmin } from './AdminShell';

interface Row {
  id: string; name: string; status: string; starts_at: string | null;
  tickets_issued?: number; tickets_redeemed?: number; collected_cents?: number;
}
const fmt = (c?: number) => `$${((c ?? 0) / 100).toFixed(2)}`;
const badge: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function EventsList() {
  return <RequireAdmin render={(ctx) => (
    <AdminShell club={ctx.club} clubs={ctx.clubs} onClub={ctx.setClubId} role={ctx.role}>
      <Inner clubId={ctx.clubId!} />
    </AdminShell>
  )} />;
}

function Inner({ clubId }: { clubId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: events } = await supabase
        .from('tk_events')
        .select('id,name,status,starts_at')
        .eq('club_id', clubId)
        .order('starts_at', { ascending: false, nullsFirst: false });
      const { data: summary } = await supabase
        .from('tk_event_sales_summary')
        .select('event_id,tickets_issued,tickets_redeemed,collected_cents')
        .eq('club_id', clubId);
      const map = new Map((summary ?? []).map((s: any) => [s.event_id, s]));
      setRows((events ?? []).map((e: any) => ({ ...e, ...(map.get(e.id) ?? {}) })));
      setLoading(false);
    })();
  }, [clubId]);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Events</h1>
        <button
          onClick={() => nav('/admin/new')}
          className="rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white"
        >
          + New event
        </button>
      </div>

      {loading && <p className="text-slate-500">Loading…</p>}
      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No events yet. Create your first one.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <Link
            key={r.id} to={`/admin/e/${r.id}`}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-4 hover:border-brand-orange"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-slate-800">{r.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${badge[r.status] ?? 'bg-slate-100'}`}>
                  {r.status}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {r.starts_at ? new Date(r.starts_at).toLocaleString('en-AU') : 'No date set'}
              </p>
            </div>
            <div className="ml-4 shrink-0 text-right text-sm text-slate-500">
              <div>{r.tickets_redeemed ?? 0}/{r.tickets_issued ?? 0} in</div>
              <div className="text-slate-400">{fmt(r.collected_cents)}</div>
            </div>
          </Link>
        ))}
      </div>

      {!loading && <EmbedCard clubId={clubId} />}
    </div>
  );
}

/* Embed-all-events snippet — drop this on the club website / SportsWeb One.
   Auto-updates: past events fall off, new published events appear, no edits. */
function EmbedCard({ clubId }: { clubId: string }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const snippet = `<iframe src="${origin}/embed/${clubId}?embed=1" style="width:100%;border:0;min-height:240px" title="Upcoming events"></iframe>`;
  const copy = () => navigator.clipboard?.writeText(snippet);
  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-800">Embed all events on your website</h2>
      <p className="mt-1 text-sm text-slate-500">
        One code for your club. It lists every published event and updates itself —
        finished events drop off automatically. Open it standalone:{' '}
        <a href={`/embed/${clubId}`} target="_blank" rel="noreferrer" className="text-brand-orange underline">preview</a>.
      </p>
      <div className="mt-3 flex gap-2">
        <input readOnly value={snippet} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-500 outline-none" />
        <button onClick={copy} className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm">Copy</button>
      </div>
    </div>
  );
}
