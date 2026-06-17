import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { BRAND } from '../ticketing/brand';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-graphite px-6">
      <img src={BRAND.logoWhite} alt={BRAND.name} className="mb-8 h-10 w-auto object-contain" />
      <div className="w-full max-w-sm space-y-3">
        <input
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-3 text-white placeholder-white/40 outline-none focus:border-brand-orange"
          placeholder="Email" type="email" autoCapitalize="none"
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-3 text-white placeholder-white/40 outline-none focus:border-brand-orange"
          placeholder="Password" type="password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button
          onClick={submit} disabled={busy || !email || !password}
          className="w-full rounded-lg bg-brand-orange py-3 font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in to scan'}
        </button>
        <p className="pt-2 text-center text-xs text-white/40">Gate staff sign-in</p>
      </div>
    </div>
  );
}
