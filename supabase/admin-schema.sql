-- Madinah Market — Admin panel schema (run once in Supabase SQL Editor).
-- Confirmed spec (Sami, 2026-11-16): admin can switch ordering / pickup /
-- delivery on & off, mark dishes available / sold out, and manage the
-- promotions shown on the homepage. Also adds scheduled pickup times.
-- Safe to re-run: every statement is idempotent.

-- Key/value site settings (ordering_enabled, pickup_enabled,
-- delivery_enabled). Missing rows mean "on" (the defaults).
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.site_settings (key, value) values
  ('ordering_enabled', 'true'),
  ('pickup_enabled', 'true'),
  ('delivery_enabled', 'true')
on conflict (key) do nothing;

-- Per-dish availability. No row = available; a row with available=false
-- means sold out. item_id matches lib/menu.ts ids.
create table if not exists public.dish_availability (
  item_id text primary key,
  available boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Homepage promotions, managed from /admin.
create table if not exists public.promotions (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null default '',
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- Scheduled pickup ("pickup for later"); null = as soon as possible.
alter table public.orders
  add column if not exists scheduled_for timestamptz;

-- RLS on, no public policies: only the server (service-role key) reads or
-- writes these tables. The public storefront gets its state through
-- /api/admin (GET), and only staff tokens can change anything.
alter table public.site_settings enable row level security;
alter table public.dish_availability enable row level security;
alter table public.promotions enable row level security;

-- Dish photos uploaded by the admin (Supabase Storage, public bucket).
-- dish_photos maps a menu item to its current photo URL; items without a
-- row keep their built-in /images/<id>.jpg.
insert into storage.buckets (id, name, public)
values ('dish-photos', 'dish-photos', true)
on conflict (id) do nothing;

create table if not exists public.dish_photos (
  item_id text primary key,
  url text not null,
  updated_at timestamptz not null default now()
);
alter table public.dish_photos enable row level security;

-- Database menu: categories and items the admin can extend from /admin.
-- Seeded below with the current menu; lib/menu.ts remains the fallback
-- whenever these tables are empty or unreachable.
create table if not exists public.menu_categories (
  name text primary key,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.menu_items (
  id text primary key,
  name text not null,
  description text not null default '',
  price_cents integer not null,
  category text not null,
  number text,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;

-- Seed: the current 36 items in 6 categories (no-ops if already seeded).
insert into public.menu_categories (name, sort) values ('Platters', 0) on conflict (name) do nothing;
insert into public.menu_categories (name, sort) values ('Sandwiches', 1) on conflict (name) do nothing;
insert into public.menu_categories (name, sort) values ('Hot Bread Hot Steak', 2) on conflict (name) do nothing;
insert into public.menu_categories (name, sort) values ('Side Orders', 3) on conflict (name) do nothing;
insert into public.menu_categories (name, sort) values ('Kabobs Only', 4) on conflict (name) do nothing;
insert into public.menu_categories (name, sort) values ('Drinks', 5) on conflict (name) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('combo-platter', 'Combo Platter', 'Chicken and gyros over rice with salad and sauce.', 1175, 'Platters', '#5', 0) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('chicken-shawarma-rice', 'Chicken Shawarma over Rice', 'Marinated chicken shawarma served over rice.', 1175, 'Platters', '#6', 1) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('lamb-gyro-rice', 'Lamb Gyro over Rice', 'Seasoned lamb gyro slices over rice.', 1175, 'Platters', '#7', 2) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('chicken-biryani', 'Chicken Biryani', 'Fragrant spiced rice with chicken.', 1175, 'Platters', '#8', 3) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('kobideh-kabob', 'Kobideh Kabob', 'Two skewers of seasoned ground beef kabob over rice.', 1175, 'Platters', '#9', 4) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('chicken-nuggets-fries', 'Chicken Nuggets with French Fries', '7 pieces of chicken nuggets with french fries.', 899, 'Platters', '#10', 5) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('chicken-tikka-kabob', 'Chicken Tikka Kabob', 'Grilled marinated chicken tikka over rice.', 1175, 'Platters', '#11', 6) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('lamb-shank', 'Lamb Shank over Rice', 'Slow-cooked tender lamb shank over rice.', 1375, 'Platters', '#12', 7) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('sultani-kabob', 'Sultani Kabob', 'One skewer kobideh and one skewer chicken kabob over rice.', 1375, 'Platters', '#13', 8) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('falafel-platter', 'Falafel Platter', 'Falafel over rice with salad and tahini.', 1175, 'Platters', '#14', 9) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('fry-fish-rice', 'Fry Fish over Rice', 'Crispy fried fish served over rice.', 1175, 'Platters', '#15', 10) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('chicken-wings-fries', 'Chicken Wings with Fries', 'Chicken wings served with french fries.', 899, 'Platters', '#16', 11) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('gyros-sandwich', 'Gyros Sandwich', 'Lamb gyros wrapped in warm pita with vegetables and sauce.', 899, 'Sandwiches', '#1', 12) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('chicken-shawarma-sandwich', 'Chicken Shawarma Sandwich', 'Chicken shawarma wrap with pickles and garlic sauce.', 899, 'Sandwiches', '#2', 13) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('falafel-sandwich', 'Falafel Sandwich', 'Falafel wrap with salad and tahini sauce.', 899, 'Sandwiches', '#3', 14) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('beef-burger-fries', 'Beef Burger and Fries', 'Beef burger served with french fries.', 899, 'Sandwiches', '#4', 15) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('kobideh-sandwich', 'Kobideh Kabob Sandwich', 'Ground beef kobideh skewer wrapped in fresh bread.', 999, 'Sandwiches', null, 16) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('chicken-kabob-sandwich', 'Chicken Kabob Sandwich', 'Grilled chicken kabob wrapped in fresh bread.', 999, 'Sandwiches', null, 17) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('hot-steak-kobideh', 'Hot Bread Hot Steak (Kobideh Kabob)', 'Kobideh kabob served sizzling on hot fresh bread.', 1199, 'Hot Bread Hot Steak', null, 18) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('hot-steak-chicken', 'Hot Bread Hot Steak (Chicken Kabob)', 'Chicken kabob served sizzling on hot fresh bread.', 1199, 'Hot Bread Hot Steak', null, 19) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('french-fries', 'French Fries', 'Golden crispy french fries.', 249, 'Side Orders', null, 20) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('falafel-4pcs', '4 pcs Falafel', 'Four pieces of freshly fried falafel.', 329, 'Side Orders', null, 21) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('pita-bread', 'Pita Bread', 'One warm pita bread.', 125, 'Side Orders', null, 22) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('plain-rice-plate', 'Plain Rice Plate', 'A plate of steamed rice.', 499, 'Side Orders', null, 23) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('veggie-samosa-3', '3 pcs Veggie Samosa', 'Three crispy vegetable samosas.', 499, 'Side Orders', null, 24) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('veggie-samosa-10', '10 pcs Veggie Samosa', 'Ten crispy vegetable samosas — good for sharing.', 1499, 'Side Orders', null, 25) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('kobideh-skewer', 'Kobideh Kabob Only', 'One skewer of seasoned ground beef kobideh.', 299, 'Kabobs Only', null, 26) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('chicken-skewer', 'Chicken Kabob Only', 'One skewer of grilled chicken kabob.', 299, 'Kabobs Only', null, 27) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('grilled-tomatoes', 'Grilled Tomatoes', 'Two grilled tomatoes.', 249, 'Kabobs Only', null, 28) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('yogurt-drink', 'Yogurt Drink', 'Chilled yogurt drink (doogh).', 259, 'Drinks', null, 29) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('water-bottle', 'Bottle of Water', 'Bottled drinking water.', 79, 'Drinks', null, 30) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('can-soda', 'Can Soda', 'One can of soda.', 159, 'Drinks', null, 31) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('bottle-soda', 'Bottle of Soda', 'One bottle of soda.', 249, 'Drinks', null, 32) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('ginseng-energy', 'Ginseng Energy Drink', 'Ginseng energy drink.', 199, 'Drinks', null, 33) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('red-bull', 'Red Bull 8oz', 'Red Bull energy drink, 8 oz can.', 299, 'Drinks', null, 34) on conflict (id) do nothing;
insert into public.menu_items (id, name, description, price_cents, category, number, sort) values ('monster', 'Monster Drink', 'Monster energy drink.', 299, 'Drinks', null, 35) on conflict (id) do nothing;

-- Promotions can feature one menu dish (shown with its photo on the
-- homepage promotion box).
alter table public.promotions
  add column if not exists item_id text;
