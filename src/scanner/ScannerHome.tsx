import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { BRAND } from '../ticketing/brand';
import { useSession } from './useSession';
import Login from './Login';

interface Ev { id: string; name: string; starts_at: string | null; status: string; }

export default function ScannerHome() {
  const { session, loading } = useSession();
  const [events, setEvents] = useState<Ev[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    if (!session) return;
    (async () => {
      // RLS scopes this to the signed-in user's clubs automatically
      const { data } = await supabase
        .from('tk_events')
        .select('id,name,starts_at,status')
        .in('status', ['published', 'completed'])
        .order('starts_at', { ascending: true });
      setEvents((data ?? []) as Ev[]);
      setLoadingEvents(false);
    })();
  }, [session]);

  if (loading) return <Screen><p className="text-white/60">Loading…</p></Screen>;
  if (!session) return <Login />;

  return (
    <Screen>
      <div className="flex w-full items-center justify-between">
        <img src={BRAND.logoWhite} alt={BRAND.name} className="h-7 w-auto object-contain" />
        <button onClick={() => supabase.auth.signOut()} className="text-sm text-white/50">
          Sign out
        </button>
      </div>
      <h1 className="mt-8 text-lg font-semibold text-white">Choose an event to scan</h1>
      <div className="mt-4 w-full space-y-2">
        {loadingEvents && <p className="text-white/50">Loading events…</p>}
        {!loadingEvents && events.length === 0 && (
          <p className="text-white/50">No events found for your club.</p>
        )}
        {events.map((e) => (
          <Link
            key={e.id} to={`/scan/${e.id}`}
            className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-4 text-white ring-1 ring-white/10 active:bg-white/10"
          >
            <span className="font-medium">{e.name}</span>
            <span className="text-brand-orange">Scan →</span>
          </Link>
        ))}
      </div>
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-brand-graphite px-5 py-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
