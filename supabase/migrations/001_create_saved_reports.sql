-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/bnhnlyiuwlebgmjerueb/sql/new
--
-- Creates the table that the /api/saved-reports endpoints read from and write to.

create table if not exists public.saved_reports (
  id           uuid        primary key default gen_random_uuid(),
  filename     text        not null,
  title        text,
  summary      text,
  content      text        not null,
  storage_path text,
  report_kind  text,
  report_date  date,
  created_at   timestamptz not null default now()
);

create index if not exists saved_reports_created_at_idx
  on public.saved_reports (created_at desc);

create index if not exists saved_reports_report_date_idx
  on public.saved_reports (report_date desc, created_at desc);

alter table public.saved_reports enable row level security;

create policy "service role full access"
  on public.saved_reports
  as permissive
  for all
  to service_role
  using (true)
  with check (true);
