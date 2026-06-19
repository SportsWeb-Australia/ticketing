-- =====================================================================
-- SportsWeb One — Ticketing — db/tk_get_order_tickets.sql
-- ---------------------------------------------------------------------
-- The confirmation page is reached by anonymous buyers, who can't read
-- tk_tickets under RLS (correctly locked to club staff). This function
-- returns ONLY the tickets for one order, keyed by the order's unguessable
-- UUID (a capability link). Run after tk_checkout.sql.
--
-- The 'qr' field is the QR payload: "<ticket_id>.<event_id>.<signature>".
-- A scanner recomputes HMAC(ticket_id.event_id, event secret) and compares
-- to the signature — the secret never leaves the server.
-- =====================================================================

create or replace function tk_get_order_tickets(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    o        tk_orders%rowtype;
    ev       tk_events%rowtype;
    v_list   jsonb;
begin
    select * into o from tk_orders where id = p_order_id and status = 'paid';
    if not found then
        return jsonb_build_object('found', false);
    end if;

    select * into ev from tk_events where id = o.event_id;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id',          t.id,
            'serial_no',   t.serial_no,
            'type',        tt.name,
            'holder_name', t.holder_name,
            'status',      t.status,
            'qr',          t.id::text || '.' || t.event_id::text || '.' || t.signature
        ) order by t.serial_no
    ), '[]'::jsonb)
    into v_list
    from tk_tickets t
    join tk_ticket_types tt on tt.id = t.ticket_type_id
    where t.order_id = p_order_id;

    return jsonb_build_object(
        'found',      true,
        'order_id',   o.id,
        'buyer_name', o.buyer_name,
        'event', jsonb_build_object(
            'name',          ev.name,
            'venue_name',    ev.venue_name,
            'venue_address', ev.venue_address,
            'starts_at',     ev.starts_at,
            'timezone',      ev.timezone,
            'brand_color',   ev.ticket_template->>'brandColor'
        ),
        'tickets', v_list
    );
end;
$$;

grant execute on function tk_get_order_tickets(uuid) to anon, authenticated;
