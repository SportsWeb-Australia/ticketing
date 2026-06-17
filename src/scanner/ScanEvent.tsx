import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from '../lib/supabase';
import { BRAND } from '../ticketing/brand';
import { useSession } from './useSession';
import Login from './Login';
import { enqueue, loadQueue, saveQueue } from './scanQueue';

type Result = 'admitted' | 'duplicate' | 'invalid' | 'invalid_sig' | 'wrong_event' | 'void' | 'refunded' | 'not_found' | 'queued';

interface ScanOutcome {
  result: Result;
  ticket?: { serial_no: number; type: string; holder_name: string | null };
  message?: string;
}
interface ManifestRow {
  id: string; serial_no: number; status: string; holder_name: string | null; type: string;
}

const GOOD: Result[] = ['admitted', 'queued'];
const DEVICE_ID = (() => {
  let d = localStorage.getItem('tk_device_id');
  if (!d) { d = crypto.randomUUID(); localStorage.setItem('tk_device_id', d); }
  return d;
})();

export default function ScanEvent() {
  const { eventId } = useParams();
  const { session, loading } = useSession();

  const [gate, setGate] = useState(localStorage.getItem('tk_gate') || '');
  const [eventName, setEventName] = useState('');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [manifest, setManifest] = useState<ManifestRow[]>([]);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef<(code: string) => void>(() => {});
  const lastCode = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const counts = {
    issued: manifest.length,
    redeemed: manifest.filter((m) => m.status === 'redeemed').length,
  };

  // ---- load manifest (RLS-scoped to club staff) + event name ----
  const loadManifest = useCallback(async () => {
    if (!eventId) return;
    const [{ data: ev }, { data: tickets }, { data: types }] = await Promise.all([
      supabase.from('tk_events').select('name').eq('id', eventId).maybeSingle(),
      supabase.from('tk_tickets').select('id,serial_no,status,holder_name,ticket_type_id').eq('event_id', eventId),
      supabase.from('tk_ticket_types').select('id,name').eq('event_id', eventId),
    ]);
    if (ev) setEventName(ev.name);
    const typeMap = new Map((types ?? []).map((t: any) => [t.id, t.name]));
    setManifest(
      (tickets ?? []).map((t: any) => ({
        id: t.id, serial_no: t.serial_no, status: t.status,
        holder_name: t.holder_name, type: typeMap.get(t.ticket_type_id) ?? 'Ticket',
      })),
    );
  }, [eventId]);

  useEffect(() => { if (session) loadManifest(); }, [session, loadManifest]);

  // ---- online/offline + queue flush ----
  useEffect(() => {
    const flush = async () => {
      const q = loadQueue();
      if (!q.length || !navigator.onLine) return;
      const remaining = [];
      for (const item of q) {
        const { error } = await supabase.rpc('tk_scan_ticket', {
          p_qr: item.qr, p_gate: item.gate, p_device: DEVICE_ID,
        });
        if (error) remaining.push(item);
      }
      saveQueue(remaining);
      loadManifest();
    };
    const on = () => { setOnline(true); flush(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    flush();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [loadManifest]);

  // ---- camera ----
  useEffect(() => {
    if (!session) return;
    const el = document.getElementById('reader');
    if (!el) return;
    const h = new Html5Qrcode('reader');
    scannerRef.current = h;
    h.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (code) => onScanRef.current(code), undefined)
      .catch((e) => setCamError(typeof e === 'string' ? e : 'Camera unavailable — use manual search.'));
    return () => { h.stop().then(() => h.clear()).catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const flash = (o: ScanOutcome) => {
    setOutcome(o);
    if (navigator.vibrate) navigator.vibrate(GOOD.includes(o.result) ? 60 : [60, 50, 60]);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setOutcome(null), 2500);
  };

  const onScan = async (code: string) => {
    const now = Date.now();
    if (code === lastCode.current.code && now - lastCode.current.at < 3000) return; // debounce
    lastCode.current = { code, at: now };
    if (!navigator.onLine) {
      // optimistic offline admit against the manifest
      const tid = code.split('.')[0];
      const row = manifest.find((m) => m.id === tid);
      enqueue({ qr: code, gate: gate || null, ts: now });
      if (!row) flash({ result: 'not_found' });
      else if (row.status === 'redeemed') flash({ result: 'duplicate', ticket: row });
      else {
        setManifest((m) => m.map((x) => (x.id === tid ? { ...x, status: 'redeemed' } : x)));
        flash({ result: 'queued', ticket: row });
      }
      return;
    }

    const { data, error } = await supabase.rpc('tk_scan_ticket', {
      p_qr: code, p_gate: gate || null, p_device: DEVICE_ID,
    });
    if (error) { enqueue({ qr: code, gate: gate || null, ts: now }); flash({ result: 'queued' }); return; }
    flash(data as ScanOutcome);
    if ((data as ScanOutcome).result === 'admitted') loadManifest();
  };

  // keep the camera callback pointed at the freshest closure (manifest/gate/online)
  useEffect(() => { onScanRef.current = onScan; });

  const manualAdmit = async (row: ManifestRow) => {
    const { data, error } = await supabase.rpc('tk_admit_ticket', {
      p_ticket_id: row.id, p_gate: gate || null, p_device: DEVICE_ID,
    });
    if (error) { flash({ result: 'invalid', message: error.message }); return; }
    flash(data as ScanOutcome);
    loadManifest();
  };

  if (loading) return <div className="min-h-screen bg-brand-graphite" />;
  if (!session) return <Login />;

  const filtered = search.trim()
    ? manifest.filter((m) =>
        (m.holder_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        String(m.serial_no).includes(search.trim()))
      .slice(0, 30)
    : [];

  const bg =
    outcome == null ? '' :
    GOOD.includes(outcome.result) ? 'bg-emerald-500' :
    outcome.result === 'duplicate' ? 'bg-amber-500' : 'bg-red-600';

  return (
    <div className="min-h-screen bg-brand-graphite text-white">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3">
        <Link to="/scan" className="text-sm text-white/50">‹ Events</Link>
        <span className="truncate px-2 font-medium">{eventName}</span>
        <button onClick={() => supabase.auth.signOut()} className="text-sm text-white/50">Sign out</button>
      </div>

      {/* count + gate */}
      <div className="flex items-center justify-between gap-3 px-4 pb-3">
        <div className="rounded-lg bg-white/5 px-3 py-2 text-sm">
          <span className="text-2xl font-bold tabular-nums">{counts.redeemed}</span>
          <span className="text-white/50"> / {counts.issued} in</span>
        </div>
        <input
          value={gate}
          onChange={(e) => { setGate(e.target.value); localStorage.setItem('tk_gate', e.target.value); }}
          placeholder="Gate (e.g. Main)"
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm placeholder-white/40 outline-none"
        />
        {!online && <span className="rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">Offline</span>}
      </div>

      {/* camera */}
      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden bg-black">
        <div id="reader" className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
        {camError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/70">
            {camError}
          </div>
        )}
        {/* result overlay */}
        {outcome && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center ${bg} text-center`}>
            <p className="text-3xl font-extrabold uppercase tracking-wide">
              {GOOD.includes(outcome.result) ? 'Admit' :
               outcome.result === 'duplicate' ? 'Already in' :
               outcome.result === 'void' ? 'Void' :
               outcome.result === 'refunded' ? 'Refunded' :
               outcome.result === 'not_found' ? 'Not found' : 'Invalid'}
            </p>
            {outcome.result === 'queued' && <p className="mt-1 text-sm">Saved — will sync</p>}
            {outcome.ticket && (
              <p className="mt-2 text-lg">
                {outcome.ticket.type} · #{String(outcome.ticket.serial_no).padStart(4, '0')}
                {outcome.ticket.holder_name ? ` · ${outcome.ticket.holder_name}` : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {/* manual search / supervisor */}
      <div className="px-4 py-4">
        <button
          onClick={() => setShowSearch((s) => !s)}
          className="w-full rounded-lg bg-white/5 py-3 text-sm font-medium ring-1 ring-white/10"
        >
          {showSearch ? 'Hide manual search' : 'Search & admit manually'}
        </button>
        {showSearch && (
          <div className="mt-3">
            <input
              autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or ticket number"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-3 placeholder-white/40 outline-none"
            />
            <div className="mt-2 space-y-2">
              {filtered.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate">{m.holder_name || m.type}</p>
                    <p className="text-xs text-white/50">
                      {m.type} · #{String(m.serial_no).padStart(4, '0')}
                      {m.status === 'redeemed' ? ' · already in' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => manualAdmit(m)}
                    disabled={m.status !== 'valid'}
                    className="rounded-md bg-brand-orange px-3 py-1.5 text-sm font-semibold disabled:opacity-30"
                  >
                    Admit
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
