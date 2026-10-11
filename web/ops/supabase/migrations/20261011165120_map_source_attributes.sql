alter table public.map_sources add column attributes jsonb not null default '{}'::jsonb
  check (jsonb_typeof(attributes) = 'object');
