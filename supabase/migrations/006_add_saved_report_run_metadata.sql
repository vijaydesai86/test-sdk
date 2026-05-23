alter table public.saved_reports
  add column if not exists run_metadata jsonb;

create index if not exists saved_reports_run_metadata_kind_idx
  on public.saved_reports ((run_metadata->>'kind'));
