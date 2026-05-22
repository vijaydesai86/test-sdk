-- Historical seed adjustment. This is intentionally idempotent: symbols that are
-- not present in the current default watchlist are ignored by the WHERE clause.
update public.watchlist_items
set ownership_status = 'owned'
from public.watchlists
where public.watchlist_items.watchlist_id = public.watchlists.id
  and public.watchlists.slug = 'default'
  and public.watchlist_items.symbol in ('NVDA', 'ARM', 'AVGO', 'META');
