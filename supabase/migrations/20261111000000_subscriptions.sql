-- اشتراكاتي: جدول واحد، وكل مستخدم يقرأ ويعدل صفوفه هو بس
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  price_fils integer not null check (price_fils > 0 and price_fils <= 99999999),
  cycle text not null check (cycle in ('monthly', 'yearly')),
  next_renewal date not null,
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

-- الزائر بلا تسجيل دخول ما يوصل للجدول أبدًا
revoke all on public.subscriptions from anon;
revoke all on public.subscriptions from authenticated;
grant select, insert, update, delete on public.subscriptions to authenticated;

drop policy if exists "own rows: select" on public.subscriptions;
drop policy if exists "own rows: insert" on public.subscriptions;
drop policy if exists "own rows: update" on public.subscriptions;
drop policy if exists "own rows: delete" on public.subscriptions;

create policy "own rows: select" on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.subscriptions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
