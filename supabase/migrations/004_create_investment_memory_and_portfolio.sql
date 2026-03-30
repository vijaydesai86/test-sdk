alter table public.watchlists
  add column if not exists risk_tolerance text default 'medium',
  add column if not exists holding_horizon text default 'years',
  add column if not exists max_position_weight numeric,
  add column if not exists target_cash_pct numeric,
  add column if not exists concentration_limit numeric,
  add column if not exists strategy_notes text default '';

alter table public.watchlist_items
  add column if not exists ownership_status text default 'watching',
  add column if not exists current_weight numeric,
  add column if not exists target_weight numeric,
  add column if not exists max_weight numeric,
  add column if not exists cost_basis numeric,
  add column if not exists conviction text default 'medium',
  add column if not exists thesis text default '',
  add column if not exists desired_entry_min numeric,
  add column if not exists desired_entry_max numeric,
  add column if not exists trim_above numeric,
  add column if not exists invalidation text default '',
  add column if not exists review_date date,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists notes text default '';

create table if not exists public.research_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research_messages (
  id text primary key,
  session_id uuid not null references public.research_sessions(id) on delete cascade,
  role text not null,
  content text,
  created_at timestamptz not null default now()
);

create table if not exists public.company_theses (
  symbol text primary key,
  thesis text not null default '',
  conviction text not null default 'medium',
  invalidation text not null default '',
  last_action text not null default 'Wait',
  summary text,
  updated_at timestamptz not null default now()
);

create table if not exists public.decision_journal (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.research_sessions(id) on delete set null,
  symbol text,
  action text not null,
  confidence text not null,
  summary text not null,
  score numeric,
  price numeric,
  created_at timestamptz not null default now()
);

create index if not exists research_messages_session_created_idx
  on public.research_messages (session_id, created_at);

create index if not exists decision_journal_symbol_created_idx
  on public.decision_journal (symbol, created_at desc);

alter table public.research_sessions enable row level security;
alter table public.research_messages enable row level security;
alter table public.company_theses enable row level security;
alter table public.decision_journal enable row level security;

create policy "service role full access research_sessions"
  on public.research_sessions
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role full access research_messages"
  on public.research_messages
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role full access company_theses"
  on public.company_theses
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role full access decision_journal"
  on public.decision_journal
  as permissive
  for all
  to service_role
  using (true)
  with check (true);
