-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bnhnlyiuwlebgmjerueb/sql/new
--
-- Creates the table that the /api/saved-reports endpoints read from and write to.

create table if not exists public.saved_reports (
  id          uuid        primary key default gen_random_uuid(),
  filename    text        not null,
  title       text,
  content     text        not null,
  created_at  timestamptz not null default now()
);

-- Optional: index on created_at for fast descending list queries
create index if not exists saved_reports_created_at_idx
  on public.saved_reports (created_at desc);

-- Row-Level Security: allow the service role full access
-- (the service role key bypasses RLS by default, but it's good practice to be explicit)
alter table public.saved_reports enable row level security;

-- Allow service role to do everything (server-side API routes use this key)
create policy "service role full access"
  on public.saved_reports
  as permissive
  for all
  to service_role
  using (true)
  with check (true);
