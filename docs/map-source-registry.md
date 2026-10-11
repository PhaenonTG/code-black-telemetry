# OPS map source registry

The authenticated **Map Sources** page inventories sources the OPS map has encountered. It is not a nationwide scrape. A camera or surface station is discovered when its layer fetches a viewport; OSM gas, food, hospital, and lodging points are discovered from the nearby provider; landmarks may be added manually. Provider IDs are stable, so a later fetch refreshes `last_seen_at` and live attributes without overwriting operator-corrected names or coordinates.

Supabase tables:

- `public.map_sources`: kind, provider ID and record ID, name, city/state, latitude/longitude, address/road, source URL, first/last seen, and provider-specific JSON attributes.
- `public.map_source_reviews`: append-only findings, status (`visible`, `hidden`, `needs_review`), reviewer identity/time, and optional next-review date.
- `public.map_source_current_reviews`: newest review per source, with `security_invoker = true`.

The browser uses the Supabase publishable key and the existing active OPS profile gate. RLS requires an active `public.profiles` row for reads and writes; review identity is set by Auth/Postgres, not a form field. The batch-ingest RPC uses invoker privileges and updates only provider attributes and last-seen time on conflict. No service-role secret is exposed to the browser.

Pin order of precedence: an unknown review status does not draw a source in the OPS map until checked; `hidden` or `needs_review` suppresses its dot; `visible` permits it. Layer switches, curated nearby-place rules, and live camera availability still apply. The four Oct 11 static camera suppressions remain as a fallback until reviewed; an explicit `visible` review supersedes only that static list, not a genuinely offline feed. Native Atlas maps without the OPS registry preserve their prior behavior.

Schema migration files are in `web/ops/supabase/migrations/20261011*_map_source_*.sql`. They were applied to the connected `codeblack-ops` Supabase project on Oct 11, 2026. The app code is still in the local feature checkout and needs a deliberate integration/deployment path before the new page appears on the live OPS site. Do not deploy the whole checkout without reviewing the pre-existing uncommitted camera changes and unrelated branch history.

Operator workflow: open **More → Map Sources** on phone, or **Map Sources** in the desktop System sidebar; search/filter, inspect source and coordinates, enter findings, select Allow/Hold/Hide, and optionally set the next review date. The history is retained. Edit Location corrects provider metadata without changing review history. Use `+ Landmark` for a named manual point.

The design drew on the open-surveillance-db pattern of stable point records with provenance and a review timeline, without copying its code or camera feeds. OSM POIs remain sourced through the existing Overpass integration; city/state come from OSM address tags when present and can be corrected in OPS.
