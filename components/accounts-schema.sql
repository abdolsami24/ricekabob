-- Madinah Market — customer accounts add-on (run ONCE in Supabase SQL Editor)
-- Adds: profiles table (customers + staff roles), orders.user_id link.
-- Safe to re-run: everything is "if not exists" / upsert.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'staff')),
  display_name text,
  phone text,
  default_address text,
  created_at timestamptz not null default now()
);

-- RLS on, no public policies: all access goes through the service-role
-- API routes after they verify the caller's Supabase Auth token.
alter table public.profiles enable row level security;

-- Link orders to the account that placed them (null = guest checkout).
alter table public.orders
  add column if not exists user_id uuid references auth.users(id);
create index if not exists orders_user_id_idx
  on public.orders (user_id, created_at desc);

-- IMPORTANT: every account that exists TODAY (the kitchen login) becomes
-- staff, so the kitchen board keeps working. Accounts created after this
-- (customers signing up on the website) default to 'customer' and can
-- never open the kitchen.
insert into public.profiles (id, role)
  select id, 'staff' from auth.users
  on conflict (id) do update set role = 'staff';
