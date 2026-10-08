-- =====================================================================
-- Rast OS — Migration 0012: İşlem geçmişi (audit log) trigger'ları
--
-- 0001'deki public.activity_logs tablosunu Postgres trigger'larıyla doldurur.
-- Uygulama tabloya yazmaz; her INSERT / UPDATE / DELETE satır bazında
-- public.log_activity() tarafından kaydedilir (atlatılamaz, istemciden bağımsız).
--
-- Kolon eşlemesi (0001 şeması korunur, yeniden adlandırma yok):
--   actor_id     = auth.uid()  (profili yoksa / service role ise NULL)
--   entity       = tablo adı   (TG_TABLE_NAME)
--   entity_id    = kaydın id'si
--   action       = 'insert' | 'update' | 'delete'
--   diff         = değişen alanlar: { "<kolon>": { "old": …, "new": … } }
--                  insert → old null; delete → new null; null alanlar yazılmaz.
--                  id, organization_id, created_at, updated_at hariç.
-- Yeni kolonlar (silinen kayıt / ayrılan kişi sonradan da okunabilsin diye):
--   actor_name   = profiles.full_name (işlem anında)
--   record_label = kaydın görünen adı (name / title / customer_name / …)
--
-- RLS: org üyeleri yalnızca kendi organizasyonlarının loglarını OKUR.
-- İstemci (anon / authenticated) INSERT / UPDATE / DELETE yapamaz.
--
-- Idempotent. NOT applied to any environment yet. Apply AFTER 0011.
-- =====================================================================

-- ---------- Tablo eklemeleri ----------
alter table public.activity_logs add column if not exists actor_name   text;
alter table public.activity_logs add column if not exists record_label text;

create index if not exists idx_activity_logs_org_created
  on public.activity_logs(organization_id, created_at desc);
create index if not exists idx_activity_logs_entity
  on public.activity_logs(entity, entity_id);

-- ---------- Trigger fonksiyonu ----------
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skip constant text[] := array['id', 'organization_id', 'created_at', 'updated_at'];
  v_old  jsonb := '{}'::jsonb;
  v_new  jsonb := '{}'::jsonb;
  v_row  jsonb;
  v_org  uuid;
  v_diff jsonb := '{}'::jsonb;
  v_key  text;
  v_actor uuid;
  v_actor_name text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_row := case when tg_op = 'DELETE' then v_old else v_new end;
  v_org := nullif(v_row ->> 'organization_id', '')::uuid;

  -- Organizasyon silinirken (cascade) yazılacak log FK hatası verirdi: atla.
  if v_org is null or not exists (select 1 from organizations where id = v_org) then
    return null;
  end if;

  for v_key in
    select k from (
      select jsonb_object_keys(v_old) as k
      union
      select jsonb_object_keys(v_new)
    ) keys
  loop
    continue when v_key = any (v_skip);
    -- insert/delete: boş (null) alanları yazma
    continue when tg_op = 'INSERT' and jsonb_typeof(v_new -> v_key) = 'null';
    continue when tg_op = 'DELETE' and jsonb_typeof(v_old -> v_key) = 'null';
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_diff := v_diff || jsonb_build_object(
        v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key)
      );
    end if;
  end loop;

  -- Yalnızca hariç tutulan kolonlar (ör. updated_at) değiştiyse kayıt düşme.
  if tg_op = 'UPDATE' and v_diff = '{}'::jsonb then
    return null;
  end if;

  select p.id, p.full_name into v_actor, v_actor_name
  from profiles p
  where p.id = auth.uid();

  insert into activity_logs (
    organization_id, actor_id, actor_name, entity, entity_id, record_label, action, diff
  ) values (
    v_org,
    v_actor,
    v_actor_name,
    tg_table_name,
    nullif(v_row ->> 'id', '')::uuid,
    left(coalesce(
      v_row ->> 'name', v_row ->> 'title', v_row ->> 'customer_name',
      v_row ->> 'invoice_no', v_row ->> 'proposal_no',
      v_row ->> 'description', v_row ->> 'vendor'
    ), 200),
    lower(tg_op),
    v_diff
  );
  return null; -- AFTER trigger: dönüş değeri yok sayılır
end;
$$;

revoke all on function public.log_activity() from public, anon, authenticated;

-- ---------- Trigger'lar ----------
do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'projects', 'jobs', 'tasks', 'invoices', 'payments',
    'expenses', 'proposals', 'proposal_items'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice '0012: public.% yok, trigger atlandı (önce ilgili migration uygulanmalı)', t;
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I;', t || '_activity_log', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.log_activity();',
      t || '_activity_log', t);
  end loop;
end $$;

-- ---------- RLS: yalnızca okuma ----------
alter table public.activity_logs enable row level security;

-- 0001'in genel "for all" politikası istemcinin log yazmasına/silmesine izin veriyordu.
drop policy if exists activity_logs_org_all on public.activity_logs;
drop policy if exists activity_logs_org_select on public.activity_logs;
create policy activity_logs_org_select on public.activity_logs for select
  using (organization_id = current_org_id());

-- Politika olmasa da RLS yazmayı reddeder; ek olarak tablo yetkisi de kaldırılır.
revoke insert, update, delete, truncate on public.activity_logs from anon, authenticated;
grant select on public.activity_logs to authenticated;
