-- =====================================================================
-- SportsWeb One — Ticketing — db/tk_scanner.sql
-- ---------------------------------------------------------------------
-- Gate scanning. The scanner device NEVER holds the event signing secret;
-- it sends the scanned QR payload and these functions verify the HMAC,
-- flip valid -> redeemed atomically, and log the scan. Run after the
-- earlier ticketing migrations.
--
-- QR payload format: "<ticket_id>.<event_id>.<signature>"
-- Authorisation: caller must be a club_users member of the ticket's club
-- with role admin / supervisor / gate / scanner (role is an enum -> ::text).
-- =====================================================================

begin;

-- Validate a scanned QR and admit if valid (atomic + logged).
create or replace function tk_scan_ticket(
    p_qr     text,
    p_gate   text default null,
    p_device text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_parts    text[];
    v_tid      uuid;
    v_eid      uuid;
    v_sig      text;
    t          tk_tickets%rowtype;
    v_secret   text;
    v_expected text;
    v_type     text;
    v_result   text;
begin
    v_parts := string_to_array(coalesce(p_qr,''), '.');
    if array_length(v_parts, 1) <> 3 then
        return jsonb_build_object('result','invalid','message','Unrecognised code');
    end if;
    begin
        v_tid := v_parts[1]::uuid;
        v_eid := v_parts[2]::uuid;
    exception when others then
        return jsonb_build_object('result','invalid','message','Unrecognised code');
    end;
    v_sig := v_parts[3];

    select * into t from tk_tickets where id = v_tid;
    if not found then
        return jsonb_build_object('result','not_found','message','Ticket not found');
    end if;

    if not tk_has_club_role(t.club_id, array['admin','supervisor','gate','scanner']) then
        raise exception 'Not authorised to scan for this club';
    end if;

    select signing_secret into v_secret from tk_events where id = t.event_id;
    v_expected := encode(hmac(t.id::text || '.' || t.event_id::text, v_secret, 'sha256'), 'hex');

    if t.event_id <> v_eid then
        v_result := 'wrong_event';
    elsif v_sig <> v_expected then
        v_result := 'invalid_sig';
    elsif t.status = 'void' then
        v_result := 'void';
    elsif t.status = 'refunded' then
        v_result := 'refunded';
    elsif t.status = 'redeemed' then
        v_result := 'duplicate';
    else
        v_result := 'admitted';
    end if;

    if v_result = 'admitted' then
        update tk_tickets
           set status = 'redeemed', redeemed_at = now(),
               redeemed_by = auth.uid(), redeemed_gate = p_gate
         where id = t.id and status = 'valid';
        if not found then
            v_result := 'duplicate';   -- lost a race to another gate
        end if;
    end if;

    insert into tk_scans (ticket_id, event_id, club_id, result, scanned_by, gate, device_id)
    values (t.id, t.event_id, t.club_id, v_result, auth.uid(), p_gate, p_device);

    select name into v_type from tk_ticket_types where id = t.ticket_type_id;

    return jsonb_build_object(
        'result', v_result,
        'ticket', jsonb_build_object(
            'serial_no',   t.serial_no,
            'type',        v_type,
            'holder_name', t.holder_name,
            'redeemed_at', t.redeemed_at
        )
    );
end;
$$;

-- Manual admit by ticket id (supervisor "search by name -> admit"; no QR sig).
create or replace function tk_admit_ticket(
    p_ticket_id uuid,
    p_gate      text default null,
    p_device    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    t        tk_tickets%rowtype;
    v_type   text;
    v_result text;
begin
    select * into t from tk_tickets where id = p_ticket_id;
    if not found then return jsonb_build_object('result','not_found'); end if;

    if not tk_has_club_role(t.club_id, array['admin','supervisor','gate','scanner']) then
        raise exception 'Not authorised to scan for this club';
    end if;

    if t.status = 'void' then
        v_result := 'void';
    elsif t.status = 'refunded' then
        v_result := 'refunded';
    elsif t.status = 'redeemed' then
        v_result := 'duplicate';
    else
        update tk_tickets
           set status = 'redeemed', redeemed_at = now(),
               redeemed_by = auth.uid(), redeemed_gate = p_gate
         where id = t.id and status = 'valid';
        v_result := case when found then 'admitted' else 'duplicate' end;
    end if;

    insert into tk_scans (ticket_id, event_id, club_id, result, scanned_by, gate, device_id)
    values (t.id, t.event_id, t.club_id, v_result, auth.uid(), p_gate, p_device);

    select name into v_type from tk_ticket_types where id = t.ticket_type_id;

    return jsonb_build_object(
        'result', v_result,
        'ticket', jsonb_build_object(
            'serial_no', t.serial_no, 'type', v_type, 'holder_name', t.holder_name
        )
    );
end;
$$;

grant execute on function tk_scan_ticket(text, text, text)  to authenticated;
grant execute on function tk_admit_ticket(uuid, text, text)  to authenticated;

commit;
