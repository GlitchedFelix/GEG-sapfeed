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
  add column if not exists customer_lat        double precision,
  add column if not exists customer_lon        double precision,
  add column if not exists distance_km         double precision,
  add column if not exists geocode_failed      boolean not null default false,
  add column if not exists distance_failed     boolean not null default false,
  add column if not exists distance_fail_reason text;

-- ---------------------------------------------------------------------
-- 5b. IBT-origin distance correction migration.
--    Webstore deliveries (store name matches "webstore") that carry an
--    IBT From should use that store's coordinates, not the webstore's own
--    (address-less) ones. This sentinel tracks which already-imported rows
--    have had their distance_km retroactively recomputed under that rule —
--    same one-time-correction pattern as geocode_failed/distance_failed.
-- ---------------------------------------------------------------------
alter table deliveries
  add column if not exists ibt_origin_backfilled boolean not null default false;

-- ---------------------------------------------------------------------
-- 6. Rate cards feature migration.
--    Effective-dated payout grids: distance bands (columns) x weight
--    bands (rows) -> a ZAR amount per cell. A delivery's payout uses
--    whichever rate card has the latest effective_date on/before its
--    own delivery_date. Weight bands below 1 ton store a flat payout;
--    "1 Ton+" and IBT bands store a rate per ton, multiplied by the
--    delivery's actual weight in tons. Distances beyond the last band
--    fall back to rate_cards.long_distance_rate_zar_per_km * distance_km.
-- ---------------------------------------------------------------------

create table if not exists rate_cards (
  id                              bigserial primary key,
  effective_date                  date not null unique,
  label                           text,
  long_distance_rate_zar_per_km   numeric not null default 26,
  created_at                      timestamptz not null default now()
);

-- Columns of the grid: distance bands, in left-to-right order.
create table if not exists rate_card_distance_bands (
  id            bigserial primary key,
  rate_card_id  bigint not null references rate_cards(id) on delete cascade,
  position      int not null,
  min_km        numeric not null default 0,
  max_km        numeric -- null = no upper bound
);

-- Rows of the grid: weight bands, in top-to-bottom order.
create table if not exists rate_card_weight_bands (
  id            bigserial primary key,
  rate_card_id  bigint not null references rate_cards(id) on delete cascade,
  position      int not null,
  label         text not null, -- e.g. "0-20 Kgs", "1 Ton+", "IBT per Ton"
  min_kg        numeric not null default 0,
  max_kg        numeric, -- null = no upper bound
  mode          text not null check (mode in ('flat', 'per_ton')),
  is_ibt        boolean not null default false -- matched by delivery IBT flag, not weight
);

-- Cells of the grid: one ZAR amount per (weight band, distance band) pair.
-- Meaning of the amount depends on the weight band's mode:
--   'flat'    -> use amount_zar directly as the payout
--   'per_ton' -> payout = amount_zar * (net_weight_kg / 1000)
create table if not exists rate_card_cells (
  id                bigserial primary key,
  rate_card_id      bigint not null references rate_cards(id) on delete cascade,
  weight_band_id    bigint not null references rate_card_weight_bands(id) on delete cascade,
  distance_band_id  bigint not null references rate_card_distance_bands(id) on delete cascade,
  amount_zar        numeric not null,
  unique (weight_band_id, distance_band_id)
);

create index idx_rate_card_distance_bands_card on rate_card_distance_bands(rate_card_id);
create index idx_rate_card_weight_bands_card on rate_card_weight_bands(rate_card_id);
create index idx_rate_card_cells_card on rate_card_cells(rate_card_id);

alter table rate_cards enable row level security;
alter table rate_card_distance_bands enable row level security;
alter table rate_card_weight_bands enable row level security;
alter table rate_card_cells enable row level security;

create policy "Authenticated users can view rate cards"
  on rate_cards for select to authenticated using (true);
create policy "Authenticated users can insert rate cards"
  on rate_cards for insert to authenticated with check (true);
create policy "Authenticated users can update rate cards"
  on rate_cards for update to authenticated using (true);
create policy "Authenticated users can delete rate cards"
  on rate_cards for delete to authenticated using (true);

create policy "Authenticated users can view rate card distance bands"
  on rate_card_distance_bands for select to authenticated using (true);
create policy "Authenticated users can insert rate card distance bands"
  on rate_card_distance_bands for insert to authenticated with check (true);
create policy "Authenticated users can update rate card distance bands"
  on rate_card_distance_bands for update to authenticated using (true);
create policy "Authenticated users can delete rate card distance bands"
  on rate_card_distance_bands for delete to authenticated using (true);

create policy "Authenticated users can view rate card weight bands"
  on rate_card_weight_bands for select to authenticated using (true);
create policy "Authenticated users can insert rate card weight bands"
  on rate_card_weight_bands for insert to authenticated with check (true);
create policy "Authenticated users can update rate card weight bands"
  on rate_card_weight_bands for update to authenticated using (true);
create policy "Authenticated users can delete rate card weight bands"
  on rate_card_weight_bands for delete to authenticated using (true);

create policy "Authenticated users can view rate card cells"
  on rate_card_cells for select to authenticated using (true);
create policy "Authenticated users can insert rate card cells"
  on rate_card_cells for insert to authenticated with check (true);
create policy "Authenticated users can update rate card cells"
  on rate_card_cells for update to authenticated using (true);
create policy "Authenticated users can delete rate card cells"
  on rate_card_cells for delete to authenticated using (true);

-- ---------------------------------------------------------------------
-- 7. Rate cards: shared band structure.
--    Originally each rate card stored its own copy of distance/weight
--    bands. Per product decision, every rate card must share the same
--    distance and weight ranges — only the payout amount per cell (and
--    the long-distance rate) differs between rate cards. Bands are now
--    global, referenced by rate_card_cells; changing a band's range
--    affects every rate card. No rate card data existed yet at the time
--    of this migration, so the old per-card band tables are dropped
--    outright rather than migrated.
-- ---------------------------------------------------------------------

drop table if exists rate_card_cells;
drop table if exists rate_card_distance_bands;
drop table if exists rate_card_weight_bands;

create table if not exists distance_bands (
  id        bigserial primary key,
  position  int not null unique,
  min_km    numeric not null default 0,
  max_km    numeric -- null = no upper bound
);

create table if not exists weight_bands (
  id        bigserial primary key,
  position  int not null unique,
  label     text not null,
  min_kg    numeric not null default 0,
  max_kg    numeric, -- null = no upper bound
  mode      text not null check (mode in ('flat', 'per_ton')),
  is_ibt    boolean not null default false
);

create table if not exists rate_card_cells (
  id                bigserial primary key,
  rate_card_id      bigint not null references rate_cards(id) on delete cascade,
  weight_band_id    bigint not null references weight_bands(id) on delete cascade,
  distance_band_id  bigint not null references distance_bands(id) on delete cascade,
  amount_zar        numeric not null,
  unique (rate_card_id, weight_band_id, distance_band_id)
);

create index idx_rate_card_cells_card on rate_card_cells(rate_card_id);

alter table distance_bands enable row level security;
alter table weight_bands enable row level security;
alter table rate_card_cells enable row level security;

create policy "Authenticated users can view distance bands"
  on distance_bands for select to authenticated using (true);
create policy "Authenticated users can insert distance bands"
  on distance_bands for insert to authenticated with check (true);
create policy "Authenticated users can update distance bands"
  on distance_bands for update to authenticated using (true);
create policy "Authenticated users can delete distance bands"
  on distance_bands for delete to authenticated using (true);

create policy "Authenticated users can view weight bands"
  on weight_bands for select to authenticated using (true);
create policy "Authenticated users can insert weight bands"
  on weight_bands for insert to authenticated with check (true);
create policy "Authenticated users can update weight bands"
  on weight_bands for update to authenticated using (true);
create policy "Authenticated users can delete weight bands"
  on weight_bands for delete to authenticated using (true);

create policy "Authenticated users can view rate card cells"
  on rate_card_cells for select to authenticated using (true);
create policy "Authenticated users can insert rate card cells"
  on rate_card_cells for insert to authenticated with check (true);
create policy "Authenticated users can update rate card cells"
  on rate_card_cells for update to authenticated using (true);
create policy "Authenticated users can delete rate card cells"
  on rate_card_cells for delete to authenticated using (true);

-- Seed the standard grid structure (12 distance bands x 9 weight bands)
-- matching the reference rate card. Payout amounts are entered per rate
-- card via the Settings UI, not seeded here.
insert into distance_bands (position, min_km, max_km) values
  (0, 0, 6), (1, 6, 11), (2, 11, 21), (3, 21, 31), (4, 31, 41), (5, 41, 51),
  (6, 51, 61), (7, 61, 71), (8, 71, 81), (9, 81, 101), (10, 101, 121), (11, 121, 151);

insert into weight_bands (position, label, min_kg, max_kg, mode, is_ibt) values
  (0, '0-20 Kgs', 0, 21, 'flat', false),
  (1, '21-40 Kgs', 21, 41, 'flat', false),
  (2, '41-100 Kgs', 41, 101, 'flat', false),
  (3, '101-400 Kgs', 101, 401, 'flat', false),
  (4, '401-600 Kgs', 401, 601, 'flat', false),
  (5, '601-800 Kgs', 601, 801, 'flat', false),
  (6, '801-999 Kgs', 801, 1000, 'flat', false),
  (7, '1 Ton+', 1000, null, 'per_ton', false),
  (8, 'IBT per Ton', 0, null, 'per_ton', true);

-- ---------------------------------------------------------------------
-- 8. Rate card systems: Italtile Stores and Italtile Webstore.
--    CTM's rate card was the only system and its bands/cards were global.
--    Italtile turns out to have its own rate structure, and in fact two
--    separate ones (physical stores vs the webstore), each shaped
--    differently from CTM's and from each other. Bands and rate cards
--    are now scoped per "system" so each can have its own grid; existing
--    rows backfill to 'CTM' via the column default, so CTM is unaffected.
--    A new weight-band mode, 'over_1000_surcharge', holds the Italtile
--    per-kg-over-1-ton rate — unlike CTM's 'per_ton' (which multiplies
--    the whole weight by a per-ton rate), Italtile charges a flat base
--    (the top flat band's amount) plus this surcharge times only the
--    kg above 1000. That formula lives in application code, not SQL.
-- ---------------------------------------------------------------------

alter table distance_bands
  add column if not exists system text not null default 'CTM'
    check (system in ('CTM', 'ITALTILE_STORE', 'ITALTILE_WEBSTORE'));

alter table weight_bands
  add column if not exists system text not null default 'CTM'
    check (system in ('CTM', 'ITALTILE_STORE', 'ITALTILE_WEBSTORE'));

alter table rate_cards
  add column if not exists system text not null default 'CTM'
    check (system in ('CTM', 'ITALTILE_STORE', 'ITALTILE_WEBSTORE'));

-- Bands/cards were previously unique globally by position/effective_date;
-- now they must only be unique within their own system.
alter table distance_bands drop constraint if exists distance_bands_position_key;
alter table distance_bands add constraint distance_bands_system_position_key unique (system, position);

alter table weight_bands drop constraint if exists weight_bands_position_key;
alter table weight_bands add constraint weight_bands_system_position_key unique (system, position);

alter table rate_cards drop constraint if exists rate_cards_effective_date_key;
alter table rate_cards add constraint rate_cards_system_effective_date_key unique (system, effective_date);

alter table weight_bands drop constraint if exists weight_bands_mode_check;
alter table weight_bands add constraint weight_bands_mode_check
  check (mode in ('flat', 'per_ton', 'over_1000_surcharge'));

-- Italtile Stores: distance bands 0-150km (151+ is a custom quote, left
-- unbanded so it has no matching cell). Weight bands match the store
-- rate card template's columns (0-80 / 81-300 / 300-1000 flat, then the
-- "rate per kg more than 1 ton" surcharge).
insert into distance_bands (system, position, min_km, max_km) values
  ('ITALTILE_STORE', 0, 0, 31), ('ITALTILE_STORE', 1, 31, 61),
  ('ITALTILE_STORE', 2, 61, 101), ('ITALTILE_STORE', 3, 101, 151);

insert into weight_bands (system, position, label, min_kg, max_kg, mode, is_ibt) values
  ('ITALTILE_STORE', 0, '0-80 Kg', 0, 81, 'flat', false),
  ('ITALTILE_STORE', 1, '81-300 Kg', 81, 301, 'flat', false),
  ('ITALTILE_STORE', 2, '300-1000 Kg', 301, 1000, 'flat', false),
  ('ITALTILE_STORE', 3, 'Over 1000 Kg (R/kg)', 1000, null, 'over_1000_surcharge', false);

-- Italtile Webstore: same 4 distance bands as Stores (they share the same
-- distance/rate structure once weight crosses 250kg). Weight bands are
-- the webstore template's granular tiers under 250kg (priced the same
-- regardless of distance — the upload parser fans each tier's single
-- rate across all 4 distance-band cells), then 251-1000kg (which does
-- vary by distance), then the over-1-ton surcharge.
insert into distance_bands (system, position, min_km, max_km) values
  ('ITALTILE_WEBSTORE', 0, 0, 31), ('ITALTILE_WEBSTORE', 1, 31, 61),
  ('ITALTILE_WEBSTORE', 2, 61, 101), ('ITALTILE_WEBSTORE', 3, 101, 151);

insert into weight_bands (system, position, label, min_kg, max_kg, mode, is_ibt) values
  ('ITALTILE_WEBSTORE', 0, '0.11-4.99 Kg', 0.11, 5, 'flat', false),
  ('ITALTILE_WEBSTORE', 1, '5-19.99 Kg', 5, 20, 'flat', false),
  ('ITALTILE_WEBSTORE', 2, '20-29.99 Kg', 20, 30, 'flat', false),
  ('ITALTILE_WEBSTORE', 3, '30-39.99 Kg', 30, 40, 'flat', false),
  ('ITALTILE_WEBSTORE', 4, '40-49.99 Kg', 40, 50, 'flat', false),
  ('ITALTILE_WEBSTORE', 5, '50-59.99 Kg', 50, 60, 'flat', false),
  ('ITALTILE_WEBSTORE', 6, '60-69.99 Kg', 60, 70, 'flat', false),
  ('ITALTILE_WEBSTORE', 7, '70-79.99 Kg', 70, 80, 'flat', false),
  ('ITALTILE_WEBSTORE', 8, '80-89.99 Kg', 80, 90, 'flat', false),
  ('ITALTILE_WEBSTORE', 9, '90-99.99 Kg', 90, 100, 'flat', false),
  ('ITALTILE_WEBSTORE', 10, '100-250 Kg', 100, 250, 'flat', false),
  ('ITALTILE_WEBSTORE', 11, '251-1000 Kg', 251, 1000, 'flat', false),
  ('ITALTILE_WEBSTORE', 12, 'Over 1000 Kg (R/kg)', 1000, null, 'over_1000_surcharge', false);

-- ---------------------------------------------------------------------
-- 9. One-time data fix: reset "twin" city/country coordinate reuse.
--    backfill-distances used to skip geocoding a delivery if another row
--    in the same city+country already had customer_lat/customer_lon, and
--    just copied those coordinates instead. That collapsed every customer
--    in a city onto one point, corrupting distance_km for any row that
--    wasn't the first one geocoded in its city. The app code no longer
--    does this — every row is now geocoded from its own street address —
--    but rows that already got a copied coordinate need to be reset so
--    the backfill job re-geocodes them individually.
-- ---------------------------------------------------------------------

-- Run this first and review the row count: it lists delivery rows that
-- share an identical (city, country, customer_lat, customer_lon) with at
-- least one other row. Two independently geocoded street addresses
-- landing on bit-identical lat/lon is effectively impossible, so a group
-- like this is the signature of the old twin-reuse shortcut.
select city, country, customer_lat, customer_lon, count(*) as row_count
from deliveries
where city is not null and country is not null
  and customer_lat is not null and customer_lon is not null
group by city, country, customer_lat, customer_lon
having count(*) > 1
order by row_count desc;

-- After reviewing the above, run this to reset every row in an affected
-- group (not just the "copies" — there's no reliable way to tell which
-- row in a group was the original vs. a copy, and re-geocoding a row
-- that was already correct just costs one harmless extra Nominatim
-- call). Resetting geocode_failed/distance_failed back to false is
-- required, otherwise these rows would be silently excluded from the
-- backfill job's candidate queries and never reprocessed.
with twin_groups as (
  select city, country, customer_lat, customer_lon
  from deliveries
  where city is not null and country is not null
    and customer_lat is not null and customer_lon is not null
  group by city, country, customer_lat, customer_lon
  having count(*) > 1
)
update deliveries d
set customer_lat = null,
    customer_lon = null,
    distance_km = null,
    geocode_failed = false,
    distance_failed = false,
    distance_fail_reason = null
from twin_groups g
where d.city = g.city
  and d.country = g.country
  and d.customer_lat = g.customer_lat
  and d.customer_lon = g.customer_lon;

-- Then click "Backfill distances" in the Distances tab to re-geocode
-- the reset rows individually through the fixed code path.

-- ---------------------------------------------------------------------
-- 10. One-time data fix: un-stick rows wrongly marked geocode_failed.
--    geocodeStructuredAddress's country sanity check compared the raw
--    SAP country value (often a short code like "ZA") against Nominatim's
--    full country name ("South Africa") and rejected almost every match,
--    so an early backfill run marked most pending rows geocode_failed
--    with zero successful geocodes. The check now also matches against
--    Nominatim's ISO country code, but rows already marked failed by the
--    bug need their flag cleared to be retried under the fixed code.
--    Safe to run even if some of these were genuine failures — they'll
--    just be marked failed again.
-- ---------------------------------------------------------------------

update deliveries
set geocode_failed = false
where geocode_failed = true and customer_lat is null;

-- ---------------------------------------------------------------------
-- 11. Manual distance entry.
--    The Distances/Failed tabs let a user type a distance_km value in
--    directly (to fix a wrong auto-computed value, or to resolve a
--    permanently failed geocode/route). This flag marks those rows so the
--    UI can show a "Manual" badge distinguishing them from geocoded ones.
--    Saving a manual value also clears geocode_failed/distance_failed/
--    distance_fail_reason, since the row now has a known distance and is
--    no longer "failed" — this is what moves it off the Failed tab.
-- ---------------------------------------------------------------------
alter table deliveries
  add column if not exists distance_manual boolean not null default false;
