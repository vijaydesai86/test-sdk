create table if not exists public.watchlists (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null unique,
  is_default  boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.watchlist_items (
  id             uuid        primary key default gen_random_uuid(),
  watchlist_id   uuid        not null references public.watchlists(id) on delete cascade,
  symbol         text        not null,
  company_name   text        not null,
  display_order  integer     not null default 0,
  created_at     timestamptz not null default now()
);

create unique index if not exists watchlists_single_default_idx
  on public.watchlists (is_default)
  where is_default = true;

create unique index if not exists watchlist_items_watchlist_symbol_idx
  on public.watchlist_items (watchlist_id, symbol);

create index if not exists watchlist_items_watchlist_order_idx
  on public.watchlist_items (watchlist_id, display_order, created_at);

alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;

create policy "service role full access watchlists"
  on public.watchlists
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

create policy "service role full access watchlist_items"
  on public.watchlist_items
  as permissive
  for all
  to service_role
  using (true)
  with check (true);
