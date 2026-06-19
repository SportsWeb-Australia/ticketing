-- =====================================================================
-- SportsWeb One — Ticketing Module
-- db/tk_checkout.sql  —  checkout database layer
-- ---------------------------------------------------------------------
-- Run AFTER sportsweb_ticketing.sql and tk_quote_order.sql.
--
-- Adds:
--   • tk_club_stripe         — each club's Stripe Connect account + status
--   • tk_checkout_pricing()  — server-authoritative pricing for the edge fn
--                              (includes the platform cut + the club's
--                               Connect status; NOT exposed to the browser)
--   • tk_issue_tickets()     — issues signed (HMAC) tickets for a paid order
--                              and decrements availability; idempotent
--
-- Model: no-surcharge. Buyer pays face value. The platform cut is taken as
-- the Stripe application_fee on a Connect DIRECT charge, so the club bears
-- the Stripe processing fee automatically and the cut never touches the buyer.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Club Stripe Connect accounts
-- ---------------------------------------------------------------------
create table if not exists tk_club_stripe (
    club_id           uuid primary key references clubs(id) on delete cascade,
    stripe_account_id text not null,                 -- acct_xxx
    charges_enabled   boolean not null default false,
    details_submitted boolean not null default false,
    payouts_enabled   boolean not null default false,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

alter table tk_club_stripe enable row level security;

drop policy if exists tk_club_stripe_member_read on tk_club_stripe;
create policy tk_club_stripe_member_read on tk_club_stripe
    for select using (tk_is_club_member(club_id));
-- All writes happen via the edge functions using the service role, which
-- bypasses RLS. No public write policy on purpose.

-- ---------------------------------------------------------------------
-- 2. Server-side checkout pricing (service role only)
--    Like tk_quote_order, but ALSO returns the platform cut and the club's
--    Connect status. Never granted to anon/authenticated.
-- ---------------------------------------------------------------------
create or replace function tk_checkout_pricing(p_event_id uuid, p_items jsonb)
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
    v_rule     tk_fee_rules%rowtype;
    v_fee      integer := 0;
    v_acct     text;
    v_charges  boolean := false;
begin
    select * into v_event from tk_events where id = p_event_id and status = 'published';
    if not found then raise exception 'Event not available'; end if;

    for v_item in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
        v_qty := (v_item->>'quantity')::int;
        if v_qty is null or v_qty <= 0 then continue; end if;

        select * into v_type from tk_ticket_types
        where id = (v_item->>'ticket_type_id')::uuid and event_id = p_event_id and is_active;
        if not found then raise exception 'Ticket type not available'; end if;

        if (v_type.sales_start_at is not null and now() < v_type.sales_start_at)
        or (v_type.sales_end_at   is not null and now() > v_type.sales_end_at) then
            raise exception 'Sales are closed for %', v_type.name;
        end if;

        if v_type.quantity_total is not null then
            v_avail := v_type.quantity_total - v_type.quantity_sold;
            if v_qty > v_avail then raise exception 'Only % left for %', greatest(v_avail,0), v_type.name; end if;
        end if;

        if v_qty > v_type.max_per_order then
            raise exception 'Limit of % per order for %', v_type.max_per_order, v_type.name;
        end if;

        v_subtotal := v_subtotal + (v_type.price_cents * v_qty);
        v_count    := v_count + v_qty;
        v_lines := v_lines || jsonb_build_object(
            'ticket_type_id',  v_type.id,
            'name',            v_type.name,
            'quantity',        v_qty,
            'unit_price_cents',v_type.price_cents
        );
    end loop;

    -- resolve fee rule: event-specific → club-wide → platform default
    select * into v_rule from tk_fee_rules
     where is_active
       and ( event_id = p_event_id
             or (event_id is null and club_id = v_event.club_id)
             or (event_id is null and club_id is null) )
     order by (event_id = p_event_id) desc nulls last,
              (club_id  = v_event.club_id) desc nulls last
     limit 1;
    if found and v_subtotal > 0 then
        v_fee := tk_calc_fee(v_rule.id, v_subtotal, v_count);
    end if;

    select stripe_account_id, charges_enabled into v_acct, v_charges
      from tk_club_stripe where club_id = v_event.club_id;

    return jsonb_build_object(
        'club_id',               v_event.club_id,
        'currency',              v_event.currency,
        'subtotal_cents',        v_subtotal,
        'total_cents',           v_subtotal,            -- buyer pays face value
        'application_fee_cents', v_fee,                 -- platform cut (from club)
        'ticket_count',          v_count,
        'lines',                 v_lines,
        'stripe_account_id',     v_acct,
        'charges_enabled',       coalesce(v_charges, false)
    );
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Issue signed tickets for a paid order (idempotent)
--    HMAC-signs each ticket with the event's signing_secret using pgcrypto,
--    assigns a per-event sequential serial, and decrements availability.
-- ---------------------------------------------------------------------
create or replace function tk_issue_tickets(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    o         tk_orders%rowtype;
    it        tk_order_items%rowtype;
    v_secret  text;
    v_next    integer;
    i         integer;
    v_tid     uuid;
begin
    select * into o from tk_orders where id = p_order_id;
    if not found then raise exception 'Order not found'; end if;

    -- idempotency: never issue twice for the same order
    if exists (select 1 from tk_tickets where order_id = p_order_id) then
        return;
    end if;

    -- serialise issuance per event so serial numbers can't collide
    perform pg_advisory_xact_lock(hashtext(o.event_id::text));

    select signing_secret into v_secret from tk_events where id = o.event_id;

    for it in select * from tk_order_items where order_id = p_order_id loop
        for i in 1..it.quantity loop
            v_tid := gen_random_uuid();
            select coalesce(max(serial_no),0) + 1 into v_next
              from tk_tickets where event_id = o.event_id;

            insert into tk_tickets
                (id, order_id, event_id, club_id, ticket_type_id,
                 serial_no, signature, holder_name, status)
            values
                (v_tid, p_order_id, o.event_id, o.club_id, it.ticket_type_id,
                 v_next,
                 encode(hmac(v_tid::text || '.' || o.event_id::text, v_secret, 'sha256'), 'hex'),
                 o.buyer_name,
                 'valid');
        end loop;

        update tk_ticket_types
           set quantity_sold = quantity_sold + it.quantity
         where id = it.ticket_type_id;
    end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Grants
--    The edge functions connect as service_role. Tables created via raw
--    SQL aren't auto-granted, so grant explicitly (same reason the anon
--    grants were needed for the sales page).
-- ---------------------------------------------------------------------
grant select, insert, update, delete on
    tk_events, tk_ticket_types, tk_fee_rules, tk_orders,
    tk_order_items, tk_tickets, tk_scans, tk_club_stripe
to service_role;

grant select on tk_club_stripe to authenticated;

grant execute on function tk_checkout_pricing(uuid, jsonb) to service_role;
grant execute on function tk_issue_tickets(uuid)           to service_role;

-- keep checkout pricing out of the browser
revoke execute on function tk_checkout_pricing(uuid, jsonb) from anon, authenticated;

commit;
