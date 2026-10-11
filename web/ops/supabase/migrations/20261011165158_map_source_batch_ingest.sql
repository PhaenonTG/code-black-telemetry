-- Batch ingest keeps operator-corrected names/coordinates while refreshing only
-- provider telemetry and last-seen time. Invoker RLS requires an active OPS profile.
create function public.register_map_sources(payload jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) > 100 then
    raise exception 'Expected up to 100 map source records';
  end if;
  insert into public.map_sources
    (id, kind, provider_id, provider_record_id, name, city, state,
     latitude, longitude, address, source_url, attributes)
  select x.id, x.kind, x.provider_id, x.provider_record_id, x.name,
    x.city, x.state, x.latitude, x.longitude, x.address, x.source_url,
    coalesce(x.attributes, '{}'::jsonb)
  from jsonb_to_recordset(payload) as x(
    id text, kind text, provider_id text, provider_record_id text, name text,
    city text, state text, latitude double precision, longitude double precision,
    address text, source_url text, attributes jsonb)
  on conflict (id) do update set
    last_seen_at = now(), attributes = excluded.attributes;
end $$;

revoke all on function public.register_map_sources(jsonb) from public, anon;
grant execute on function public.register_map_sources(jsonb) to authenticated;
