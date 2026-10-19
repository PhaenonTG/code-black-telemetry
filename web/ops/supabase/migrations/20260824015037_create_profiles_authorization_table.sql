-- Second authorization layer on top of Supabase Auth: a valid Supabase account is not, by
-- itself, authorization to use Code Black OPS. Only a signed-in user with an active row here
-- is treated as authorized (see web/ops/src/auth/AuthProvider.tsx). Rows are managed by an
-- administrator via the Supabase dashboard/SQL editor -- never by the client app.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'OPERATOR' check (role in ('OWNER', 'ADMIN', 'OPERATOR')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A signed-in user may read only their own authorization record. No insert/update/delete
-- policy is defined for authenticated or anon roles: authorization records are managed by
-- an administrator via the Supabase SQL editor/dashboard, never by the client app.
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = user_id);
