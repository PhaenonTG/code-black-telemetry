-- Supabase's project defaults may grant SELECT to PUBLIC/anon even when RLS
-- hides all rows. Remove those grants as defense in depth; active authenticated
-- OPS profiles retain the explicit grants from the initial migration.
revoke all on public.map_sources from public, anon;
revoke all on public.map_source_reviews from public, anon;
revoke all on public.map_source_current_reviews from public, anon;
revoke all on sequence public.map_source_reviews_id_seq from public, anon;
