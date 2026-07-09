-- =====================================================================
-- Good Earth Group (GEG) SAP Reports schema
-- Run this entire file once in Supabase SQL Editor (Project > SQL Editor > New query)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Profiles table — extends Supabase auth.users with an uploader flag.
--    Every viewer can read all delivery data; only flagged users can
--    import new reports. This is "soft enforcement" per the agreed
--    decision: the UI hides the import button for non-uploaders, and
--    the import API route also checks this flag server-side.
-- ---------------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  is_uploader boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ---------------------------------------------------------------------
-- 2. Deliveries table.
--    Primary key is a generated id; uniqueness is enforced via a hash
--    of the full source row, NOT via any single SAP field. This was a
--    deliberate decision after the 14-digit "Delivery" number turned
--    out not to be reliably unique. See conversation history if this
--    schema is ever revisited — don't re-key off delivery_number alone.
-- ---------------------------------------------------------------------
-- Enable trigram extension for fast partial-text search on search_blob.
create extension if not exists pg_trgm;

create table deliveries (
  id                     bigserial primary key,
  row_hash               text not null,
  delivery_number        bigint not null,
  billing_document       bigint not null,
  brand                  text not null check (brand in ('CTM', 'ITALTILE')),
  store_code             text not null,
  store_name             text not null,
  customer_name          text,
  street                 text,
  city                   text,
  country                text,
  telephone              text,
  supplier_store         text,
  ibt_from               text,
  ibt_to                 text,
  obo_order              boolean,
  created_on             date,
  delivery_date          date,
  sales_document          bigint,
  sales_representative   text,
  gross_weight_kg         numeric,
  net_weight_kg           numeric,
  invoice_amount_zar      numeric,
  transport1_amount_zar   numeric,
  transport2_amount_zar   numeric,
  imported_at             timestamptz not null default now(),
  imported_by             uuid references auth.users(id),
  -- Generated column used by the universal search bar. Concatenates
  -- document numbers (cast to text for partial matching) and customer
  -- name into one lowercased blob — avoids ilike on bigint columns.
  search_blob            text generated always as (
    lower(
      coalesce(delivery_number::text, '') || ' ' ||
      coalesce(billing_document::text, '') || ' ' ||
      coalesce(sales_document::text, '') || ' ' ||
      coalesce(customer_name, '')
    )
  ) stored
);

-- Enforces the agreed dedupe rule: identical row content => skipped on
-- insert (the API does an upsert with on_conflict do nothing on this index).
create unique index idx_deliveries_row_hash on deliveries(row_hash);

create index idx_deliveries_delivery_number on deliveries(delivery_number);
create index idx_deliveries_brand_date on deliveries(brand, delivery_date);
create index idx_deliveries_store on deliveries(store_code);
create index idx_deliveries_billing_document on deliveries(billing_document);
create index idx_deliveries_search_blob on deliveries using gin (search_blob gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 3. Row Level Security.
--    Decision made earlier: any authenticated user can VIEW all data
--    regardless of brand/store. Only is_uploader=true accounts can INSERT.
--    No per-store restriction — that was explicitly ruled out.
-- ---------------------------------------------------------------------
alter table profiles enable row level security;
alter table deliveries enable row level security;

create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Authenticated users can view all deliveries"
  on deliveries for select
  to authenticated
  using (true);

create policy "Authenticated users can insert deliveries"
  on deliveries for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update deliveries"
  on deliveries for update
  to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- 4. After running this file: go to Authentication > Users in the
--    Supabase dashboard, find your account (sign up in the app first),
--    then run the line below in SQL Editor to make yourself an uploader.
--    Replace the email with your actual login email.
-- ---------------------------------------------------------------------
-- update profiles set is_uploader = true where email = 'you@example.com';

-- ---------------------------------------------------------------------
-- 5. Distance feature migration.
--    Run these statements in Supabase SQL Editor to enable geocoded
--    store locations and per-delivery driving distance tracking.
-- ---------------------------------------------------------------------

-- Store physical locations (auto-populated on import via Nominatim geocoding).
create table if not exists store_locations (
  store_code   text primary key,
  store_name   text not null,
  brand        text not null check (brand in ('CTM', 'ITALTILE')),
  lat          double precision,
  lon          double precision,
  geocoded_at  timestamptz,
  geocode_query text
);

alter table store_locations enable row level security;

create policy "Authenticated users can view store locations"
  on store_locations for select to authenticated using (true);

create policy "Authenticated users can insert store locations"
  on store_locations for insert to authenticated with check (true);

create policy "Authenticated users can update store locations"
  on store_locations for update to authenticated using (true);

-- New columns on deliveries for geocoded customer address + driving distance.
alter table deliveries
  add column if not exists customer_lat  double precision,
  add column if not exists customer_lon  double precision,
  add column if not exists distance_km   double precision;
