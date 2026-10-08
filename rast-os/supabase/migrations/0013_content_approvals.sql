-- =====================================================================
-- Rast OS — Migration 0013: İçerik onayı (content_approvals)
--
-- Her senaryo / video yayından önce hekime (veya müşteriye) gizli bir
-- bağlantıyla (/onay/<token>) gönderilir; hekim 8 maddelik mevzuat kontrol
-- listesini işaretleyip adıyla onaylar ya da değişiklik ister. Kayıt, 2025
-- Sağlık Hizmetlerinde Tanıtım Yönetmeliği md. 5/2'deki ortak sorumluluk
-- (ajans + hekim) için "hekim yazılı onay verdi" kanıtıdır.
--
--   content_approvals : içerik başına sürümlü onay talebi
--     version         : aynı içerik için 1, 2, 3… ("Yeniden gönder" yeni sürüm)
--     token           : 64 hex karakter (gen_random_bytes(32) = 256 bit),
--                       YALNIZCA sunucuda üretilir (istemci değeri yok sayılır)
--     checklist       : 8 madde [{key, label, basis, checked}], sunucu şablonu
--     script_snapshot : gönderim anındaki senaryo (sonradan değişmez)
--     title           : gönderim anındaki içerik başlığı (içerik silinse de okunur)
--     status          : pending | approved | changes_requested | expired
--
-- Erişim:
--   * Org üyeleri (RLS, current_org_id()): okur, pending kayıt oluşturur,
--     pending → expired (geri çeker), pending/expired kaydı siler.
--     Karar verilmiş (approved / changes_requested) kayıt DEĞİŞTİRİLEMEZ ve
--     SİLİNEMEZ — guard trigger + RLS.
--   * Anonim (hekim): tabloya hiç erişemez. Yalnızca iki SECURITY DEFINER RPC:
--       approval_get(p_token)     → asgari görünüm (jsonb) ya da null
--       approval_decide(p_token, p_decision, p_name, p_note, p_checked)
--
-- İçerik silinirse onay kaydı KALIR (content_id null olur; PG15+ sözdizimi
-- "on delete set null (content_id)").
--
-- 0012'deki public.log_activity() trigger'ı bu tabloya da bağlanır.
--
-- Idempotent. NOT applied to any environment yet — see README-0013.md.
-- Apply AFTER 0012.
-- =====================================================================

-- ---------- Token üretici ----------
-- pgcrypto Supabase'de "extensions" şemasında, düz Postgres'te "public"te olur;
-- search_path ikisini de kapsar.
create or replace function public.approval_new_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select encode(gen_random_bytes(32), 'hex');
$$;

revoke all on function public.approval_new_token() from public, anon;
grant execute on function public.approval_new_token() to authenticated;

-- ---------- 8 maddelik mevzuat kontrol listesi (şablon) ----------
-- Kaynak: 04-Knowledge/Hekim-Sistemi/icerik-onay-formu.md §2
-- (2025 Yönetmeliği, RG 12.11.2025/33075). Uygulamadaki kopya:
-- src/lib/approval-logic.ts → APPROVAL_CHECKLIST (testler ikisini karşılaştırır).
create or replace function public.approval_default_checklist()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'uzmanlik', 'label', 'Konu ve ifadeler hekimin tescilli uzmanlık alanında; unvan diplomadaki haliyle, sertifikaya dayalı unvan ("estetik hekimi" vb.) yok', 'basis', '5/d', 'checked', false),
    jsonb_build_object('key', 'bilgilendirme', 'label', 'Bilgilendirme niteliğinde: "tedavi eder", kanıtlanmamış veya Bakanlıkça düzenlenmemiş yöntem iddiası yok', 'basis', '4/h, 5/ç', 'checked', false),
    jsonb_build_object('key', 'ustunluk', 'label', 'Üstünlük/garanti yok: "en iyi", "bir numara", "garantili", "kesin sonuç", "ağrısız/risksiz", "kalıcı çözüm", "tek seansta", "mucize"; rakip ima/kıyas yok', 'basis', '5/c, 5/ı', 'checked', false),
    jsonb_build_object('key', 'ucret', 'label', 'Ücret, indirim, kampanya, hediye, çekiliş yok', 'basis', '5/n, 5/m', 'checked', false),
    jsonb_build_object('key', 'yonlendirme', 'label', 'Yönlendirme yok: "hemen randevu alın", check-up çağrısı, doğrudan/dolaylı çağrı', 'basis', '5/f, 5/g', 'checked', false),
    jsonb_build_object('key', 'hasta', 'label', 'Hasta içeriği yok: hasta görüntüsü, öncesi/sonrası, hasta yorumu/teşekkürü, ameliyat anı, mahrem bölge', 'basis', '5/e, 7', 'checked', false),
    jsonb_build_object('key', 'urun', 'label', 'Ürün/firma/marka adı, cihaz logosu, ürün linki yok', 'basis', '5/ı', 'checked', false),
    jsonb_build_object('key', 'dogruluk', 'label', 'Tıbbi doğruluk: bilgi hekimin beyanına veya onayladığı kaynağa dayanıyor, doğrulanmamış bilgi kalmadı; korku, yapay aciliyet, tanı koyan ifade yok', 'basis', '4/h, 5/c', 'checked', false)
  );
$$;

revoke all on function public.approval_default_checklist() from public, anon;
grant execute on function public.approval_default_checklist() to authenticated;

-- ---------- contents: bileşik FK hedefi (onay ↔ içerik aynı org) ----------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contents_id_org_unique' and conrelid = 'public.contents'::regclass
  ) then
    alter table public.contents
      add constraint contents_id_org_unique unique (id, organization_id);
  end if;
end $$;

-- ---------- content_approvals ----------
create table if not exists public.content_approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  content_id      uuid,
  version         int not null default 1,
  token           text not null default public.approval_new_token(),
  title           text not null default '',
  checklist       jsonb not null default public.approval_default_checklist(),
  script_snapshot text,
  note            text,
  status          text not null default 'pending',
  sent_at         timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by_name text,
  decided_by_ip   text,
  expires_at      timestamptz not null default (now() + interval '14 days'),
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint content_approvals_token_unique unique (token),
  constraint content_approvals_token_format check (token ~ '^[0-9a-f]{64}$'),
  constraint content_approvals_status_check
    check (status in ('pending','approved','changes_requested','expired')),
  constraint content_approvals_version_check check (version >= 1),
  constraint content_approvals_checklist_array check (jsonb_typeof(checklist) = 'array'),
  -- Karar verilmiş kayıtta karar alanları dolu olmalı
  constraint content_approvals_decided_fields check (
    status not in ('approved','changes_requested')
    or (decided_at is not null and decided_by_name is not null and btrim(decided_by_name) <> '')
  ),
  constraint content_approvals_note_len check (note is null or char_length(note) <= 2000),
  -- Aynı içerik için sürüm numarası tekil (içerik silinince content_id null → kısıt dışı)
  constraint content_approvals_content_version_unique unique (content_id, version),
  -- Onay, bağlı olduğu içerikle AYNI organizasyonda. İçerik silinince yalnızca
  -- content_id boşalır, kayıt (kanıt) kalır.
  constraint content_approvals_content_fk
    foreign key (content_id, organization_id)
    references public.contents(id, organization_id)
    on delete set null (content_id)
);

create index if not exists idx_content_approvals_org on public.content_approvals(organization_id);
create index if not exists idx_content_approvals_content on public.content_approvals(content_id, version desc);

-- ---------- Guard trigger: istemci rolleri için bütünlük kuralları ----------
-- approval_decide (SECURITY DEFINER, sahibi olarak çalışır) ve FK eylemleri
-- (on delete set null) bu kısıtlardan muaftır; yalnızca anon/authenticated
-- doğrudan yazımları denetlenir.
create or replace function public.content_approvals_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending'
       or new.decided_at is not null
       or new.decided_by_name is not null
       or new.decided_by_ip is not null then
      raise exception 'content_approvals: yeni kayıt yalnızca "pending" olarak oluşturulabilir'
        using errcode = '42501';
    end if;
    -- Sunucu tarafı değerler: istemcinin gönderdiği token / liste / tarih yok sayılır.
    new.token      := public.approval_new_token();
    new.checklist  := public.approval_default_checklist();
    new.note       := null;
    new.sent_at    := now();
    new.expires_at := now() + interval '14 days';
    new.created_by := auth.uid();
    new.created_at := now();
    return new;
  end if;

  -- UPDATE: yalnızca pending → expired (geri çekme); başka hiçbir alan değişemez.
  if old.status = 'pending'
     and new.status = 'expired'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;
  raise exception 'content_approvals: onay kaydı değiştirilemez (yalnızca bekleyen talep geri çekilebilir)'
    using errcode = '42501';
end $$;

revoke all on function public.content_approvals_guard() from public, anon, authenticated;

drop trigger if exists content_approvals_guard on public.content_approvals;
create trigger content_approvals_guard
  before insert or update on public.content_approvals
  for each row execute function public.content_approvals_guard();

-- ---------- RLS ----------
alter table public.content_approvals enable row level security;

drop policy if exists content_approvals_org_all on public.content_approvals;
drop policy if exists content_approvals_org_select on public.content_approvals;
drop policy if exists content_approvals_org_insert on public.content_approvals;
drop policy if exists content_approvals_org_update on public.content_approvals;
drop policy if exists content_approvals_org_delete on public.content_approvals;

create policy content_approvals_org_select on public.content_approvals for select
  to authenticated
  using (organization_id = current_org_id());

create policy content_approvals_org_insert on public.content_approvals for insert
  to authenticated
  with check (organization_id = current_org_id());

create policy content_approvals_org_update on public.content_approvals for update
  to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Karar verilmiş kayıtlar (kanıt) silinemez.
create policy content_approvals_org_delete on public.content_approvals for delete
  to authenticated
  using (organization_id = current_org_id() and status in ('pending', 'expired'));

revoke all on public.content_approvals from anon;
grant select, insert, update, delete on public.content_approvals to authenticated;

-- ---------- Public RPC: approval_get ----------
-- Token ile asgari görünüm. Bulunamazsa null. IP, oluşturan, org/içerik id'si
-- gibi iç alanlar DÖNMEZ. Süresi dolmuş veya yeni sürümü gönderilmiş bekleyen
-- talep "expired" görünür.
create or replace function public.approval_get(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r        public.content_approvals%rowtype;
  v_status text;
  v_newer  boolean;
  v_out    jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into r from public.content_approvals where token = p_token;
  if not found then
    return null;
  end if;

  v_newer := r.content_id is not null and exists (
    select 1 from public.content_approvals n
    where n.content_id = r.content_id and n.version > r.version
  );
  v_status := case
    when r.status = 'pending' and (r.expires_at <= now() or v_newer) then 'expired'
    else r.status
  end;

  select jsonb_build_object(
    'title',           coalesce(nullif(r.title, ''), c.title),
    'version',         r.version,
    'status',          v_status,
    'script_snapshot', r.script_snapshot,
    'checklist',       r.checklist,
    'note',            r.note,
    'sent_at',         r.sent_at,
    'expires_at',      r.expires_at,
    'decided_at',      r.decided_at,
    'decided_by_name', r.decided_by_name,
    'client_name',     cl.name,
    'brand_name',      b.name,
    'agency_name',     o.name
  )
  into v_out
  from public.organizations o
  left join public.contents c on c.id = r.content_id and c.organization_id = r.organization_id
  left join public.clients  cl on cl.id = c.client_id
  left join public.brands   b  on b.id = c.brand_id
  where o.id = r.organization_id;

  return v_out;
end $$;

revoke all on function public.approval_get(text) from public;
grant execute on function public.approval_get(text) to anon, authenticated;

-- ---------- Public RPC: approval_decide ----------
-- Dönüş: { ok: true, status, decided_at, version }
--     ya { ok: false, error: <kod> }  kodlar: not_found | invalid_decision |
--        name_required | note_required | note_too_long | checklist_incomplete |
--        expired | already_decided
-- p_checked: hekimin işaretlediği madde anahtarları. "approved" için 8 maddenin
-- tamamı zorunlu; işaretlenen durum checklist'e yazılır (kanıt).
-- decided_by_ip: PostgREST'in ilettiği istek başlığından (x-forwarded-for ilk
-- değer); yoksa null.
create or replace function public.approval_decide(
  p_token    text,
  p_decision text,
  p_name     text,
  p_note     text default null,
  p_checked  text[] default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r         public.content_approvals%rowtype;
  v_name    text := btrim(coalesce(p_name, ''));
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_checked text[] := coalesce(p_checked, '{}'::text[]);
  v_keys    text[];
  v_list    jsonb;
  v_headers json;
  v_ip      text;
  v_now     timestamptz := now();
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested') then
    return jsonb_build_object('ok', false, 'error', 'invalid_decision');
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'note_too_long');
  end if;
  if p_decision = 'changes_requested' and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'note_required');
  end if;

  -- Satır kilidi: aynı bağlantıya eşzamanlı iki karar yazılamaz.
  select * into r from public.content_approvals where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if r.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'error', case when r.status = 'expired' then 'expired' else 'already_decided' end
    );
  end if;

  if r.expires_at <= v_now or (r.content_id is not null and exists (
       select 1 from public.content_approvals n
       where n.content_id = r.content_id and n.version > r.version
     )) then
    update public.content_approvals set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  select coalesce(array_agg(e ->> 'key'), '{}'::text[])
    into v_keys
    from jsonb_array_elements(r.checklist) e;

  if p_decision = 'approved' and not (v_keys <@ v_checked) then
    return jsonb_build_object('ok', false, 'error', 'checklist_incomplete');
  end if;

  select coalesce(
           jsonb_agg(e || jsonb_build_object('checked', (e ->> 'key') = any (v_checked)) order by ord),
           '[]'::jsonb)
    into v_list
    from jsonb_array_elements(r.checklist) with ordinality as t(e, ord);

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := nullif(left(btrim(split_part(
            coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', ''),
            ',', 1)), 64), '');

  update public.content_approvals
     set status          = p_decision,
         checklist       = v_list,
         note            = v_note,
         decided_at      = v_now,
         decided_by_name = v_name,
         decided_by_ip   = v_ip
   where id = r.id;

  return jsonb_build_object(
    'ok', true,
    'status', p_decision,
    'decided_at', v_now,
    'version', r.version
  );
end $$;

revoke all on function public.approval_decide(text, text, text, text, text[]) from public;
grant execute on function public.approval_decide(text, text, text, text, text[]) to anon, authenticated;

-- ---------- İşlem geçmişi (0012) ----------
do $$
begin
  if to_regprocedure('public.log_activity()') is null then
    raise notice '0013: public.log_activity() yok, trigger atlandı (önce 0012 uygulanmalı)';
    return;
  end if;
  drop trigger if exists content_approvals_activity_log on public.content_approvals;
  create trigger content_approvals_activity_log
    after insert or update or delete on public.content_approvals
    for each row execute function public.log_activity();
end $$;
