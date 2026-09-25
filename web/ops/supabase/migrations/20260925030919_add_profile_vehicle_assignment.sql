-- An OPS profile owns its display callsign and assigned Chase vehicle. These are
-- administrator-managed fields: clients remain read-only under the existing RLS policy.
alter table public.profiles
  add column operator_name text,
  add column vehicle_id text;

alter table public.profiles
  add constraint profiles_operator_name_format
    check (operator_name is null or operator_name ~ '^[A-Za-z0-9 .''-]{1,24}$'),
  add constraint profiles_vehicle_id_format
    check (vehicle_id is null or vehicle_id ~ '^[a-z0-9][a-z0-9-]{0,62}$');

-- Seed only known authenticated operator accounts. Other active profiles deliberately
-- remain unassigned until an administrator assigns a vehicle; Chase then retains Core's
-- vehicle label rather than presenting a false assignment.
update public.profiles
set operator_name = 'Nick', vehicle_id = 'tessa'
where lower(email) in (
  'nick@cbwx.com',
  'nick@codeblackwx.com',
  'nicholasmounce@gmail.com',
  'nickmounce@ymail.com'
);

update public.profiles
set operator_name = 'Spencer', vehicle_id = 'striker'
where lower(email) in ('spencer@cbwx.com', 'spencer@codeblackwx.com');
