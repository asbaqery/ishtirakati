-- ضمان: صفقات بدفع محجوز. المتصفح يقرأ صفقاته ويضيف صفقة بس؛ كل تغيير بالحالة يصير من الخادم.
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  buyer_id uuid references auth.users (id) on delete set null,
  shop_name text not null check (char_length(btrim(shop_name)) between 1 and 60),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  -- من 1 إلى 1000 دينار، بالفلس
  price_fils integer not null check (price_fils between 1000 and 1000000),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'held', 'shipped', 'released', 'cancelled', 'expired')),
  reserved_until timestamptz,
  stripe_session_id text unique,
  payment_intent_id text unique,
  charge_amount integer,
  charge_currency text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  released_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists deals_seller_id_idx on public.deals (seller_id);
create index if not exists deals_buyer_id_idx on public.deals (buyer_id);

alter table public.deals enable row level security;
alter table public.deals force row level security;

revoke all on public.deals from anon, authenticated;
-- المتصفح يقرأ، ويضيف هذي الأعمدة بس. الحالة والمشتري والدفع ما يقدر يلمسها
grant select on public.deals to authenticated;
grant insert (shop_name, title, description, price_fils) on public.deals to authenticated;
grant select, insert, update on public.deals to service_role;

drop policy if exists "deals: parties read" on public.deals;
drop policy if exists "deals: seller creates" on public.deals;
create policy "deals: parties read" on public.deals
  for select to authenticated
  using (seller_id = (select auth.uid()) or buyer_id = (select auth.uid()));
create policy "deals: seller creates" on public.deals
  for insert to authenticated
  with check (seller_id = (select auth.uid()) and buyer_id is null and status = 'awaiting_payment');

-- صفحة الصفقة من الرابط: أي أحد معه الرابط يشوف المنتج والسعر والحالة، بدون بيانات الأطراف
create or replace function public.get_deal(p_id uuid)
returns table (
  id uuid, shop_name text, title text, description text, price_fils integer, status text,
  created_at timestamptz, paid_at timestamptz, shipped_at timestamptz, released_at timestamptz, cancelled_at timestamptz,
  is_seller boolean, is_buyer boolean, reserved_by_other boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select d.id, d.shop_name, d.title, d.description, d.price_fils, d.status,
         d.created_at, d.paid_at, d.shipped_at, d.released_at, d.cancelled_at,
         coalesce(d.seller_id = auth.uid(), false),
         coalesce(d.buyer_id = auth.uid(), false),
         coalesce(d.status = 'awaiting_payment' and d.buyer_id is not null
                  and d.buyer_id is distinct from auth.uid() and d.reserved_until > now(), false)
  from public.deals d
  where d.id = p_id;
$$;

-- البائع يعلّم «تم الشحن» بس لما يكون المبلغ محجوز
create or replace function public.mark_shipped(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.deals set status = 'shipped', shipped_at = now()
  where id = p_id and seller_id = auth.uid() and status = 'held'
  returning status into v_status;
  if v_status is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return v_status;
end;
$$;

-- البائع يلغي صفقة ما انْدفعت، إلا إذا في مشتري قاعد يدفع الحين
create or replace function public.cancel_unpaid_deal(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.deals set status = 'cancelled', cancelled_at = now()
  where id = p_id and seller_id = auth.uid() and status = 'awaiting_payment'
    and (reserved_until is null or reserved_until < now())
  returning status into v_status;
  if v_status is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return v_status;
end;
$$;

revoke all on function public.get_deal(uuid) from public;
revoke all on function public.mark_shipped(uuid) from public;
revoke all on function public.cancel_unpaid_deal(uuid) from public;
grant execute on function public.get_deal(uuid) to anon, authenticated;
grant execute on function public.mark_shipped(uuid) to authenticated;
grant execute on function public.cancel_unpaid_deal(uuid) to authenticated;
