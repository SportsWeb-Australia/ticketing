import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { BRAND } from '../ticketing/brand';
import { useSession } from '../scanner/useSession';
import Login from '../scanner/Login';
import { useMyClubs, type Club } from './useMyClubs';

export default function AdminShell({
  children, club, clubs, onClub, role,
}: {
  children: ReactNode;
  club: Club | null;
  clubs: Club[];
  onClub: (id: string) => void;
  role?: 'admin' | 'manager' | 'scanner' | null;
}) {
  return (
    <div className="min-h-screen bg-brand-mist">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="flex items-center gap-2">
            <img src={BRAND.logoHorizontal} alt={BRAND.name} className="h-6 w-auto object-contain" />
            <span className="text-sm font-medium text-slate-400">Admin</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/admin/events" className="text-sm text-slate-500 hover:text-brand-orange">Events</Link>
            {role === 'admin' && (
              <Link to="/admin/staff" className="text-sm text-slate-500 hover:text-brand-orange">Staff</Link>
            )}
            {clubs.length > 1 ? (
              <select
                value={club?.id ?? ''} onChange={(e) => onClub(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <span className="text-sm text-slate-600">{club?.name}</span>
            )}
            <button onClick={() => supabase.auth.signOut()} className="text-sm text-slate-400">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}

// Guard wrapper used by every admin route
export function RequireAdmin({ render }: { render: (ctx: ReturnType<typeof useMyClubs>) => ReactNode }) {
  const { session, loading } = useSession();
  const ctx = useMyClubs();
  if (loading) return <div className="min-h-screen bg-brand-mist" />;
  if (!session) return <Login />;
  if (ctx.loading) return <div className="min-h-screen bg-brand-mist" />;
  if (!ctx.clubs.length) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center text-slate-500">
        Your account isn’t linked to a club yet. Add a <code>club_users</code> row for this user.
      </div>
    );
  }
  return <>{render(ctx)}</>;
}
