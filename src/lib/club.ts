// Resolve a club id from its slug, for pretty URLs like
//   /:clubSlug/e/:eventSlug
//
// ASSUMPTION: clubs has a `slug` column and anon may read (id, slug).
// If your clubs table differs, adjust the select below. If you'd rather
// not expose clubs to anon at all, just use the /e/:eventId route, which
// needs no clubs lookup at all.

import { supabase } from './supabase';

export async function resolveClubIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('clubs')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}
