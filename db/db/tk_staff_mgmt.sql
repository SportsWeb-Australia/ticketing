-- =====================================================================
-- SportsWeb One — Ticketing — db/tk_staff_mgmt.sql
-- ---------------------------------------------------------------------
-- Admin-side staff management on top of tk_roles.sql:
--   • invite managers / scanners by EMAIL (pending until they sign up)
--   • list / remove staff
--   • claim pending invites on login
--   • scan codes are EVENT-SPECIFIC; list + enable/disable
--
-- Run after tk_roles.sql. Idempotent.
-- =====================================================================

begin;

-- ---- extend tk_staff for invite-by-email + pending status -----------
alter table tk_staff add column if not exists email  text;
alter table tk_staff add column if not exists status text not null default 'active';
alter table tk_staff alter column user_id drop not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tk_staff_status_chk') then
    alter table tk_staff add constraint tk_staff_status_chk check (status in ('active','pending'));
  end if;
end $$;

create unique index if not exists tk_staff_club_email_uniq on tk_staff (club_id, lower(email));

-- ---- add staff by email (admin only) --------------------------------
-- Links to an existing account if the email already has one, otherwise
-- stores a 'pending' invite that activates when that person signs up.
create or replace function tk_add_staff(p_club_id uuid, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_uid uuid; v_email text := lower(trim(p_email)); v_status text;
begin
  if tk_my_role(p_club_id) <> 'admin' then raise exception 'Only a club admin can manage staff'; end if;
  if p_role not in ('manager','scanner') then raise exception 'Role must be manager or scanner'; end if;
  if v_email = '' then raise exception 'Email required'; end if;

  select id into v_uid from auth.users where lower(email) = v_email limit 1;
  v_status := case when v_uid is null then 'pending' else 'active' end;

  insert into tk_staff (club_id, user_id, email, role, status, created_by)
  values (p_club_id, v_uid, v_email, p_role, v_status, auth.uid())
  on conflict (club_id, lower(email)) do update
    set role    = excluded.role,
        user_id = coalesce(tk_staff.user_id, excluded.user_id),
        status  = case when coalesce(tk_staff.user_id, excluded.user_id) is null then 'pending' else 'active' end;

  return jsonb_build_object('status', v_status, 'email', v_email, 'role', p_role);
end;
$$;

create or replace function tk_remove_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_club uuid;
begin
  select club_id into v_club from tk_staff where id = p_staff_id;
  if v_club is null then return; end if;
  if tk_my_role(v_club) <> 'admin' then raise exception 'Only a club admin can manage staff'; end if;
  delete from tk_staff where id = p_staff_id;
end;
$$;

create or replace function tk_list_staff(p_club_id uuid)
returns table (id uuid, email text, role text, status text, created_at timestamptz)
language sql security definer set search_path = public
as $$
  select s.id, coalesce(s.email, u.email) as email, s.role, s.status, s.created_at
  from tk_staff s
  left join auth.users u on u.id = s.user_id
  where s.club_id = p_club_id
    and tk_my_role(p_club_id) = 'admin'
  order by s.created_at desc;
$$;

-- Activate any pending invites that match the signed-in user's email.
create or replace function tk_claim_staff()
returns void language plpgsql security definer set search_path = public
as $$
begin
  update tk_staff s
     set user_id = auth.uid(), status = 'active'
    from auth.users u
   where u.id = auth.uid()
     and s.user_id is null
     and lower(s.email) = lower(u.email);
end;
$$;

-- ---- scan codes are event-specific now ------------------------------
-- (drop first: we're removing the default on p_event_id, which CREATE OR
--  REPLACE cannot do.)
drop function if exists tk_create_scan_code(uuid, uuid, text);
create or replace function tk_create_scan_code(p_club_id uuid, p_event_id uuid, p_label text default 'Gate')
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare v_code text;
begin
  if tk_my_role(p_club_id) <> 'admin' then raise exception 'Only a club admin can create scan codes'; end if;
  if p_event_id is null then raise exception 'A gate code must belong to an event'; end if;
  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  insert into tk_scan_codes (club_id, event_id, code, label, created_by)
  values (p_club_id, p_event_id, v_code, p_label, auth.uid());
  return v_code;
end;
$$;

create or replace function tk_list_scan_codes(p_event_id uuid)
returns table (id uuid, code text, label text, is_active boolean, created_at timestamptz, expires_at timestamptz)
language sql security definer set search_path = public
as $$
  select sc.id, sc.code, sc.label, sc.is_active, sc.created_at, sc.expires_at
  from tk_scan_codes sc
  join tk_events e on e.id = sc.event_id
  where sc.event_id = p_event_id
    and tk_my_role(e.club_id) in ('admin','manager')
  order by sc.created_at desc;
$$;

create or replace function tk_set_scan_code_active(p_code_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare v_club uuid;
begin
  select club_id into v_club from tk_scan_codes where id = p_code_id;
  if v_club is null then return; end if;
  if tk_my_role(v_club) <> 'admin' then raise exception 'Only a club admin can change scan codes'; end if;
  update tk_scan_codes set is_active = p_active where id = p_code_id;
end;
$$;

-- ---- grants ---------------------------------------------------------
grant execute on function tk_add_staff(uuid, text, text)        to authenticated;
grant execute on function tk_remove_staff(uuid)                 to authenticated;
grant execute on function tk_list_staff(uuid)                   to authenticated;
grant execute on function tk_claim_staff()                      to authenticated;
grant execute on function tk_create_scan_code(uuid, uuid, text) to authenticated;
grant execute on function tk_list_scan_codes(uuid)              to authenticated;
grant execute on function tk_set_scan_code_active(uuid, boolean) to authenticated;

commit;
