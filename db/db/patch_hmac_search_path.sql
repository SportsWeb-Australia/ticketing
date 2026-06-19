-- =====================================================================
-- SportsWeb One — Ticketing — PATCH: fix "function hmac(text,text,unknown)
-- does not exist" when issuing / scanning tickets.
--
-- Cause: tk_issue_tickets and tk_scan_ticket are SECURITY DEFINER with
--   `set search_path = public`, but pgcrypto's hmac() lives in the
--   `extensions` schema on Supabase, so it isn't on the path at runtime.
--
-- Fix: add `extensions` to each function's search_path. Safe whether
--   pgcrypto is installed in `public` or `extensions` (both are listed).
--
-- Run this once in the Supabase SQL editor. Idempotent — re-running is fine.
-- =====================================================================

-- Make sure pgcrypto is available (no-op if already installed).
create extension if not exists pgcrypto with schema extensions;

alter function tk_issue_tickets(uuid)
    set search_path = public, extensions;

alter function tk_scan_ticket(text, text, text)
    set search_path = public, extensions;
