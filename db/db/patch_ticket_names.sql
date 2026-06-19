-- =====================================================================
-- SportsWeb One — Ticketing — PATCH: put the buyer's name on each ticket
-- so the gate manifest / manual search can find people by name.
--
-- 1. Recreate tk_issue_tickets so new tickets get holder_name = buyer name.
-- 2. Backfill names onto tickets already issued (your test tickets).
--
-- Run once in the Supabase SQL editor. Idempotent.
-- =====================================================================

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

    if exists (select 1 from tk_tickets where order_id = p_order_id) then
        return;  -- idempotent: never issue twice
    end if;

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

-- Backfill existing tickets that were issued before this fix.
update tk_tickets t
   set holder_name = o.buyer_name
  from tk_orders o
 where t.order_id = o.id
   and t.holder_name is null
   and o.buyer_name is not null;
