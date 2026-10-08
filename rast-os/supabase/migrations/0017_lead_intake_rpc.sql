-- =====================================================================
-- Rast OS — Migration 0017: Lead girişi (web sitesi formu → CRM + arama görevi)
--
-- POST /api/leads (Next route) bu migration'daki public.lead_intake() RPC'sini ANON istemciyle
-- çağırır. Kod tabanında service-role deseni olmadığı için yazma işi SECURITY DEFINER RPC'de yapılır.
-- RPC anon'a açık olduğundan (anon key tarayıcıda herkese görünür) çağrı bir SIR ister:
-- p_token, lead_intake_settings.token_hash (SHA-256) ile karşılaştırılır. Sır yalnızca sunucu env'inde
-- (LEAD_WEBHOOK_SECRET) ve (hash olarak) bu tabloda bulunur; org id + anon key tek başına yetmez.
--
-- Yaptıkları:
--   1) public.leads       : source_package (paket), source_utm (utm_*) kolonları.
--   2) public.tasks       : lead_id (lead'e bağlı arama görevi; CRM rozeti bunu okur).
--   3) public.lead_phone_key(text) : telefon tekilleştirme anahtarı (son 10 hane) — src/lib/lead-logic.ts ile aynı kural.
--   4) public.lead_intake_settings : org başına sır hash'i + varsayılan sorumlu (RLS açık, politika YOK:
--      yalnızca SECURITY DEFINER fonksiyon okur; anon/authenticated erişemez).
--   5) public.lead_intake(p_org uuid, p_payload jsonb, p_token text) → jsonb
--        - tekilleştirme: org içinde e-posta (küçük harf) VEYA telefon anahtarı eşleşirse mevcut lead güncellenir,
--          yoksa yeni lead eklenir (status 'new', next_followup_at = yarın);
--        - "Lead'i 24 saat içinde ara: <ad>" görevi (yarın, sorumlu = varsayılan sorumlu; açık bir arama görevi
--          zaten varsa yenisi açılmaz);
--        - dönüş: { ok, lead_id, task_id, duplicate }.
--
-- Idempotent. NOT applied to any environment yet. Apply AFTER 0015 (0016 başka dalda olabilir; sıra serbest).
-- Kurulum + rollback: README-0017.md
-- =====================================================================

-- ---------- 1) leads: kaynak ayrıntıları ----------
alter table public.leads add column if not exists source_package text;
alter table public.leads add column if not exists source_utm jsonb;

-- ---------- 2) tasks: lead bağı ----------
alter table public.tasks add column if not exists lead_id uuid references public.leads(id) on delete cascade;
create index if not exists idx_tasks_lead on public.tasks(lead_id) where lead_id is not null;

-- ---------- 3) Telefon anahtarı ----------
-- 10+ hanede SON 10 hane (+90 / 0 / 90 öneki fark etmez), 7-9 hanede olduğu gibi, daha kısaysa NULL.
create or replace function public.lead_phone_key(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when length(d) >= 10 then right(d, 10)
    when length(d) >= 7 then d
    else null
  end
  from (select regexp_replace(left(coalesce(p, ''), 40), '\D', '', 'g') as d) s;
$$;

create index if not exists idx_leads_org_email_key
  on public.leads (organization_id, lower(email)) where email is not null;
create index if not exists idx_leads_org_phone_key
  on public.leads (organization_id, public.lead_phone_key(phone)) where phone is not null;

-- ---------- 4) Ayarlar (sır hash'i + varsayılan sorumlu) ----------
create table if not exists public.lead_intake_settings (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  token_hash       text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  default_owner_id uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.lead_intake_settings enable row level security;
-- Politika bilerek YOK: istemci rolleri satırı göremez/yazamaz. Kurulum SQL Editor'den (postgres) yapılır.
revoke all on public.lead_intake_settings from anon, authenticated;

comment on table public.lead_intake_settings is
  'Lead girişi: org başına SHA-256(LEAD_WEBHOOK_SECRET) ve varsayılan sorumlu. Yalnızca lead_intake() okur. Bkz. 0017.';

-- ---------- 5) RPC ----------
create or replace function public.lead_intake(p_org uuid, p_payload jsonb, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_prefix constant text := 'Lead''i 24 saat içinde ara';
  c_utm    constant text[] := array['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  v_hash       text;
  v_owner      uuid;
  v_name       text;
  v_company    text;
  v_phone      text;
  v_phone_key  text;
  v_email      text;
  v_project    text;
  v_message    text;
  v_kaynak     text;
  v_paket      text;
  v_utm        jsonb := '{}'::jsonb;
  v_src        jsonb;
  v_source     text;
  v_today      date := (now() at time zone 'Europe/Istanbul')::date;
  v_lead_id    uuid;
  v_task_id    uuid;
  v_dup        boolean := false;
  v_k          text;
  v_note       text;
begin
  -- Yetki: sır (anon'a açık fonksiyon; yalnızca sırrı bilen sunucu route'u geçer)
  if p_org is null or p_token is null or length(p_token) < 16 then
    raise exception 'lead_intake: yetkisiz' using errcode = '42501';
  end if;
  select s.token_hash, s.default_owner_id into v_hash, v_owner
    from lead_intake_settings s where s.organization_id = p_org;
  if v_hash is null or v_hash <> encode(sha256(convert_to(p_token, 'utf8')), 'hex') then
    raise exception 'lead_intake: yetkisiz' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 20000 then
    raise exception 'lead_intake: geçersiz payload' using errcode = '22023';
  end if;

  -- Normalizasyon (src/lib/lead-logic.ts normalizeLeadPayload ile aynı kurallar; burada savunma amaçlı tekrarlanır)
  v_name := left(btrim(coalesce(p_payload ->> 'name', '')), 120);
  if length(v_name) < 2 then
    raise exception 'lead_intake: ad zorunlu' using errcode = '22023';
  end if;
  v_company := nullif(left(btrim(coalesce(p_payload ->> 'company', '')), 160), '');
  v_email   := lower(left(btrim(coalesce(p_payload ->> 'email', '')), 160));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then v_email := null; end if;
  v_phone     := nullif(left(btrim(coalesce(p_payload ->> 'phone', '')), 40), '');
  v_phone_key := public.lead_phone_key(v_phone);
  if v_phone_key is null then v_phone := null; end if;
  if v_phone_key is null and v_email is null then
    raise exception 'lead_intake: telefon veya e-posta gerekli' using errcode = '22023';
  end if;
  v_project := nullif(left(btrim(coalesce(p_payload ->> 'project_type', '')), 120), '');
  v_message := nullif(left(btrim(coalesce(p_payload ->> 'message', '')), 4000), '');
  v_kaynak  := lower(left(btrim(coalesce(p_payload ->> 'kaynak', '')), 40));
  if v_kaynak !~ '^[a-z0-9_-]{1,40}$' then v_kaynak := null; end if;
  v_paket   := lower(left(btrim(coalesce(p_payload ->> 'paket', '')), 40));
  if v_paket !~ '^[a-z0-9_-]{1,40}$' then v_paket := null; end if;

  v_src := case when jsonb_typeof(p_payload -> 'utm') = 'object' then p_payload -> 'utm' else '{}'::jsonb end;
  foreach v_k in array c_utm loop
    if nullif(btrim(coalesce(v_src ->> v_k, '')), '') is not null then
      v_utm := v_utm || jsonb_build_object(v_k, left(btrim(v_src ->> v_k), 120));
    end if;
  end loop;

  v_source := coalesce(
    nullif(left(btrim(coalesce(p_payload ->> 'source_label', '')), 80), ''),
    case when v_kaynak = 'hekim' then 'Hekim sistemi (web sitesi)' else 'Web sitesi' end
  );

  -- Aynı kişinin eşzamanlı çift gönderimi tek kayıt üretsin
  perform pg_advisory_xact_lock(
    hashtextextended(p_org::text || '|' || coalesce(v_email, '') || '|' || coalesce(v_phone_key, ''), 0)
  );

  -- Tekilleştirme: org içinde e-posta VEYA telefon anahtarı
  select l.id into v_lead_id
    from leads l
   where l.organization_id = p_org
     and ((v_email is not null and lower(l.email) = v_email)
       or (v_phone_key is not null and public.lead_phone_key(l.phone) = v_phone_key))
   order by l.created_at
   limit 1
   for update;

  if v_lead_id is null then
    insert into leads (
      organization_id, company_name, contact_person, phone, email, source, interested_in,
      notes, status, next_followup_at, source_package, source_utm
    ) values (
      p_org, coalesce(v_company, v_name), v_name, v_phone, v_email, v_source, v_project,
      v_message, 'new', v_today + 1, v_paket, nullif(v_utm, '{}'::jsonb)
    )
    returning id into v_lead_id;
  else
    v_dup := true;
    v_note := '[' || to_char(v_today, 'DD.MM.YYYY') || '] Yeni form talebi'
              || coalesce(' (' || v_project || ')', '')
              || ': ' || coalesce(v_message, '(mesaj yok)');
    update leads l set
      phone            = coalesce(l.phone, v_phone),
      email            = coalesce(l.email, v_email),
      interested_in    = coalesce(l.interested_in, v_project),
      source_package   = coalesce(l.source_package, v_paket),
      source_utm       = coalesce(l.source_utm, nullif(v_utm, '{}'::jsonb)),
      notes            = case when l.notes is null or l.notes = '' then v_note else l.notes || E'\n\n' || v_note end,
      -- kaybedilmiş aday tekrar yazdıysa yeniden aç; diğer durumlar korunur
      status           = case when l.status = 'lost' then 'new'::lead_status else l.status end,
      next_followup_at = case when l.next_followup_at is null or l.next_followup_at < v_today then v_today + 1 else l.next_followup_at end,
      updated_at       = now()
     where l.id = v_lead_id;
  end if;

  -- Varsayılan sorumlu: ayardaki profil → org'un en eski aktif admin'i → en eski aktif profil
  if v_owner is null then
    select p.id into v_owner from profiles p
     where p.organization_id = p_org and p.is_active and p.role = 'admin'
     order by p.created_at limit 1;
  end if;
  if v_owner is null then
    select p.id into v_owner from profiles p
     where p.organization_id = p_org and p.is_active
     order by p.created_at limit 1;
  end if;

  -- Arama görevi: lead için açık bir arama görevi varsa yenisi açılmaz
  select t.id into v_task_id from tasks t
   where t.lead_id = v_lead_id and t.status <> 'done' and starts_with(t.title, c_prefix)
   order by t.created_at limit 1;

  if v_task_id is null then
    insert into tasks (organization_id, lead_id, title, assignee_id, due_date, priority, status, notes)
    values (
      p_org, v_lead_id, c_prefix || ': ' || v_name, v_owner, v_today + 1, 'high', 'todo',
      concat_ws(E'\n',
        'Telefon: ' || v_phone,
        'E-posta: ' || v_email,
        'Proje türü: ' || v_project,
        'Kaynak: ' || v_source || coalesce(' / ' || v_paket, '')
      )
    )
    returning id into v_task_id;
  end if;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'task_id', v_task_id, 'duplicate', v_dup);
end;
$$;

comment on function public.lead_intake(uuid, jsonb, text) is
  'Web sitesi lead girişi: sır doğrula → tekilleştir (e-posta/telefon) → lead ekle/güncelle → arama görevi. SECURITY DEFINER; anon çağırır. Bkz. 0017_lead_intake_rpc.sql';

revoke all on function public.lead_intake(uuid, jsonb, text) from public;
grant execute on function public.lead_intake(uuid, jsonb, text) to anon, authenticated;
