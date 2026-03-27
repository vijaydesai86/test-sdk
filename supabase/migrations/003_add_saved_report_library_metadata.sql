alter table public.saved_reports
  add column if not exists summary text,
  add column if not exists storage_path text,
  add column if not exists report_kind text,
  add column if not exists report_date date;

create index if not exists saved_reports_report_date_idx
  on public.saved_reports (report_date desc, created_at desc);
