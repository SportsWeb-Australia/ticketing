import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AdminShell, { RequireAdmin } from './AdminShell';
import { Bars } from './Charts';

const fmt = (c?: number) => `$${((c ?? 0) / 100).toFixed(2)}`;
const badge: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
};

interface Summary {
  events_total: number;
  events_published: number;
  events_upcoming: number;
  tickets_issued: number;
  tickets_in: number;
  gross_cents: number;
  collected_cents: number;
  collected_30d_cents: number;
  next_event: { id: string; name: string; starts_at: string | null } | null;
}
interface EvRow {
  id: string; name: string; starts_at: string | null; status: string;
  tickets_issued: number; tickets_in: number; collected_cents: number;
}

export default function ClubDashboard() {
  return <RequireAdmin render={(ctx) => (
    <AdminShell club={ctx.club} clubs={ctx.clubs} onClub={ctx.setClubId} role={ctx.role}>
      <Inner clubId={ctx.clubId!} clubName={ctx.club?.name ?? ''} />
    </AdminShell>
  )} />;
}

function Inner({ clubId, clubName }: { clubId: string; clubName: string }) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [events, setEvents] = useState<EvRow[]>([]);
  const [trend, setTrend] = useState<{ label: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: s }, { data: evs }, { data: orders }] = await Promise.all([
        supabase.rpc('tk_club_summary', { p_club_id: clubId }),
        supabase.rpc('tk_club_events', { p_club_id: clubId }),
        supabase.from('tk_orders').select('paid_at,total_cents,status').eq('club_id', clubId).eq('status', 'paid'),
      ]);
      setSum((s ?? null) as Summary | null);
      setEvents((evs ?? []) as EvRow[]);

      // collected revenue per day across the whole club
      const byDay = new Map<string, { label: string; value: number }>();
      for (const o of orders ?? []) {
        if (!o.paid_at) continue;
        const d = new Date(o.paid_at);
        const iso = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const cur = byDay.get(iso) ?? { label, value: 0 };
        cur.value += o.total_cents ?? 0;
        byDay.set(iso, cur);
      }
      setTrend([...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v));
      setLoading(false);
    })();
  }, [clubId]);

  const upcoming = events.filter(
    (e) => e.status === 'published' && (!e.starts_at || new Date(e.starts_at) >= new Date()),
  );

  if (loading) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{clubName || 'Club'} dashboard</h1>
          <p className="text-sm text-slate-400">Ticketing across all your events</p>
        </div>
        <button
          onClick={() => nav('/admin/new')}
          className="rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white"
        >
          + New event
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Upcoming events" value={sum?.events_upcoming ?? 0} />
        <Kpi label="Tickets sold" value={sum?.tickets_issued ?? 0} sub={`${sum?.tickets_in ?? 0} checked in`} />
        <Kpi label="Collected (all time)" value={fmt(sum?.collected_cents)} />
        <Kpi label="Collected (30 days)" value={fmt(sum?.collected_30d_cents)} />
      </div>

      {/* revenue trend */}
      {trend.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold text-slate-800">Revenue over time</h2>
          <Bars data={trend} valueFmt={(v) => fmt(v)} />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>{trend[0].label}</span>
            <span>{trend[trend.length - 1].label}</span>
          </div>
        </Card>
      )}

      {/* next up */}
      {sum?.next_event && (
        <Link
          to={`/admin/e/${sum.next_event.id}`}
          className="flex items-center justify-between rounded-xl border border-brand-orange/40 bg-brand-orange/5 px-4 py-4 hover:border-brand-orange"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-orange">Next up</p>
            <p className="truncate font-semibold text-slate-800">{sum.next_event.name}</p>
            <p className="text-xs text-slate-400">
              {sum.next_event.starts_at ? new Date(sum.next_event.starts_at).toLocaleString('en-AU') : 'No date set'}
            </p>
          </div>
          <span className="ml-4 shrink-0 text-brand-orange">Open →</span>
        </Link>
      )}

      {/* upcoming list */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Upcoming</h2>
          <Link to="/admin/events" className="text-sm text-slate-500 hover:text-brand-orange">
            Manage all events →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
            No upcoming events. <Link to="/admin/new" className="text-brand-orange underline">Create one</Link>.
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map((e) => (
              <Link
                key={e.id} to={`/admin/e/${e.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-4 hover:border-brand-orange"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-800">{e.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${badge[e.status] ?? 'bg-slate-100'}`}>{e.status}</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {e.starts_at ? new Date(e.starts_at).toLocaleString('en-AU') : 'No date set'}
                  </p>
                </div>
                <div className="ml-4 shrink-0 text-right text-sm text-slate-500">
                  <div>{e.tickets_in}/{e.tickets_issued} in</div>
                  <div className="text-slate-400">{fmt(e.collected_cents)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
function Card({ children }: { children: ReactNode }) {
  return <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">{children}</div>;
}
