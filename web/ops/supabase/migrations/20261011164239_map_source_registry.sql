-- Provider inventory and immutable operator decisions for OPS map points.
-- This is an encountered-source registry: provider fetches discover records as their
-- viewports are opened. It is not a claim to contain every OSM/DOT point nationwide.
create table public.map_sources (
  id text primary key check (length(id) between 3 and 240),
  kind text not null check (kind in ('camera', 'surface_station', 'gas', 'lodging', 'hospital', 'food', 'landmark')),
  provider_id text not null,
  provider_record_id text not null,
  name text not null,
  city text,
  state text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  address text,
  source_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index map_sources_kind_seen_idx on public.map_sources (kind, last_seen_at desc);
create index map_sources_state_city_idx on public.map_sources (state, city);
alter table public.map_sources enable row level security;

-- Review history is append-only. Reviewer identity and timestamp are supplied by
-- Auth/Postgres, not by browser form fields. The newest review governs pin status.
create table public.map_source_reviews (
  id bigint generated always as identity primary key,
  source_id text not null references public.map_sources(id) on delete restrict,
  status text not null check (status in ('visible', 'hidden', 'needs_review')),
  findings text not null check (length(findings) between 3 and 4000),
  reviewer_id uuid not null default auth.uid() references auth.users(id),
  reviewer_email text not null default coalesce(auth.jwt()->>'email', 'operator'),
  reviewed_at timestamptz not null default now(),
  next_review_at timestamptz
);
create index map_source_reviews_latest_idx on public.map_source_reviews (source_id, reviewed_at desc, id desc);
alter table public.map_source_reviews enable row level security;

-- Existing OPS authorization is public.profiles: a Supabase login by itself is
-- insufficient. No anonymous role receives table privileges or policies.
create policy map_sources_read on public.map_sources for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active));
create policy map_sources_insert on public.map_sources for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active));
create policy map_sources_update on public.map_sources for update to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active))
  with check (exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active));
create policy map_source_reviews_read on public.map_source_reviews for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active));
create policy map_source_reviews_insert on public.map_source_reviews for insert to authenticated
  with check (reviewer_id = (select auth.uid()) and exists
    (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active));

-- Explicit grants also cover Supabase projects with automatic Data API exposure off.
grant select, insert, update on public.map_sources to authenticated;
grant select on public.map_source_reviews to authenticated;
grant insert (source_id, status, findings, next_review_at) on public.map_source_reviews to authenticated;
grant usage, select on sequence public.map_source_reviews_id_seq to authenticated;

create view public.map_source_current_reviews with (security_invoker = true) as
  select distinct on (source_id) source_id, id, status, findings, reviewer_id,
    reviewer_email, reviewed_at, next_review_at
  from public.map_source_reviews
  order by source_id, reviewed_at desc, id desc;
grant select on public.map_source_current_reviews to authenticated;
