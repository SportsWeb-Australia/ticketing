-- =====================================================================
-- SportsWeb One — Ticketing — PATCH: event promo image (hero/banner).
-- The sales page already renders tk_events.cover_image_url as a hero
-- above everything; this just adds the column so the editor can set it.
-- Run once. Idempotent.
-- =====================================================================
alter table tk_events add column if not exists cover_image_url text;
