import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Club {
  id: string; name: string; slug: string | null;
  primary_colour: string | null; logo_url: string | null;
}
const KEY = 'tk_admin_club';

export function useMyClubs() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubIdState] = useState<string | null>(localStorage.getItem(KEY));
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

    // Only query once we actually have an auth session — otherwise tk_my_clubs
    // runs as anon (auth.uid() null) and wrongly returns zero clubs.
    const fetchClubs = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (active) { setClubs([]); setLoading(false); } return; }
      if (active) setLoading(true);
      const { data } = await supabase.rpc('tk_my_clubs');
      apply((data ?? []) as Club[]);
    };

    fetchClubs();

    // Re-fetch the moment the session is established (fixes first-login race)
    // or cleared on sign-out.
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session) fetchClubs();
      else if (active) { setClubs([]); setLoading(false); }
    });

    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const setClubId = (id: string) => { setClubIdState(id); localStorage.setItem(KEY, id); };
  const club = clubs.find((c) => c.id === clubId) ?? null;
  return { clubs, club, clubId, setClubId, loading };
}
