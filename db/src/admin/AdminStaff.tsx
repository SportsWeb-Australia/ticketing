import { useEffect, useState } from 'react';
import AdminShell, { RequireAdmin } from './AdminShell';
import { supabase } from '../lib/supabase';

interface StaffRow { id: string; email: string | null; role: string; status: string; created_at: string; }

export default function AdminStaff() {
  return <RequireAdmin render={(ctx) => (
    <AdminShell club={ctx.club} clubs={ctx.clubs} onClub={ctx.setClubId} role={ctx.role}>
      {ctx.role === 'admin'
        ? <Inner clubId={ctx.clubId!} />
        : <p className="text-slate-500">Only club admins can manage staff.</p>}
    </AdminShell>
  )} />;
}

function Inner({ clubId }: { clubId: string }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('scanner');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.rpc('tk_list_staff', { p_club_id: clubId });
    setRows((data ?? []) as StaffRow[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clubId]);

  const add = async () => {
    setBusy(true); setErr(null); setMsg(null);
    const { data, error } = await supabase.rpc('tk_add_staff', { p_club_id: clubId, p_email: email, p_role: role });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const out = data as { status: string; email: string };
    setMsg(out.status === 'pending'
      ? `Invite saved — ${out.email} gets access automatically when they sign up.`
      : `${out.email} added.`);
    setEmail('');
    load();
  };

  const remove = async (id: string) => {
    await supabase.rpc('tk_remove_staff', { p_staff_id: id });
    load();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">Staff</h1>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">Add a person</h2>
        <p className="mt-1 text-sm text-slate-500">
          <strong>Managers</strong> create &amp; run events and see reports. <strong>Scanners</strong> check people in at the gate.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@club.com" type="email"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-orange"
          />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="manager">Manager</option>
            <option value="scanner">Scanner</option>
          </select>
          <button onClick={add} disabled={busy || !email.trim()}
            className="shrink-0 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-emerald-600">{msg}</p>}
        {err && <p className="mt-2 text-sm text-red-500">{err}</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        {rows.length === 0 && <p className="p-5 text-sm text-slate-400">No staff yet.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between border-b border-slate-100 px-5 py-3 last:border-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{r.email ?? '—'}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                <span className="capitalize">{r.role}</span>
                {r.status === 'pending' && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">pending sign-up</span>
                )}
              </p>
            </div>
            <button onClick={() => remove(r.id)} className="text-sm text-red-500 hover:underline">Remove</button>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400">
        Gate PIN codes (for scanners who don’t have an account) are created per event — that screen is coming next.
      </p>
    </div>
  );
}
