-- =====================================================================
-- SportsWeb One — Ticketing — db/tk_roles.sql
-- ---------------------------------------------------------------------
-- Role model for Ticket One:
--   • Club admin   — club_users.role = 'admin'        (full club control)
--   • Manager      — tk_staff.role  = 'manager'       (events, reports, scan)
--   • Scanner      — tk_staff.role  = 'scanner'       (account-based, scan only)
--   • PIN scanner  — tk_scan_codes  (no account; scans via a code)
--   • Super / SportsWeb admin — tk_is_platform_admin() (defined in core later)
--
-- We do NOT touch the platform's tk_has_club_role (RLS may depend on it).
-- Instead we add tk_my_role() and re-point the scanner functions at it.
--
-- Safe + idempotent. Run once in the Supabase SQL editor.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists tk_staff (
    id         uuid primary key default gen_random_uuid(),
    club_id    uuid not null references clubs(id) on delete cascade,
    user_id    uuid not null,
    role       text not null check (role in ('manager','scanner')),
    created_by uuid,
    created_at timestamptz not null default now(),
    unique (club_id, user_id)
);
alter table tk_staff enable row level security;

create table if not exists tk_scan_codes (
    id         uuid primary key default gen_random_uuid(),
    club_id    uuid not null references clubs(id) on delete cascade,
    event_id   uuid references tk_events(id) on delete cascade,   -- null = club-wide
    code       text not null unique,
    label      text,
    is_active  boolean not null default true,
    created_by uuid,
    created_at timestamptz not null default now(),
    expires_at timestamptz
);
alter table tk_scan_codes enable row level security;

-- ---------------------------------------------------------------------
-- 2. Platform admin stub — SportsWeb One core will replace this to read
--    its super / sportsweb admin list. Returns false until then.
-- ---------------------------------------------------------------------
create or replace function tk_is_platform_admin(p_uid uuid)
returns boolean language sql stable
set search_path = public
as $$ select false; $$;

-- ---------------------------------------------------------------------
-- 3. The caller's effective role for a club ('admin' | 'manager' |
--    'scanner' | null). Used by the admin UI and by the scanner funcs.
-- ---------------------------------------------------------------------
create or replace function tk_my_role(p_club_id uuid)
returns text language sql security definer
set search_path = public
as $$
  select case
    when tk_is_platform_admin(auth.uid()) then 'admin'
    when exists (select 1 from club_users cu
                  where cu.club_id = p_club_id and cu.user_id = auth.uid()
                    and cu.role::text = 'admin') then 'admin'
    when exists (select 1 from tk_staff s
                  where s.club_id = p_club_id and s.user_id = auth.uid()
                    and s.role = 'manager') then 'manager'
    when exists (select 1 from tk_staff s
                  where s.club_id = p_club_id and s.user_id = auth.uid()
                    and s.role = 'scanner') then 'scanner'
    else null
  end;
$$;

-- ---------------------------------------------------------------------
-- 4. Admin club switcher now includes clubs where the caller is a
--    manager (managers can open /admin); platform admins see all clubs.
-- ---------------------------------------------------------------------
create or replace function tk_my_clubs()
returns table (id uuid, name text, slug text, primary_colour text, logo_url text)
language sql security definer
set search_path = public
as $$
    select c.id, c.name, c.slug, c.primary_colour, c.logo_url
    from clubs c
    where tk_is_platform_admin(auth.uid())
       or exists (select 1 from club_users cu
                   where cu.club_id = c.id and cu.user_id = auth.uid())
       or exists (select 1 from tk_staff s
                   where s.club_id = c.id and s.user_id = auth.uid() and s.role = 'manager')
    order by c.name;
$$;

-- ---------------------------------------------------------------------
-- 5. Re-point the two account-based scanner functions at tk_my_role
--    (any staff — admin / manager / scanner — may scan). Bodies are
--    otherwise unchanged from db/tk_scanner.sql.
-- ---------------------------------------------------------------------
create or replace function tk_scan_ticket(
    p_qr text, p_gate text default null, p_device text default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
    v_parts text[]; v_tid uuid; v_eid uuid; v_sig text;
    t tk_tickets%rowtype; v_secret text; v_expected text; v_type text; v_result text;
begin
    v_parts := string_to_array(coalesce(p_qr,''), '.');
    if array_length(v_parts,1) <> 3 then
        return jsonb_build_object('result','invalid','message','Unrecognised code');
    end if;
    begin
        v_tid := v_parts[1]::uuid; v_eid := v_parts[2]::uuid;
    exception when others then
        return jsonb_build_object('result','invalid','message','Unrecognised code');
    end;
    v_sig := v_parts[3];

    select * into t from tk_tickets where id = v_tid;
    if not found then
        return jsonb_build_object('result','not_found','message','Ticket not found');
    end if;

    if tk_my_role(t.club_id) is null then
        raise exception 'Not authorised to scan for this club';
    end if;

    select signing_secret into v_secret from tk_events where id = t.event_id;
    v_expected := encode(hmac(t.id::text || '.' || t.event_id::text, v_secret, 'sha256'), 'hex');

    if t.event_id <> v_eid then v_result := 'wrong_event';
    elsif v_sig <> v_expected then v_result := 'invalid_sig';
    elsif t.status = 'void' then v_result := 'void';
    elsif t.status = 'refunded' then v_result := 'refunded';
    elsif t.status = 'redeemed' then v_result := 'duplicate';
    else v_result := 'admitted';
    end if;

    if v_result = 'admitted' then
        update tk_tickets
           set status='redeemed', redeemed_at=now(), redeemed_by=auth.uid(), redeemed_gate=p_gate
         where id=t.id and status='valid';
        if not found then v_result := 'duplicate'; end if;
    end if;

    insert into tk_scans (ticket_id, event_id, club_id, result, scanned_by, gate, device_id)
    values (t.id, t.event_id, t.club_id, v_result, auth.uid(), p_gate, p_device);

    select name into v_type from tk_ticket_types where id = t.ticket_type_id;
    return jsonb_build_object('result', v_result,
        'ticket', jsonb_build_object('serial_no', t.serial_no, 'type', v_type,
                                     'holder_name', t.holder_name, 'redeemed_at', t.redeemed_at));
end;
$$;

create or replace function tk_admit_ticket(
    p_ticket_id uuid, p_gate text default null, p_device text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare t tk_tickets%rowtype; v_type text; v_result text;
begin
    select * into t from tk_tickets where id = p_ticket_id;
    if not found then return jsonb_build_object('result','not_found'); end if;

    if tk_my_role(t.club_id) is null then
        raise exception 'Not authorised to scan for this club';
    end if;

    if t.status = 'void' then v_result := 'void';
    elsif t.status = 'refunded' then v_result := 'refunded';
    elsif t.status = 'redeemed' then v_result := 'duplicate';
    else
        update tk_tickets
           set status='redeemed', redeemed_at=now(), redeemed_by=auth.uid(), redeemed_gate=p_gate
         where id=t.id and status='valid';
        v_result := case when found then 'admitted' else 'duplicate' end;
    end if;

    insert into tk_scans (ticket_id, event_id, club_id, result, scanned_by, gate, device_id)
    values (t.id, t.event_id, t.club_id, v_result, auth.uid(), p_gate, p_device);

    select name into v_type from tk_ticket_types where id = t.ticket_type_id;
    return jsonb_build_object('result', v_result,
        'ticket', jsonb_build_object('serial_no', t.serial_no, 'type', v_type, 'holder_name', t.holder_name));
end;
$$;

-- ---------------------------------------------------------------------
-- 6. PIN scanning — anon, gated entirely by a valid scan code.
-- ---------------------------------------------------------------------
create or replace function tk_scan_with_code(
    p_code text, p_qr text, p_gate text default null, p_device text default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
    cd tk_scan_codes%rowtype;
    v_parts text[]; v_tid uuid; v_eid uuid; v_sig text;
    t tk_tickets%rowtype; v_secret text; v_expected text; v_type text; v_result text;
begin
    select * into cd from tk_scan_codes
     where code = upper(trim(coalesce(p_code,''))) and is_active limit 1;
    if not found then
        return jsonb_build_object('result','unauthorised','message','Invalid or inactive code');
    end if;
    if cd.expires_at is not null and now() > cd.expires_at then
        return jsonb_build_object('result','unauthorised','message','Code expired');
    end if;

    v_parts := string_to_array(coalesce(p_qr,''), '.');
    if array_length(v_parts,1) <> 3 then
        return jsonb_build_object('result','invalid','message','Unrecognised code');
    end if;
    begin
        v_tid := v_parts[1]::uuid; v_eid := v_parts[2]::uuid;
    exception when others then
        return jsonb_build_object('result','invalid','message','Unrecognised code');
    end;
    v_sig := v_parts[3];

    select * into t from tk_tickets where id = v_tid;
    if not found then
        return jsonb_build_object('result','not_found','message','Ticket not found');
    end if;

    -- code must belong to the ticket's club (and event, if event-scoped)
    if t.club_id <> cd.club_id or (cd.event_id is not null and t.event_id <> cd.event_id) then
        return jsonb_build_object('result','wrong_event','message','Code not valid for this ticket');
    end if;

    select signing_secret into v_secret from tk_events where id = t.event_id;
    v_expected := encode(hmac(t.id::text || '.' || t.event_id::text, v_secret, 'sha256'), 'hex');

    if t.event_id <> v_eid then v_result := 'wrong_event';
    elsif v_sig <> v_expected then v_result := 'invalid_sig';
    elsif t.status = 'void' then v_result := 'void';
    elsif t.status = 'refunded' then v_result := 'refunded';
    elsif t.status = 'redeemed' then v_result := 'duplicate';
    else v_result := 'admitted';
    end if;

    if v_result = 'admitted' then
        update tk_tickets
           set status='redeemed', redeemed_at=now(), redeemed_gate=coalesce(p_gate, cd.label)
         where id=t.id and status='valid';
        if not found then v_result := 'duplicate'; end if;
    end if;

    insert into tk_scans (ticket_id, event_id, club_id, result, scanned_by, gate, device_id)
    values (t.id, t.event_id, t.club_id, v_result, null, coalesce(p_gate, cd.label), p_device);

    select name into v_type from tk_ticket_types where id = t.ticket_type_id;
    return jsonb_build_object('result', v_result,
        'ticket', jsonb_build_object('serial_no', t.serial_no, 'type', v_type, 'holder_name', t.holder_name));
end;
$$;

-- Events a PIN scanner can scan (so the app knows what to load after sign-in).
create or replace function tk_events_for_code(p_code text)
returns table (id uuid, name text, starts_at timestamptz)
language sql security definer
set search_path = public
as $$
    with cd as (
        select * from tk_scan_codes
        where code = upper(trim(coalesce(p_code,''))) and is_active
          and (expires_at is null or now() <= expires_at)
        limit 1
    )
    select e.id, e.name, e.starts_at
    from tk_events e join cd on e.club_id = cd.club_id
    where (cd.event_id is null or e.id = cd.event_id)
      and e.status = 'published'
    order by e.starts_at nulls last;
$$;

-- Admin helper to mint a scan code (used by the upcoming Staff UI; handy for testing now).
create or replace function tk_create_scan_code(
    p_club_id uuid, p_event_id uuid default null, p_label text default 'Gate'
) returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_code text;
begin
    if tk_my_role(p_club_id) <> 'admin' then
        raise exception 'Only a club admin can create scan codes';
    end if;
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    insert into tk_scan_codes (club_id, event_id, code, label, created_by)
    values (p_club_id, p_event_id, v_code, p_label, auth.uid());
    return v_code;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. RLS — only club admins manage staff + scan codes from the app.
--    (The scanner functions are security definer and read internally.)
-- ---------------------------------------------------------------------
drop policy if exists tk_staff_admin_all on tk_staff;
create policy tk_staff_admin_all on tk_staff
  for all using (tk_my_role(club_id) = 'admin')
  with check (tk_my_role(club_id) = 'admin');

drop policy if exists tk_scan_codes_admin_all on tk_scan_codes;
create policy tk_scan_codes_admin_all on tk_scan_codes
  for all using (tk_my_role(club_id) = 'admin')
  with check (tk_my_role(club_id) = 'admin');

-- ---------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------
grant select, insert, update, delete on tk_staff, tk_scan_codes to authenticated;
grant select, insert, update, delete on tk_staff, tk_scan_codes to service_role;

grant execute on function tk_is_platform_admin(uuid)              to anon, authenticated;
grant execute on function tk_my_role(uuid)                        to authenticated;
grant execute on function tk_my_clubs()                           to authenticated;
grant execute on function tk_scan_ticket(text, text, text)        to authenticated;
grant execute on function tk_admit_ticket(uuid, text, text)       to authenticated;
grant execute on function tk_scan_with_code(text, text, text, text) to anon, authenticated;
grant execute on function tk_events_for_code(text)                to anon, authenticated;
grant execute on function tk_create_scan_code(uuid, uuid, text)   to authenticated;

commit;
