-- ============================================================================
-- Madinah Market — Supabase database schema
-- Run this ONCE in your Supabase project: SQL Editor -> New query -> paste
-- this whole file -> Run.
-- ============================================================================

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  customer_name text,
  customer_phone text,
  items_json jsonb not null,
  subtotal_cents int not null,
  tax_cents int not null,
  delivery_fee_cents int not null default 0,
  tip_cents int not null default 0,
  total_cents int not null,
  fulfillment text not null default 'pickup'
    check (fulfillment in ('pickup', 'delivery')),
  delivery_address text,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'test_paid')),
  kitchen_status text not null default 'new'
    check (kitchen_status in ('new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled')),
  stripe_session_id text,
  shipday_order_id text,
  shipday_status text,
  created_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_stripe_session_idx on public.orders (stripe_session_id);
create index if not exists orders_shipday_id_idx on public.orders (shipday_order_id);

-- ----------------------------------------------------------------------------
-- Row Level Security: the orders table is CLOSED to the public.
-- * Anonymous visitors get NO direct access at all. Public pages read data
--   only through the website's server API routes (which use the secret
--   service-role key after their own checks: phone match for tracking,
--   numbers-only for the TV board).
-- * Logged-in staff (Supabase Auth users) may READ orders so the kitchen
--   screen's realtime feed can wake up instantly. All writes still go
--   through the session-checked server routes.
-- * The service role bypasses RLS (server only — never expose that key).
-- ----------------------------------------------------------------------------
alter table public.orders enable row level security;

drop policy if exists "staff can read orders" on public.orders;
create policy "staff can read orders"
  on public.orders
  for select
  to authenticated
  using (true);

-- Realtime: let the kitchen screen subscribe to order changes.
-- (Safe to re-run; ignore the notice if the table is already in the publication.)
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
