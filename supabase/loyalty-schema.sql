-- Madinah Market — Loyalty points schema (run once in Supabase SQL Editor).
-- Confirmed spec (Sami, 2026-11-16): loyalty is ONLY for signed-in
-- customers (email or Google). 1 point per $1 paid on PAID orders.
-- 100 points = $5.00 off, redeemed in 100-point blocks at checkout.
-- Safe to re-run: every statement is idempotent.

-- Ledger: every points movement is one row. Balance = sum(delta).
create table if not exists public.points_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  order_id bigint references public.orders (id) on delete set null,
  delta integer not null, -- +earn / +refund, -redeem / -reversal
  reason text not null check (reason in ('earn', 'redeem', 'refund', 'reversal')),
  created_at timestamptz not null default now()
);

create index if not exists points_ledger_user_idx
  on public.points_ledger (user_id, created_at desc);

-- Idempotency: at most one earn / redeem / refund / reversal per order.
create unique index if not exists points_ledger_order_reason_uidx
  on public.points_ledger (order_id, reason)
  where order_id is not null;

-- RLS on, no public policies: only the server (service-role key) reads or
-- writes points. Customers can never touch their own balance directly.
alter table public.points_ledger enable row level security;

-- Remember what each order used, so a cancellation can refund it exactly.
alter table public.orders
  add column if not exists discount_cents integer not null default 0;
alter table public.orders
  add column if not exists points_redeemed integer not null default 0;
