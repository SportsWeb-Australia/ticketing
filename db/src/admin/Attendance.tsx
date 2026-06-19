import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { Bars, Donut } from './Charts';

interface Row {
  id: string;
  serial_no: number;
  status: string;
  holder_name: string | null;
  type: string;
  redeemed_at: string | null;
}

// Door view: who's in, who's still to arrive, and check-ins over the night.
// Polls lightly so the count stays live during an event without a refresh.
export default function Attendance({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [q, setQ] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: tickets }, { data: types }] = await Promise.all([
      supabase.from('tk_events').select('capacity').eq('id', eventId).maybeSingle(),
      supabase
        .from('tk_tickets')
        .select('id,serial_no,status,holder_name,ticket_type_id,redeemed_at')
        .eq('event_id', eventId)
        .order('serial_no'),
      supabase.from('tk_ticket_types').select('id,name').eq('event_id', eventId),
    ]);
    setCapacity(ev?.capacity ?? null);
    const tmap = new Map((types ?? []).map((t: any) => [t.id, t.name]));
    setRows(
      (tickets ?? []).map((t: any) => ({
        id: t.id,
        serial_no: t.serial_no,
        status: t.status,
        holder_name: t.holder_name,
        redeemed_at: t.redeemed_at,
        type: tmap.get(t.ticket_type_id) ?? 'Ticket',
      })),
    );
    setLoading(false);
    setUpdatedAt(new Date());
  }, [eventId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 25000); // light live refresh
    return () => clearInterval(id);
  }, [load]);

  const issued = rows.length;
  const inCount = rows.filter((r) => r.status === 'redeemed').length;

  // check-ins grouped by clock hour
  const buckets = useMemo(() => {
    const times = rows.filter((r) => r.redeemed_at).map((r) => new Date(r.redeemed_at!));
    if (!times.length) return [] as { label: string; value: number }[];
    const byHour = new Map<number, number>();
    for (const d of times) {
      const k = d.getHours();
      byHour.set(k, (byHour.get(k) ?? 0) + 1);
    }
    return [...byHour.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([h, value]) => ({ label: `${h.toString().padStart(2, '0')}:00`, value }));
  }, [rows]);

  const fmtTime = (s: string | null) =>
    s ? new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const list = useMemo(() => {
    let r = rows;
    if (filter === 'in') r = r.filter((x) => x.status === 'redeemed');
    if (filter === 'out') r = r.filter((x) => x.status !== 'redeemed');
    const s = q.trim().toLowerCase();
    if (s) {
      r = r.filter(
        (x) => (x.holder_name ?? '').toLowerCase().includes(s) || String(x.serial_no).includes(s),
      );
    }
    return r.slice(0, 500);
  }, [rows, filter, q]);

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-5">
          <Donut
            value={inCount}
            total={issued}
            color="#10B981"
            center={
              <>
                <div className="text-2xl font-bold text-slate-800">{inCount}</div>
                <div className="text-xs text-slate-400">in</div>
              </>
            }
          />
          <div className="space-y-1">
            <p className="text-sm text-slate-500">
              <span className="font-semibold text-slate-800">{inCount}</span> of {issued} checked in
            </p>
            <p className="text-sm text-slate-500">{Math.max(0, issued - inCount)} still to arrive</p>
            {capacity ? <p className="text-xs text-slate-400">Capacity {capacity}</p> : null}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={load} className="text-sm font-medium text-brand-orange">Refresh</button>
              {updatedAt && (
                <span className="text-xs text-slate-300">
                  {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-slate-800">Check-ins by hour</h2>
        {buckets.length ? (
          <>
            <Bars data={buckets} color="#10B981" />
            <div className="mt-1 flex justify-between text-xs text-slate-400">
              <span>{buckets[0].label}</span>
              <span>{buckets[buckets.length - 1].label}</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">No check-ins yet.</p>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Attendees</h2>
          <div className="flex gap-1 text-sm">
            {(['all', 'in', 'out'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 ${filter === f ? 'bg-brand-orange text-white' : 'text-slate-500'}`}
              >
                {f === 'all' ? `All ${issued}` : f === 'in' ? `In ${inCount}` : `Not yet ${Math.max(0, issued - inCount)}`}
              </button>
            ))}
          </div>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or ticket #"
          className={inp}
        />
        <div className="mt-2 divide-y divide-slate-100">
          {list.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <p className="truncate text-slate-800">{r.holder_name || r.type}</p>
                <p className="text-xs text-slate-400">
                  {r.type} · #{String(r.serial_no).padStart(4, '0')}
                </p>
              </div>
              {r.status === 'redeemed' ? (
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-600">
                  In {fmtTime(r.redeemed_at)}
                </span>
              ) : r.status === 'valid' ? (
                <span className="shrink-0 text-xs text-slate-400">Not in</span>
              ) : (
                <span className="shrink-0 text-xs text-red-400">{r.status}</span>
              )}
            </div>
          ))}
          {!list.length && <p className="py-3 text-sm text-slate-400">No matches.</p>}
        </div>
      </Card>
    </div>
  );
}

const inp =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-orange';
function Card({ children }: { children: ReactNode }) {
  return <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">{children}</div>;
}
