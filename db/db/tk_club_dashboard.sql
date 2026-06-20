-- ---------------------------------------------------------------------
-- Ticket One : club-level dashboard feed
--
-- One source of truth for "how is ticketing going for this club", consumed
-- by BOTH the Ticket One admin dashboard AND the SportsWeb One core committee
-- dashboards. Read access is gated on club_users membership (ANY role) so
-- committee / treasurer / president roles can see the numbers without being
-- ticketing admins. Ticketing staff (tk_staff managers/scanners who may not
-- sit in club_users) are allowed too.
--
-- Run in: Supabase SQL Editor. Pure ASCII.
-- ---------------------------------------------------------------------

-- Can the caller read this club's ticketing roll-up?
create or replace function tk_can_view_club(p_club_id uuid)
returns boolean
language sql security definer
set search_path = public
as $$
  select exists (
    select 1 from club_users
    where club_id = p_club_id and user_id = auth.uid()
  ) or (tk_my_role(p_club_id) is not null);
$$;

-- Headline KPIs for a club (single jsonb object).
create or replace function tk_club_summary(p_club_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v       jsonb;
  v_agg   jsonb;
  v_next  jsonb;
begin
  if not tk_can_view_club(p_club_id) then
    raise exception 'Not authorised for this club';
  end if;

  -- event counts
  select jsonb_build_object(
    'events_total',     count(*),
    'events_published', count(*) filter (where status = 'published'),
    'events_draft',     count(*) filter (where status = 'draft'),
    'events_upcoming',  count(*) filter (
                          where status = 'published'
                            and (starts_at is null or starts_at >= now())
                        )
  )
  into v
  from tk_events
  where club_id = p_club_id;

  -- ticket + revenue totals (across all events)
  select jsonb_build_object(
    'tickets_issued',  coalesce(sum(tickets_issued),   0),
    'tickets_in',      coalesce(sum(tickets_redeemed), 0),
    'gross_cents',     coalesce(sum(gross_cents),      0),
    'collected_cents', coalesce(sum(collected_cents),  0)
  )
  into v_agg
  from tk_event_sales_summary
  where club_id = p_club_id;
  v := v || v_agg;

  -- collected in the last 30 days
  v := v || jsonb_build_object(
    'collected_30d_cents',
    (select coalesce(sum(total_cents), 0)
       from tk_orders
      where club_id = p_club_id
        and status = 'paid'
        and paid_at >= now() - interval '30 days')
  );

  -- soonest upcoming published event
  select jsonb_build_object('id', id, 'name', name, 'starts_at', starts_at)
  into v_next
  from tk_events
  where club_id = p_club_id
    and status = 'published'
    and (starts_at is null or starts_at >= now())
  order by starts_at asc nulls last
  limit 1;
  v := v || jsonb_build_object('next_event', v_next);

  return v;
end;
$$;

-- Per-event rows for the dashboard list (newest first).
create or replace function tk_club_events(p_club_id uuid)
returns table (
  id uuid,
  name text,
  starts_at timestamptz,
  status text,
  tickets_issued bigint,
  tickets_in bigint,
  gross_cents bigint,
  collected_cents bigint
)
language sql security definer
set search_path = public
as $$
  select
    e.id, e.name, e.starts_at, e.status,
    coalesce(s.tickets_issued,   0)::bigint,
    coalesce(s.tickets_redeemed, 0)::bigint,
    coalesce(s.gross_cents,      0)::bigint,
    coalesce(s.collected_cents,  0)::bigint
  from tk_events e
  left join tk_event_sales_summary s on s.event_id = e.id
  where e.club_id = p_club_id
    and tk_can_view_club(p_club_id)
  order by e.starts_at desc nulls last;
$$;

grant execute on function tk_can_view_club(uuid) to authenticated;
grant execute on function tk_club_summary(uuid)  to authenticated;
grant execute on function tk_club_events(uuid)   to authenticated;
