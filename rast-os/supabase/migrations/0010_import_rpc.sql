-- =====================================================================
-- Rast OS — Migration 0010: Atomic import RPC
--
-- public.import_rows(p_payload jsonb) → jsonb
--
-- İçe Aktar ekranı önceden eski kayıtları siler, sonra satırları tek tek
-- yazardı; yarıda kalan bir aktarım veriyi yarım bırakıyordu. Bu fonksiyon
-- silme + güncelleme + ekleme (upsert) işlemlerini TEK transaction içinde
-- yapar: herhangi bir satır hata verirse hiçbir değişiklik kalmaz.
--
-- SECURITY INVOKER: çağıranın yetkisiyle çalışır, RLS aynen uygulanır
-- (<tablo>_org_all: organization_id = current_org_id()). organization_id
-- istemciden alınmaz; her satıra current_org_id() yazılır.
--
-- Payload:
-- {
--   "deletes": [ { "table": "jobs", "id": "<uuid>" }, ... ],
--   "updates": [ { "table": "clients", "id": "<uuid>", "patch": { ... } }, ... ],
--   "inserts": [ { "table": "expenses", "row": { "id": "<uuid>", ... } }, ... ]
-- }
-- Sıra: deletes → updates → inserts (inserts dizideki sırayla; ör. clients,
-- kendilerine bağlı invoices'tan önce gelmeli). Insert'ler id üzerinden upsert'tür.
-- Tabloda olmayan anahtarlar yok sayılır; id/organization_id/created_at
-- güncellenmez.
--
-- Dönüş: { "deleted": n, "updated": n, "inserted": n }
--
-- Idempotent. NOT applied to any environment yet. Apply AFTER 0008 and 0009.
-- =====================================================================

create or replace function public.import_rows(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'clients','leads','contacts','brands','jobs','equipment','expenses','invoices'
  ];
  v_org      uuid := current_org_id();
  v_item     jsonb;
  v_table    text;
  v_id       uuid;
  v_data     jsonb;
  v_cols     text;
  v_set      text;
  v_n        bigint;
  v_deleted  bigint := 0;
  v_updated  bigint := 0;
  v_inserted bigint := 0;
begin
  if v_org is null then
    raise exception 'import_rows: kullanıcı bir organizasyona bağlı değil'
      using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'import_rows: payload bir JSON nesnesi olmalı' using errcode = '22023';
  end if;

  -- 1) Silmeler
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'deletes', '[]'::jsonb)) loop
    v_table := v_item->>'table';
    v_id    := (v_item->>'id')::uuid;
    if not (v_table = any (v_allowed)) then
      raise exception 'import_rows: izin verilmeyen tablo %', v_table using errcode = '22023';
    end if;
    execute format('delete from public.%I where id = $1', v_table) using v_id;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  -- 2) Güncellemeler (yalnızca tabloda var olan, korunmayan kolonlar)
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'updates', '[]'::jsonb)) loop
    v_table := v_item->>'table';
    v_id    := (v_item->>'id')::uuid;
    v_data  := coalesce(v_item->'patch', '{}'::jsonb);
    if not (v_table = any (v_allowed)) then
      raise exception 'import_rows: izin verilmeyen tablo %', v_table using errcode = '22023';
    end if;
    select string_agg(format('%1$I = r.%1$I', a.attname), ', ' order by a.attnum)
      into v_set
      from pg_attribute a
     where a.attrelid = format('public.%I', v_table)::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname not in ('id', 'organization_id', 'created_at')
       and v_data ? a.attname;
    continue when v_set is null;
    execute format(
      'update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.id = $2',
      v_table, v_set
    ) using v_data, v_id;
    get diagnostics v_n = row_count;
    v_updated := v_updated + v_n;
  end loop;

  -- 3) Eklemeler (id üzerinden upsert; verilmeyen kolonlar tablo varsayılanını alır)
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'inserts', '[]'::jsonb)) loop
    v_table := v_item->>'table';
    v_data  := coalesce(v_item->'row', '{}'::jsonb) - 'organization_id';
    if not (v_table = any (v_allowed)) then
      raise exception 'import_rows: izin verilmeyen tablo %', v_table using errcode = '22023';
    end if;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
           string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
             filter (where a.attname not in ('id', 'created_at'))
      into v_cols, v_set
      from pg_attribute a
     where a.attrelid = format('public.%I', v_table)::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname <> 'organization_id'
       and v_data ? a.attname;
    if v_cols is null then
      raise exception 'import_rows: % için boş satır', v_table using errcode = '22023';
    end if;
    execute format(
      'insert into public.%1$I (organization_id, %2$s) select $2, %2$s from jsonb_populate_record(null::public.%1$I, $1) '
      || case when v_set is null then 'on conflict (id) do nothing' else 'on conflict (id) do update set %3$s' end,
      v_table, v_cols, v_set
    ) using v_data, v_org;
    get diagnostics v_n = row_count;
    v_inserted := v_inserted + v_n;
  end loop;

  return jsonb_build_object('deleted', v_deleted, 'updated', v_updated, 'inserted', v_inserted);
end;
$$;

comment on function public.import_rows(jsonb) is
  'İçe Aktar: deletes → updates → inserts(upsert) tek transaction; SECURITY INVOKER (RLS geçerli). Bkz. 0010_import_rpc.sql';

revoke all on function public.import_rows(jsonb) from public;
revoke all on function public.import_rows(jsonb) from anon;
grant execute on function public.import_rows(jsonb) to authenticated;
