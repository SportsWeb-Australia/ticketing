// Supabase client — bound to the shared sportsweb-one project.
// This shared database is what connects the ticketing module into
// SportsWeb One (clubs, club_users, modules entitlement, tk_ tables).

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey);
