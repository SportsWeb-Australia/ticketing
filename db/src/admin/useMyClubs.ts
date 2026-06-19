import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Club {
  id: string; name: string; slug: string | null;
  primary_colour: string | null; logo_url: string | null;
}
export type ClubRole = 'admin' | 'manager' | 'scanner' | null;
const KEY = 'tk_admin_club';

export function useMyClubs() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubIdState] = useState<string | null>(localStorage.getItem(KEY));
  const [role, setRole] = useState<ClubRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const apply = (list: Club[]) => {
      if (!active) return;
      setClubs(list);
      setClubIdState((cur) => {
        const next = list.find((c) => c.id === cur) ? cur : (list[0]?.id ?? null);
        if (next) localStorage.setItem(KEY, next);
        return next;
      });
      setLoading(false);
    };

    const fetchClubs = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (active) { setClubs([]); setLoading(false); } return; }
      if (active) setLoading(true);
      // Activate any pending staff invites for this email before we read clubs.
      await supabase.rpc('tk_claim_staff');
      const { data } = await supabase.rpc('tk_my_clubs');
      apply((data ?? []) as Club[]);
    };

    fetchClubs();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session) fetchClubs();
      else if (active) { setClubs([]); setRole(null); setLoading(false); }
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // Resolve the caller's role for whichever club is active.
  useEffect(() => {
    let active = true;
    if (!clubId) { setRole(null); return; }
    (async () => {
      const { data } = await supabase.rpc('tk_my_role', { p_club_id: clubId });
      if (active) setRole((data as ClubRole) ?? null);
    })();
    return () => { active = false; };
  }, [clubId]);

  const setClubId = (id: string) => { setClubIdState(id); localStorage.setItem(KEY, id); };
  const club = clubs.find((c) => c.id === clubId) ?? null;
  return { clubs, club, clubId, setClubId, role, loading };
}
