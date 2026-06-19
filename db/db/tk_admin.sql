-- =====================================================================
-- SportsWeb One — Ticketing — db/tk_admin.sql
-- ---------------------------------------------------------------------
-- Small helpers the admin UI uses. Self-contained (security definer) so
-- the admin works regardless of how the platform's clubs/club_users RLS
-- is configured. Run after the earlier ticketing migrations.
-- =====================================================================

begin;

-- Clubs the signed-in user is a member of (for the admin club switcher).
create or replace function tk_my_clubs()
returns table (id uuid, name text, slug text, primary_colour text, logo_url text)
language sql
security definer
set search_path = public
as $$
    select c.id, c.name, c.slug, c.primary_colour, c.logo_url
    from clubs c
    where exists (
        select 1 from club_users cu
        where cu.club_id = c.id and cu.user_id = auth.uid()
    )
    order by c.name;
$$;

-- The active fee rule that applies to a club (club-specific preferred over
-- the platform default). Read-only display so a club sees what's deducted.
create or replace function tk_fee_for_club(p_club_id uuid)
returns table (
    label text, percent_bps int, fixed_cents int,
    fixed_basis text, min_fee_cents int, max_fee_cents int
)
language sql
security definer
set search_path = public
as $$
    select label, percent_bps, fixed_cents, fixed_basis, min_fee_cents, max_fee_cents
    from tk_fee_rules
    where is_active and event_id is null
      and (club_id = p_club_id or club_id is null)
    order by (club_id is not null) desc   -- club-specific first
    limit 1;
$$;

grant execute on function tk_my_clubs()        to authenticated;
grant execute on function tk_fee_for_club(uuid) to authenticated;

commit;
