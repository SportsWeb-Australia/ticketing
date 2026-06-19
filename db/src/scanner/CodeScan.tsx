import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from '../lib/supabase';
import { BRAND } from '../ticketing/brand';

// PIN / gate-code scanning — no account needed. A club admin mints an
// event-specific code; a volunteer types it once and scans QR codes for that
// event only. Every scan is re-checked server-side by tk_scan_with_code, so a
// disabled or expired code stops working immediately.

type Result =
  | 'admitted' | 'duplicate' | 'invalid' | 'invalid_sig' | 'wrong_event'
  | 'void' | 'refunded' | 'not_found' | 'unauthorised' | 'retry';

interface ScanOutcome {
  result: Result;
  ticket?: { serial_no: number; type: string; holder_name: string | null };
  message?: string;
}

const GOOD: Result[] = ['admitted'];
const DEVICE_ID = (() => {
  let d = localStorage.getItem('tk_device_id');
  if (!d) { d = crypto.randomUUID(); localStorage.setItem('tk_device_id', d); }
  return d;
})();

export default function CodeScan() {
  const [code, setCode] = useState('');
  const [active, setActive] = useState<{ code: string; eventName: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [entryErr, setEntryErr] = useState<string | null>(null);
  const [gate, setGate] = useState(localStorage.getItem('tk_gate') || '');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [admitted, setAdmitted] = useState(0);

  const onScanRef = useRef<(c: string) => void>(() => {});
  const lastCode = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setChecking(true); setEntryErr(null);
    const { data, error } = await supabase.rpc('tk_events_for_code', { p_code: c });
    setChecking(false);
    if (error) { setEntryErr(error.message); return; }
    const rows = (data ?? []) as { id: string; name: string }[];
    if (!rows.length) { setEntryErr("That code didn’t match a published event."); return; }
    setActive({ code: c, eventName: rows[0].name });
  };

  // camera — starts once a valid code is active
  useEffect(() => {
    if (!active) return;
    const el = document.getElementById('code-reader');
    if (!el) return;
    const h = new Html5Qrcode('code-reader');
    h.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (c) => onScanRef.current(c),
      undefined,
    ).catch((e) => setCamError(typeof e === 'string' ? e : 'Camera unavailable.'));
    return () => { h.stop().then(() => h.clear()).catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const flash = (o: ScanOutcome) => {
    setOutcome(o);
    if (navigator.vibrate) navigator.vibrate(GOOD.includes(o.result) ? 60 : [60, 50, 60]);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setOutcome(null), 2500);
  };

  const onScan = async (qr: string) => {
    if (!active) return;
    const now = Date.now();
    if (qr === lastCode.current.code && now - lastCode.current.at < 3000) return; // debounce
    lastCode.current = { code: qr, at: now };

    // No manifest for code scanners, so we can't admit offline safely.
    if (!navigator.onLine) { flash({ result: 'retry', message: 'Offline' }); return; }

    const { data, error } = await supabase.rpc('tk_scan_with_code', {
      p_code: active.code, p_qr: qr, p_gate: gate || null, p_device: DEVICE_ID,
    });
    if (error) { flash({ result: 'retry', message: error.message }); return; }
    const o = data as ScanOutcome;
    flash(o);
    if (o.result === 'admitted') setAdmitted((n) => n + 1);
    // code disabled/expired mid-shift -> kick back to the entry screen
    if (o.result === 'unauthorised') setTimeout(() => setActive(null), 1600);
  };
  useEffect(() => { onScanRef.current = onScan; });

  // ---------- code entry ----------
  if (!active) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand-graphite px-6">
        <img src={BRAND.logoStackedWhite} alt={BRAND.name} className="mb-8 h-20 w-auto object-contain" />
        <div className="w-full max-w-sm space-y-3">
          <h1 className="text-center text-lg font-semibold text-white">Enter your gate code</h1>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
            placeholder="e.g. 7F3A9C2B"
            autoCapitalize="characters" autoCorrect="off" autoComplete="off"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-3 text-center text-lg uppercase tracking-[0.3em] text-white placeholder-white/30 outline-none focus:border-brand-orange"
          />
          {entryErr && <p className="text-sm text-red-400">{entryErr}</p>}
          <button
            onClick={start} disabled={checking || !code.trim()}
            className="w-full rounded-lg bg-brand-orange py-3 font-semibold text-white disabled:opacity-40"
          >
            {checking ? 'Checking…' : 'Start scanning'}
          </button>
          <p className="pt-2 text-center text-xs text-white/40">
            Have an account? <Link to="/scan" className="text-white/60 underline">Sign in instead</Link>
          </p>
        </div>
      </div>
    );
  }

  // ---------- scanning ----------
  const bg =
    outcome == null ? '' :
    GOOD.includes(outcome.result) ? 'bg-emerald-500' :
    outcome.result === 'duplicate' ? 'bg-amber-500' :
    outcome.result === 'retry' ? 'bg-slate-600' : 'bg-red-600';

  return (
    <div className="min-h-screen bg-brand-graphite text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setActive(null)} className="text-sm text-white/50">‹ Exit</button>
        <span className="truncate px-2 font-medium">{active.eventName}</span>
        <span className="text-sm text-white/40">code</span>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pb-3">
        <div className="rounded-lg bg-white/5 px-3 py-2 text-sm">
          <span className="text-2xl font-bold tabular-nums">{admitted}</span>
          <span className="text-white/50"> admitted</span>
        </div>
        <input
          value={gate}
          onChange={(e) => { setGate(e.target.value); localStorage.setItem('tk_gate', e.target.value); }}
          placeholder="Gate (e.g. Main)"
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm placeholder-white/40 outline-none"
        />
      </div>

      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden bg-black">
        <div id="code-reader" className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
        {camError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/70">
            {camError}
          </div>
        )}
        {outcome && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center ${bg} text-center`}>
            <p className="text-3xl font-extrabold uppercase tracking-wide">
              {GOOD.includes(outcome.result) ? 'Admit' :
               outcome.result === 'duplicate' ? 'Already in' :
               outcome.result === 'retry' ? 'Try again' :
               outcome.result === 'void' ? 'Void' :
               outcome.result === 'refunded' ? 'Refunded' :
               outcome.result === 'unauthorised' ? 'Code ended' :
               outcome.result === 'not_found' ? 'Not found' : 'Invalid'}
            </p>
            {outcome.result === 'retry' && <p className="mt-1 text-sm">Couldn’t verify — scan again</p>}
            {outcome.result === 'unauthorised' && <p className="mt-1 text-sm">{outcome.message || 'Ask the organiser'}</p>}
            {outcome.ticket && (
              <p className="mt-2 text-lg">
                {outcome.ticket.type} · #{String(outcome.ticket.serial_no).padStart(4, '0')}
                {outcome.ticket.holder_name ? ` · ${outcome.ticket.holder_name}` : ''}
              </p>
            )}
          </div>
        )}
      </div>

      <p className="px-4 py-4 text-center text-xs text-white/40">
        Point the camera at the QR on each ticket. This device scans only for {active.eventName}.
      </p>
    </div>
  );
}
