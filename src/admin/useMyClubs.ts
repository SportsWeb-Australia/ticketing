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
    (async () => {
      const { data } = await supabase.rpc('tk_my_clubs');
      const list = (data ?? []) as Club[];
      setClubs(list);
      if (list.length && !list.find((c) => c.id === clubId)) {
        setClubIdState(list[0].id);
        localStorage.setItem(KEY, list[0].id);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setClubId = (id: string) => { setClubIdState(id); localStorage.setItem(KEY, id); };
  const club = clubs.find((c) => c.id === clubId) ?? null;
  return { clubs, club, clubId, setClubId, loading };
}
