-- =====================================================================
-- Rast OS — Migration 0021: açılış verisine ekip listesi (profiles)
--
-- public.app_bootstrap(p_collections text[], p_since date default null) → jsonb
--
-- 0020'deki fonksiyonun aynısı (create or replace); tek fark izin listesine
-- `profiles` koleksiyonunun eklenmesi. Görev atama ekranı (Görevler, Bugün)
-- org'daki ekip üyelerini ayrı istek atmadan, açılış isteğiyle alır.
--
-- profiles koleksiyonu:
--   * Yalnızca  id, full_name, role, is_active  alanları döner (telefon,
--     avatar vb. dönmez) — `to_jsonb(satır)` KULLANILMAZ.
--   * Yalnızca çağıranın org'u: `organization_id = <çağıranın org'u>` süzgeci
--     + RLS (0001 `profiles_self`: id = auth.uid() or organization_id =
--     current_org_id()). Org'a bağlı olmayan kullanıcı → [] (sorgu yok).
--   * Sıra: created_at artan (ekibin kuruluş sırası).
--
-- SECURITY INVOKER (0020 ile aynı): çağıranın yetkisiyle çalışır, tüm
-- tablolarda RLS aynen uygulanır. Koleksiyon adları izin listesine göre
-- doğrulanır; listede olmayan ad → 22023. anon çağıramaz.
--
-- Geri uyumluluk: 0021 uygulanmadan önce (yalnız 0020) fonksiyon `profiles`'ı
-- 22023 ile reddeder; istemci bunu görünce o sekmede `profiles`'ı RPC'den
-- çıkarıp ekibi `profiles` tablosundan (aynı turda, paralel) okur.
--
-- Idempotent. NOT applied to any environment yet. Apply AFTER 0020.
-- =====================================================================

create or replace function public.app_bootstrap(p_collections text[], p_since date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  -- src/lib/store.ts → COLLECTIONS ile aynı liste (scripts/bootstrap-logic.test.mjs karşılaştırır).
  v_allowed constant text[] := array[
    'leads', 'jobs', 'clients', 'brands', 'contacts', 'projects',
    'tasks', 'contents', 'shoots', 'equipment', 'invoices', 'payments', 'expenses',
    'proposals', 'proposal_items', 'content_approvals', 'client_reports', 'client_portal_tokens',
    'activity_logs', 'prospects', 'outreach_sequences', 'outreach_messages', 'suppression_list',
    'profiles'
  ];
  -- Faturanın "açık ya da pencerede" olma koşulu ({i} = tablo takma adı); payments da aynı koşulu kullanır.
  v_invoice_keep constant text :=
    '({i}.created_at >= $1 or {i}.issue_date >= $1 or {i}.due_date >= $1'
    || ' or {i}.status not in (''paid'', ''cancelled'')'
    || ' or exists (select 1 from public.payments p where p.invoice_id = {i}.id and (p.paid_at >= $1 or p.created_at >= $1)))';
  v_since date := coalesce(p_since, (current_date - interval '18 months')::date);
  v_cols  text[];
  v_col   text;
  v_where text;
  v_limit text;
  v_rows  jsonb;
  v_org   uuid;
  v_out   jsonb;
begin
  if auth.uid() is null then
    raise exception 'app_bootstrap: oturum yok' using errcode = '42501';
  end if;

  -- Doğrulama: null → boş; tekrarlar atılır; izin listesinde olmayan ad → 22023.
  select coalesce(array_agg(distinct c order by c), '{}') into v_cols
    from unnest(coalesce(p_collections, '{}'::text[])) as c;
  foreach v_col in array v_cols loop
    if v_col is null or not (v_col = any (v_allowed)) then
      raise exception 'app_bootstrap: bilinmeyen koleksiyon %', coalesce(quote_literal(v_col), 'null')
        using errcode = '22023';
    end if;
  end loop;

  select p.organization_id,
         jsonb_build_object('organization_id', p.organization_id, 'role', p.role, 'full_name', p.full_name)
    into v_org, v_out
    from public.profiles p
   where p.id = auth.uid();

  v_out := jsonb_build_object('profile', v_out, 'since', v_since::text);

  -- Org hedefleri (0014). to_jsonb ile okunur: kolonlar yoksa null döner, hata vermez.
  v_out := v_out || jsonb_build_object('organization', (
    select jsonb_build_object('mrr_target', to_jsonb(o) -> 'mrr_target', 'mrr_target_label', to_jsonb(o) -> 'mrr_target_label')
      from public.organizations o
     where o.id = v_org
  ));

  foreach v_col in array v_cols loop
    if v_org is null then
      -- Org'a bağlı değil: RLS zaten hiçbir satır döndürmez; sorgu çalıştırılmaz.
      v_out := v_out || jsonb_build_object(v_col, '[]'::jsonb);
      continue;
    end if;

    if v_col = 'profiles' then
      -- Ekip: yalnız aynı org, yalnız atama için gereken alanlar (telefon / avatar dönmez).
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'full_name', p.full_name, 'role', p.role, 'is_active', p.is_active
             ) order by p.created_at, p.id), '[]'::jsonb)
        into v_rows
        from public.profiles p
       where p.organization_id = v_org;
      v_out := v_out || jsonb_build_object('profiles', v_rows);
      continue;
    end if;

    v_limit := '';
    v_where := case v_col
      when 'invoices' then replace(v_invoice_keep, '{i}', 't')
      when 'payments' then
        '(t.paid_at >= $1 or t.created_at >= $1 or exists (select 1 from public.invoices i where i.id = t.invoice_id and '
        || replace(v_invoice_keep, '{i}', 'i') || '))'
      when 'expenses' then
        '(t.is_recurring or t.payment_status = ''pending'' or t.paid_at is null or t.paid_at >= $1 or t.created_at >= $1)'
      when 'tasks' then
        '(t.status <> ''done'' or t.due_date >= $1 or t.created_at >= $1)'
      when 'contents' then
        '(t.status not in (''published'', ''archived'') or t.planned_date >= $1 or t.published_date >= $1 or t.created_at >= $1)'
      when 'jobs' then
        '(t.date is null or t.date >= $1 or t.created_at >= $1'
        || ' or (t.status <> ''cancelled'' and (t.status <> ''delivered'' or t.payment_status <> ''paid'')))'
      when 'outreach_messages' then
        '(t.status in (''draft'', ''approved'', ''scheduled'') or t.created_at >= $1 or t.sent_at >= $1 or t.replied_at >= $1)'
      else 'true'
    end;
    if v_col = 'activity_logs' then
      v_limit := ' limit 500';
    end if;

    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), ''[]''::jsonb)
         from (select * from public.%I t where %s order by t.created_at desc%s) t',
      v_col, v_where, v_limit
    ) into v_rows using v_since;

    v_out := v_out || jsonb_build_object(v_col, v_rows);
  end loop;

  return v_out;
end;
$$;

comment on function public.app_bootstrap(text[], date) is
  'Açılış verisi: profil + org hedefleri + istenen koleksiyonlar (0021: + ekip listesi) tek istekte (SECURITY INVOKER, RLS uygulanır). Bkz. README-0020.md, README-0021.md.';

revoke all on function public.app_bootstrap(text[], date) from public;
revoke all on function public.app_bootstrap(text[], date) from anon;
grant execute on function public.app_bootstrap(text[], date) to authenticated;
