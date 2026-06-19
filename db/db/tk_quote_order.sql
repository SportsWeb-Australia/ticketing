-- =====================================================================
-- SportsWeb One — Ticketing Module
-- tk_quote_order.sql  —  server-authoritative order pricing
-- ---------------------------------------------------------------------
-- The public sales page calls this (as anon) to price a cart.
--
-- NO-SURCHARGE MODEL (RBA ban, 1 Oct 2026): the buyer pays FACE VALUE
-- only. There is no buyer-facing fee. The platform's cut and the Stripe
-- processing cost are taken from the CLUB's proceeds at checkout (Stripe
-- Connect direct charge + application_fee), so this public quote never
-- exposes the platform margin to the buyer's browser.
--
-- Returns jsonb:
--   { event_id, currency, subtotal_cents, total_cents (= subtotal),
--     ticket_count, lines:[ {ticket_type_id,name,quantity,
--     unit_price_cents,line_total_cents} ] }
-- =====================================================================

create or replace function tk_quote_order(p_event_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_event    tk_events%rowtype;
    v_item     jsonb;
    v_type     tk_ticket_types%rowtype;
    v_qty      integer;
    v_avail    integer;
    v_subtotal integer := 0;
    v_count    integer := 0;
    v_lines    jsonb   := '[]'::jsonb;
begin
    select * into v_event
    from tk_events
    where id = p_event_id and status = 'published';
    if not found then
        raise exception 'Event not available';
    end if;

    for v_item in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
    loop
        v_qty := (v_item->>'quantity')::int;
        if v_qty is null or v_qty <= 0 then
            continue;
        end if;

        select * into v_type
        from tk_ticket_types
        where id = (v_item->>'ticket_type_id')::uuid
          and event_id = p_event_id
          and is_active;
        if not found then
            raise exception 'Ticket type not available';
        end if;

        -- sales window
        if (v_type.sales_start_at is not null and now() < v_type.sales_start_at)
        or (v_type.sales_end_at   is not null and now() > v_type.sales_end_at) then
            raise exception 'Sales are closed for %', v_type.name;
        end if;

        -- availability
        if v_type.quantity_total is not null then
            v_avail := v_type.quantity_total - v_type.quantity_sold;
            if v_qty > v_avail then
                raise exception 'Only % left for %', greatest(v_avail,0), v_type.name;
            end if;
        end if;

        -- per-order cap
        if v_qty > v_type.max_per_order then
            raise exception 'Limit of % per order for %', v_type.max_per_order, v_type.name;
        end if;

        v_subtotal := v_subtotal + (v_type.price_cents * v_qty);
        v_count    := v_count + v_qty;
        v_lines := v_lines || jsonb_build_object(
            'ticket_type_id',  v_type.id,
            'name',            v_type.name,
            'quantity',        v_qty,
            'unit_price_cents',v_type.price_cents,
            'line_total_cents',v_type.price_cents * v_qty
        );
    end loop;

    -- buyer pays face value; total == subtotal (no surcharge)
    return jsonb_build_object(
        'event_id',       p_event_id,
        'currency',       v_event.currency,
        'subtotal_cents', v_subtotal,
        'total_cents',    v_subtotal,
        'ticket_count',   v_count,
        'lines',          v_lines
    );
end;
$$;

grant execute on function tk_quote_order(uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- The platform cut (and Stripe handling) is computed server-side at
-- checkout, NOT here. tk_calc_fee() + tk_fee_rules still drive that cut;
-- the cut becomes the Stripe application_fee on a Connect direct charge,
-- so it is deducted from the club's proceeds — never added to the buyer.
-- ---------------------------------------------------------------------
