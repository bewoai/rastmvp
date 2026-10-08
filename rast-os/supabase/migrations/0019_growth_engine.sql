-- =====================================================================
-- Rast OS — Migration 0019: Müşteri Bulma (Growth Engine)
--
-- İnsan onaylı (human-in-the-loop) B2B erişim: aday bulma (Google Places / CSV / manuel), puanlama,
-- GÜNLÜK MANUEL TEMAS (telefon / WhatsApp / Instagram — kişi kendisi arar / gönderir, uygulama yalnızca
-- kaydeder), e-posta dizileri + onay kuyruğu, saatlik cron ile gönderim, tek tıkla ret (unsubscribe).
-- E-posta gönderimi uygulamada OUTREACH_EMAIL_ENABLED=true olmadan KAPALIDIR (İYS kaydı bekleniyor):
-- cron hiçbir şey talep etmez, onay yalnızca 'approved' işaretler (scheduled_for boş kalır → cron almaz).
-- WhatsApp / Instagram için OTOMATİK GÖNDERİM YOK: uygulama yalnızca önceden doldurulmuş bağlantı açar.
--
--   prospects          : aday işletmeler (place_id ile org içinde tekil), puan + açıklamalı döküm.
--                        Places içeriği SAKLANMAZ (yalnızca place_id + ≤30 gün lat/lng) — bkz. §1 ve README-0019
--   outreach_sequences : e-posta dizisi şablonları (adımlar: [{day, subject, body}])
--   outreach_messages  : temas geçmişi. E-posta: aday + adım başına (draft → approved → scheduled(gönderimde) → sent …);
--                        manuel (manual=true; phone | whatsapp | instagram): kişinin yaptığı temasın kaydı (status 'sent')
--   suppression_list   : ret listesi (e-posta / alan adı / telefon anahtarı) — gönderimden önce kontrol edilir
--   outreach_settings  : org başına cron sırrı hash'i + ret bağlantısı HMAC anahtarı (istemciye KAPALI)
--
-- RPC'ler (SECURITY DEFINER):
--   outreach_unsubscribe(p_token)  → anon; token = "<message_id>.<hmac_sha256(message_id, unsub_key_hash)>"
--                                     ret listesine ekler + bekleyen mesajları iptal eder
--   outreach_cron_claim(p_token, p_cap, p_limit)    → anon (sunucu cron route'u); sır = CRON_SECRET
--                                     (route, OUTREACH_EMAIL_ENABLED=true değilse bu RPC'yi HİÇ çağırmaz)
--   outreach_cron_result(p_token, p_message_id, …)  → gönderim sonucunu yazar, sonraki adım TASLAĞINI açar
--   outreach_places_purge(p_token)  → 30 günü geçen Places lat/lng'yi siler (cron her çalışmada çağırır)
--
-- Bağımlılıklar: 0001 (organizations, profiles, leads), 0011 (set_updated_at), 0012 (log_activity; yoksa
-- trigger atlanır), pgcrypto (hmac; Supabase'de "extensions" şemasında hazır — 0013 de kullanır). PG15+.
--
-- Idempotent. NOT applied to any environment yet. Apply AFTER 0017 (0018 başka dalda olabilir; bağımsız).
-- Kurulum + rollback: README-0019.md
-- =====================================================================

-- ---------- 0) leads: bileşik FK hedefi (aday ↔ lead aynı org) ----------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'leads_id_org_unique' and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads add constraint leads_id_org_unique unique (id, organization_id);
  end if;
end $$;

-- ---------- 1) prospects ----------
-- VERİ KAYNAĞI (Google Maps Platform Şartları 3.2.3(a)): Places içeriği SAKLANMAZ. Places'ten gelen bir
-- aday için yalnızca external_id (place_id, süresiz) ve lat/lng (en fazla 30 gün; places_cached_at ile
-- izlenir, outreach_places_purge() temizler) tutulur. Ad / adres / telefon / web sitesi / puan / yorum
-- sayısı her gösterimde Place Details ile CANLI çekilir. Saklanan diğer alanlar bizim elde ettiklerimizdir:
-- işletmenin kendi sitesinden (zenginleştirme) bulunan e-posta / Instagram / telefon, elle girilenler, CSV
-- (elle araştırılmış liste), notlar, puan SAYISI + döküm (Places metni içermez), durum / temas geçmişi.
-- field_sources: alan başına köken, ör. {"email":"website","phone":"website","name":"manual"}.
create table if not exists public.prospects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source          text not null default 'manuel' check (source in ('places', 'csv', 'manuel')),
  external_id     text check (external_id is null or length(external_id) between 1 and 300),
  name            text check (name is null or length(btrim(name)) between 1 and 200),
  sector          text check (sector is null or length(sector) <= 120),
  city            text check (city is null or length(city) <= 80),
  district        text check (district is null or length(district) <= 80),
  address         text check (address is null or length(address) <= 500),
  phone           text check (phone is null or length(phone) <= 40),
  website         text check (website is null or (length(website) <= 500 and website ~* '^https?://')),
  email           text check (email is null or (length(email) <= 160 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  instagram       text check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  field_sources   jsonb not null default '{}'::jsonb check (jsonb_typeof(field_sources) = 'object'),
  lat             double precision check (lat is null or lat between -90 and 90),
  lng             double precision check (lng is null or lng between -180 and 180),
  places_cached_at timestamptz,   -- lat/lng'nin Places'ten alındığı an (30 gün sonra silinir)
  score           integer not null default 0 check (score between 0 and 100),
  score_breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(score_breakdown) = 'array'),
  status          text not null default 'new'
                  check (status in ('new', 'qualified', 'queued', 'contacted', 'replied', 'converted', 'suppressed')),
  lead_id         uuid,
  notes           text check (notes is null or length(notes) <= 4000),
  next_action_at  date,          -- sonraki eylem / erteleme ("Sonra" = bugün + 7 gün)
  last_contacted_at timestamptz, -- son temas (tüm kanallar); outreach_messages trigger'ı yazar
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint prospects_org_external_unique unique (organization_id, external_id),
  constraint prospects_id_org_unique unique (id, organization_id),
  -- Places dışı kaynakta ad zorunlu; Places adayında ad/adres/site yalnızca ELLE girildiyse, telefon yalnızca
  -- işletmenin sitesinden bulunduysa ya da elle girildiyse saklanabilir (Places'ten kopyalanamaz).
  constraint prospects_name_required check (source = 'places' or name is not null),
  constraint prospects_places_provenance check (
    source <> 'places' or (
          (name is null or coalesce(field_sources ->> 'name', '') = 'manual')
      and (address is null or coalesce(field_sources ->> 'address', '') = 'manual')
      and (website is null or coalesce(field_sources ->> 'website', '') = 'manual')
      and (phone is null or coalesce(field_sources ->> 'phone', '') in ('website', 'manual'))
      and (email is null or coalesce(field_sources ->> 'email', '') in ('website', 'manual'))
      and (instagram is null or coalesce(field_sources ->> 'instagram', '') in ('website', 'manual'))
    )
  ),
  constraint prospects_latlng_dated check ((lat is null and lng is null) or places_cached_at is not null),
  constraint prospects_lead_fk foreign key (lead_id, organization_id)
    references public.leads(id, organization_id) on delete set null (lead_id)
);

create index if not exists idx_prospects_org_status on public.prospects(organization_id, status);
create index if not exists idx_prospects_org_score on public.prospects(organization_id, score desc);

comment on table public.prospects is
  'Müşteri Bulma adayları (Google Places / CSV / manuel). external_id = Places place_id, org içinde tekil. Places içeriği saklanmaz (place_id + ≤30 gün lat/lng). Bkz. 0019.';

-- ---------- 2) outreach_sequences ----------
create table if not exists public.outreach_sequences (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  sector          text check (sector is null or length(sector) <= 60),
  channel         text not null default 'email' check (channel = 'email'),
  steps           jsonb not null default '[]'::jsonb
                  check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 10 and octet_length(steps::text) <= 40000),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint outreach_sequences_id_org_unique unique (id, organization_id)
);

create index if not exists idx_outreach_sequences_org on public.outreach_sequences(organization_id);

-- ---------- 3) outreach_messages ----------
create table if not exists public.outreach_messages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  prospect_id         uuid not null,
  sequence_id         uuid,
  step_no             integer not null default 1 check (step_no between 1 and 10),
  channel             text not null default 'email' check (channel in ('email', 'phone', 'whatsapp', 'instagram')),
  -- manual = kişinin kendi yaptığı temasın kaydı (telefon / WhatsApp / Instagram). E-posta asla manuel değildir.
  manual              boolean not null default false,
  to_email            text check (to_email is null or (length(to_email) <= 160 and to_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  -- subject/body ŞABLON olarak saklanır ({{isim}} vb. belirteçler gösterimde / gönderimde canlı veriyle doldurulur;
  -- Places'ten gelen ad DB'ye kopyalanmaz).
  subject             text not null default '' check (length(subject) <= 300),
  body                text not null default '' check (length(body) <= 10000),
  -- scheduled = cron tarafından gönderim için ayrıldı (gönderimde); istemci bu durumu yazamaz.
  status              text not null default 'draft'
                      check (status in ('draft', 'approved', 'scheduled', 'sent', 'bounced', 'replied', 'cancelled')),
  scheduled_for       timestamptz,
  sent_at             timestamptz,
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 300),
  error               text check (error is null or length(error) <= 1000),
  approved_by         uuid references public.profiles(id) on delete set null,
  approved_at         timestamptz,
  replied_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint outreach_messages_manual_channel check ((channel = 'email') = (not manual)),
  constraint outreach_messages_prospect_fk foreign key (prospect_id, organization_id)
    references public.prospects(id, organization_id) on delete cascade,
  constraint outreach_messages_sequence_fk foreign key (sequence_id, organization_id)
    references public.outreach_sequences(id, organization_id) on delete set null (sequence_id)
);

-- Aynı aday + dizi + adım için iptal edilmemiş tek mesaj (çift taslak / çift gönderim olmasın).
create unique index if not exists uq_outreach_messages_step
  on public.outreach_messages(prospect_id, sequence_id, step_no) where status <> 'cancelled';
create index if not exists idx_outreach_messages_org_status on public.outreach_messages(organization_id, status);
create index if not exists idx_outreach_messages_due
  on public.outreach_messages(scheduled_for) where status = 'approved';
create index if not exists idx_outreach_messages_org_sent
  on public.outreach_messages(organization_id, sent_at) where sent_at is not null;
create index if not exists idx_outreach_messages_prospect on public.outreach_messages(prospect_id, created_at desc);

-- ---------- 4) suppression_list ----------
-- kind = email (küçük harf adres) | domain (küçük harf alan adı) | phone (son 10 hane, lead_phone_key ile aynı kural)
create table if not exists public.suppression_list (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('email', 'domain', 'phone')),
  value           text not null,
  reason          text not null default 'manual' check (reason in ('unsubscribe', 'bounce', 'manual', 'complaint')),
  note            text check (note is null or length(note) <= 500),
  created_at      timestamptz not null default now(),
  constraint suppression_list_unique unique (organization_id, kind, value),
  constraint suppression_list_value_format check (
    (kind = 'email'  and value = lower(value) and length(value) <= 160 and value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    or (kind = 'domain' and value = lower(value) and length(value) <= 200 and value ~ '^[a-z0-9.-]+\.[a-z]{2,}$')
    or (kind = 'phone'  and value ~ '^[0-9]{7,10}$')
  )
);

-- ---------- 5) outreach_settings (istemciye kapalı) ----------
create table if not exists public.outreach_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- SHA-256(CRON_SECRET): cron RPC'lerini yalnızca sırrı bilen sunucu route'u çağırabilir (0017 deseni).
  cron_token_hash text not null check (cron_token_hash ~ '^[0-9a-f]{64}$'),
  -- Ret bağlantısı HMAC anahtarı: rastgele bir sırrın SHA-256'sı (sır saklanmaz). Değiştirmek eski ret
  -- bağlantılarını geçersiz kılar — yalnızca sızıntı şüphesinde değiştirin (README-0019).
  unsub_key_hash  text not null check (unsub_key_hash ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.outreach_settings enable row level security;
-- Politika bilerek YOK: yalnızca SECURITY DEFINER fonksiyonlar okur. Kurulum SQL Editor'den (postgres).
revoke all on public.outreach_settings from anon, authenticated;

comment on table public.outreach_settings is
  'Müşteri Bulma: SHA-256(CRON_SECRET) ve ret bağlantısı HMAC anahtarı. Yalnızca 0019 RPC''leri okur.';

-- ---------- 6) Ret listesi eşleşmesi ----------
-- E-posta tam eşleşme, alan adı (e-postanın @ sonrası, alt alan adları dahil) veya telefon anahtarı.
-- src/lib/growth/suppression.ts isSuppressed() ile aynı kural.
create or replace function public.outreach_is_suppressed(p_org uuid, p_email text, p_phone text)
returns boolean
language sql
stable
set search_path = public
as $$
  with k as (
    select lower(btrim(coalesce(p_email, ''))) as email,
           nullif(split_part(lower(btrim(coalesce(p_email, ''))), '@', 2), '') as dom,
           public.lead_phone_key(p_phone) as phone
  )
  select exists (
    select 1 from public.suppression_list s, k
     where s.organization_id = p_org
       and (
         (s.kind = 'email' and k.email <> '' and s.value = k.email)
         or (s.kind = 'domain' and k.dom is not null and (k.dom = s.value or k.dom like '%.' || s.value))
         or (s.kind = 'phone' and k.phone is not null and s.value = k.phone)
       )
  );
$$;

-- ---------- 7) Guard: outreach_messages (istemci yazımları) ----------
-- Cron/ret RPC'leri (SECURITY DEFINER, sahibi olarak çalışır) muaftır; anon/authenticated denetlenir.
create or replace function public.outreach_messages_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_client boolean := current_user in ('anon', 'authenticated');
begin
  new.updated_at := now();
  if not v_client then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.manual then
      -- Manuel temas kaydı: yalnızca "yapıldı" olarak eklenir; zaman sunucuda yazılır.
      if new.status <> 'sent' then
        raise exception 'outreach_messages: manuel temas yalnızca yapılmış (sent) olarak kaydedilir' using errcode = '42501';
      end if;
      new.sent_at := now();
      new.provider_message_id := null;
      new.replied_at := null;
      new.error := null;
      new.scheduled_for := null;
      new.approved_by := auth.uid();
      new.approved_at := now();
      new.created_at := now();
      return new;
    end if;
    if new.status not in ('draft', 'approved') then
      raise exception 'outreach_messages: yeni mesaj yalnızca taslak veya onaylı olabilir' using errcode = '42501';
    end if;
    new.sent_at := null;
    new.provider_message_id := null;
    new.replied_at := null;
    new.error := null;
    new.created_at := now();
  else
    if new.organization_id <> old.organization_id or new.prospect_id <> old.prospect_id
       or new.manual <> old.manual or new.channel <> old.channel then
      raise exception 'outreach_messages: aday / organizasyon / kanal değiştirilemez' using errcode = '42501';
    end if;
    if new.sent_at is distinct from old.sent_at
       or new.provider_message_id is distinct from old.provider_message_id then
      raise exception 'outreach_messages: gönderim alanları yalnızca sunucuda yazılır' using errcode = '42501';
    end if;
    if old.status in ('scheduled', 'sent', 'bounced', 'replied')
       and (new.subject is distinct from old.subject or new.body is distinct from old.body
            or new.to_email is distinct from old.to_email) then
      raise exception 'outreach_messages: gönderimdeki / gönderilmiş mesaj düzenlenemez' using errcode = '42501';
    end if;
    if old.status = 'approved' and new.status = 'approved'
       and (new.subject is distinct from old.subject or new.body is distinct from old.body
            or new.to_email is distinct from old.to_email) then
      raise exception 'outreach_messages: onaylı mesajı düzenlemek için önce taslağa alın' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (
         (old.status = 'draft'     and new.status in ('approved', 'cancelled'))
      or (old.status = 'approved'  and new.status in ('draft', 'cancelled'))
      or (old.status = 'cancelled' and new.status = 'draft')
      or (old.status = 'sent'      and new.status = 'replied')
      or (old.status = 'replied'   and new.status = 'sent')      -- yanlış "yanıt geldi" işaretini geri alma
    ) then
      raise exception 'outreach_messages: geçersiz durum geçişi % → %', old.status, new.status using errcode = '42501';
    end if;
  end if;

  -- Onay: alıcı zorunlu, ret listesinde olmamalı; onaylayan ve zaman sunucuda yazılır.
  -- scheduled_for'u UYGULAMA belirler: e-posta gönderimi kapalıyken (OUTREACH_EMAIL_ENABLED yok) boş bırakılır
  -- ve cron yalnızca scheduled_for dolu mesajları alır.
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if new.to_email is null then
      raise exception 'outreach_messages: alıcı e-postası olmadan onaylanamaz' using errcode = '23514';
    end if;
    if public.outreach_is_suppressed(new.organization_id, new.to_email, null) then
      raise exception 'outreach_messages: alıcı ret listesinde' using errcode = '23514';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  if new.status = 'replied' and new.replied_at is null then
    new.replied_at := now();
  elsif new.status <> 'replied' then
    new.replied_at := null;
  end if;
  return new;
end $$;

revoke all on function public.outreach_messages_guard() from public, anon, authenticated;

drop trigger if exists outreach_messages_guard on public.outreach_messages;
create trigger outreach_messages_guard
  before insert or update on public.outreach_messages
  for each row execute function public.outreach_messages_guard();

-- updated_at (0011'deki yardımcı)
drop trigger if exists prospects_set_updated_at on public.prospects;
create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

drop trigger if exists outreach_sequences_set_updated_at on public.outreach_sequences;
create trigger outreach_sequences_set_updated_at
  before update on public.outreach_sequences
  for each row execute function public.set_updated_at();

-- Temas olunca adayın son temas zamanı ve durumu güncellenir (manuel kayıt ve cron gönderimi için ortak).
create or replace function public.outreach_messages_touch_prospect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    update prospects p
       set last_contacted_at = greatest(coalesce(p.last_contacted_at, new.sent_at), coalesce(new.sent_at, now())),
           status = case when p.status in ('new', 'qualified', 'queued') then 'contacted' else p.status end
     where p.id = new.prospect_id and p.organization_id = new.organization_id;
  end if;
  return null;
end $$;

revoke all on function public.outreach_messages_touch_prospect() from public, anon, authenticated;

drop trigger if exists outreach_messages_touch_prospect on public.outreach_messages;
create trigger outreach_messages_touch_prospect
  after insert or update of status on public.outreach_messages
  for each row execute function public.outreach_messages_touch_prospect();

-- ---------- 8) RLS ----------
alter table public.prospects enable row level security;
alter table public.outreach_sequences enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.suppression_list enable row level security;

do $$
declare t text;
begin
  foreach t in array array['prospects', 'outreach_sequences'] loop
    execute format('drop policy if exists %I on public.%I;', t || '_org_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (organization_id = public.current_org_id())
         with check (organization_id = public.current_org_id());', t || '_org_all', t);
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;

drop policy if exists outreach_messages_org_select on public.outreach_messages;
drop policy if exists outreach_messages_org_insert on public.outreach_messages;
drop policy if exists outreach_messages_org_update on public.outreach_messages;
drop policy if exists outreach_messages_org_delete on public.outreach_messages;
create policy outreach_messages_org_select on public.outreach_messages for select to authenticated
  using (organization_id = public.current_org_id());
create policy outreach_messages_org_insert on public.outreach_messages for insert to authenticated
  with check (organization_id = public.current_org_id());
create policy outreach_messages_org_update on public.outreach_messages for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
-- Gönderilmiş / gönderimdeki e-posta (kanıt) istemciden silinemez; yanlış girilen manuel temas kaydı geri alınabilir.
-- Aday silinirse hepsi cascade ile gider.
create policy outreach_messages_org_delete on public.outreach_messages for delete to authenticated
  using (organization_id = public.current_org_id() and (manual or status in ('draft', 'approved', 'cancelled')));
revoke all on public.outreach_messages from anon;
grant select, insert, update, delete on public.outreach_messages to authenticated;

drop policy if exists suppression_list_org_select on public.suppression_list;
drop policy if exists suppression_list_org_insert on public.suppression_list;
drop policy if exists suppression_list_admin_delete on public.suppression_list;
create policy suppression_list_org_select on public.suppression_list for select to authenticated
  using (organization_id = public.current_org_id());
create policy suppression_list_org_insert on public.suppression_list for insert to authenticated
  with check (organization_id = public.current_org_id());
-- Ret kaydını yalnızca admin kaldırabilir (kişi ret hakkını kullandıysa kaldırılmamalı).
create policy suppression_list_admin_delete on public.suppression_list for delete to authenticated
  using (organization_id = public.current_org_id() and public.current_role_name() = 'admin');
revoke all on public.suppression_list from anon;
revoke update on public.suppression_list from authenticated;
grant select, insert, delete on public.suppression_list to authenticated;

-- ---------- 9) Ret bağlantısı token'ı ----------
-- token = "<message_id>.<hex(hmac_sha256(message_id::text, unsub_key_hash))>"
-- src/lib/growth/unsubscribe.ts signUnsubToken() ile aynı biçim. Yalnızca definer fonksiyonlar çağırır.
create or replace function public.outreach_unsub_token(p_message_id uuid, p_key text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select p_message_id::text || '.' || encode(hmac(p_message_id::text, p_key, 'sha256'), 'hex');
$$;

revoke all on function public.outreach_unsub_token(uuid, text) from public, anon, authenticated;

-- ---------- 10) Public RPC: outreach_unsubscribe ----------
create or replace function public.outreach_unsubscribe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id  uuid;
  v_key text;
  m     record;
begin
  if p_token is null
     or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  v_id := split_part(p_token, '.', 1)::uuid;

  select om.id, om.organization_id, om.prospect_id, om.to_email
    into m
    from outreach_messages om
   where om.id = v_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select s.unsub_key_hash into v_key from outreach_settings s where s.organization_id = m.organization_id;
  if v_key is null or public.outreach_unsub_token(v_id, v_key) <> p_token then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- İdempotent: tekrar tıklamak aynı sonucu verir.
  if m.to_email is not null then
    insert into suppression_list (organization_id, kind, value, reason, note)
    values (m.organization_id, 'email', lower(m.to_email), 'unsubscribe', 'Ret bağlantısı')
    on conflict (organization_id, kind, value) do nothing;
  end if;

  update outreach_messages om
     set status = 'cancelled', error = 'Alıcı ret bağlantısını kullandı'
   where om.organization_id = m.organization_id
     and om.status in ('draft', 'approved')
     and (om.prospect_id = m.prospect_id or (m.to_email is not null and lower(om.to_email) = lower(m.to_email)));

  update prospects p set status = 'suppressed'
   where p.id = m.prospect_id and p.status not in ('converted');

  return jsonb_build_object('ok', true);
end $$;

comment on function public.outreach_unsubscribe(text) is
  'Tek tıkla ret: HMAC token doğrula → ret listesine ekle → bekleyen mesajları iptal et. SECURITY DEFINER; anon çağırır. Bkz. 0019.';

revoke all on function public.outreach_unsubscribe(text) from public;
grant execute on function public.outreach_unsubscribe(text) to anon, authenticated;

-- ---------- 11) Cron RPC: talep et (claim) ----------
-- Sır: p_token = CRON_SECRET (sunucu env'i); DB'de yalnızca SHA-256'sı. Yalnızca e-posta kanalı, manuel olmayan,
-- scheduled_for'u dolu (gönderim açıkken planlanmış) mesajlar. Hash'i eşleşen HER org için:
--   1) vadesi gelmiş onaylı mesajlardan ret listesindekileri / adayı bastırılmış/yanıt vermiş olanları iptal eder;
--   2) günlük limit: bugün (Europe/Istanbul) gönderilen + bugün talep edilip sonucu beklenen mesajlar sayılır;
--   3) kalan kadar mesajı 'scheduled' (gönderimde) yapar ve gönderim için gerekli alanlarla döndürür.
create or replace function public.outreach_cron_claim(p_token text, p_cap integer, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash  text;
  v_org   uuid;
  v_key   text;
  v_start timestamptz := date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
  v_used  integer;
  v_avail integer;
  v_out   jsonb := '[]'::jsonb;
  v_orgs  jsonb := '[]'::jsonb;
  r       record;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'outreach_cron: yetkisiz' using errcode = '42501';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  if not exists (select 1 from outreach_settings where cron_token_hash = v_hash) then
    raise exception 'outreach_cron: yetkisiz' using errcode = '42501';
  end if;

  for v_org, v_key in
    select s.organization_id, s.unsub_key_hash from outreach_settings s where s.cron_token_hash = v_hash
  loop
    -- Aynı org için eşzamanlı iki cron çalışması limiti aşmasın.
    perform pg_advisory_xact_lock(hashtextextended('outreach_cron|' || v_org::text, 0));

    update outreach_messages om
       set status = 'cancelled', error = 'Ret listesinde / aday durumu uygun değil — gönderilmedi'
     where om.organization_id = v_org
       and om.channel = 'email' and not om.manual
       and om.status = 'approved'
       and om.scheduled_for <= now()
       and (public.outreach_is_suppressed(v_org, om.to_email, null)
            or exists (select 1 from prospects p
                        where p.id = om.prospect_id and p.status in ('suppressed', 'replied', 'converted')));

    select count(*) into v_used
      from outreach_messages om
     where om.organization_id = v_org
       and om.channel = 'email' and not om.manual
       and ((om.sent_at >= v_start) or (om.status = 'scheduled' and om.updated_at >= v_start));

    v_avail := least(greatest(coalesce(p_cap, 20), 0), 500) - v_used;
    v_avail := least(v_avail, greatest(coalesce(p_limit, 50), 0));
    v_orgs := v_orgs || jsonb_build_object('organization_id', v_org, 'used', v_used, 'available', greatest(v_avail, 0));
    continue when v_avail <= 0;

    for r in
      with picked as (
        select om.id
          from outreach_messages om
         where om.organization_id = v_org
           and om.channel = 'email' and not om.manual
           and om.status = 'approved'
           and om.scheduled_for <= now()
           and om.to_email is not null
         order by om.scheduled_for, om.created_at
         limit v_avail
         for update skip locked
      )
      update outreach_messages om
         set status = 'scheduled', error = null
        from picked
       where om.id = picked.id
      returning om.id, om.organization_id, om.prospect_id, om.sequence_id, om.step_no, om.to_email, om.subject, om.body
    loop
      v_out := v_out || jsonb_build_object(
        'id', r.id,
        'organization_id', r.organization_id,
        'prospect_id', r.prospect_id,
        'sequence_id', r.sequence_id,
        'step_no', r.step_no,
        'to_email', r.to_email,
        'subject', r.subject,
        'body', r.body,
        'unsub_token', public.outreach_unsub_token(r.id, v_key),
        'prospect', (select jsonb_build_object('name', p.name, 'sector', p.sector, 'city', p.city,
                                               'district', p.district, 'website', p.website, 'phone', p.phone,
                                               'source', p.source, 'external_id', p.external_id)
                       from prospects p where p.id = r.prospect_id),
        'steps', (select s.steps from outreach_sequences s where s.id = r.sequence_id and s.active)
      );
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'messages', v_out, 'orgs', v_orgs);
end $$;

revoke all on function public.outreach_cron_claim(text, integer, integer) from public;
grant execute on function public.outreach_cron_claim(text, integer, integer) to anon, authenticated;

-- ---------- 12) Cron RPC: sonuç ----------
-- p_result: 'sent' | 'bounced' (kalıcı hata → ret listesine 'bounce') | 'retry' (geçici hata → 1 saat sonra tekrar)
-- p_next  : {step_no, subject, body, scheduled_for} — gönderimden sonra açılacak SONRAKİ ADIM TASLAĞI
--           (onaysız; insan onaylamadan gönderilmez). Hatalıysa yok sayılır, gönderim kaydı yine yazılır.
create or replace function public.outreach_cron_result(
  p_token       text,
  p_message_id  uuid,
  p_result      text,
  p_provider_id text,
  p_error       text,
  p_next        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash    text;
  m         outreach_messages%rowtype;
  v_next_id uuid;
  v_step    integer;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'outreach_cron: yetkisiz' using errcode = '42501';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'utf8')), 'hex');

  select * into m from outreach_messages where id = p_message_id for update;
  if not found or not exists (
    select 1 from outreach_settings s where s.organization_id = m.organization_id and s.cron_token_hash = v_hash
  ) then
    raise exception 'outreach_cron: yetkisiz' using errcode = '42501';
  end if;
  if m.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'not_claimed', 'status', m.status);
  end if;

  if p_result = 'sent' then
    update outreach_messages
       set status = 'sent', sent_at = now(), provider_message_id = left(p_provider_id, 300), error = null
     where id = m.id;
    -- adayın durumu / son temas zamanı: outreach_messages_touch_prospect trigger'ı

    if p_next is not null and jsonb_typeof(p_next) = 'object' and m.sequence_id is not null then
      begin
        v_step := (p_next ->> 'step_no')::integer;
        if v_step > m.step_no then
          insert into outreach_messages (
            organization_id, prospect_id, sequence_id, step_no, channel, to_email, subject, body, status, scheduled_for
          ) values (
            m.organization_id, m.prospect_id, m.sequence_id, v_step, 'email', m.to_email,
            left(coalesce(p_next ->> 'subject', ''), 300), left(coalesce(p_next ->> 'body', ''), 10000),
            'draft', (p_next ->> 'scheduled_for')::timestamptz
          )
          on conflict do nothing
          returning id into v_next_id;
        end if;
      exception when others then
        v_next_id := null; -- taslak açılamadı; gönderim kaydı korunur
      end;
    end if;
  elsif p_result = 'bounced' then
    update outreach_messages set status = 'bounced', error = left(coalesce(p_error, 'Kalıcı teslim hatası'), 1000)
     where id = m.id;
    if m.to_email is not null then
      insert into suppression_list (organization_id, kind, value, reason, note)
      values (m.organization_id, 'email', lower(m.to_email), 'bounce', left(p_error, 500))
      on conflict (organization_id, kind, value) do nothing;
    end if;
  elsif p_result = 'retry' then
    update outreach_messages
       set status = 'approved', error = left(coalesce(p_error, 'Geçici hata'), 1000), scheduled_for = now() + interval '1 hour'
     where id = m.id;
  else
    raise exception 'outreach_cron: geçersiz sonuç' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'next_id', v_next_id);
end $$;

revoke all on function public.outreach_cron_result(text, uuid, text, text, text, jsonb) from public;
grant execute on function public.outreach_cron_result(text, uuid, text, text, text, jsonb) to anon, authenticated;

-- ---------- 12b) Places lat/lng temizliği (≤30 gün) ----------
-- Google Maps Platform Şartları 3.2.3(a): lat/lng en fazla 30 gün tutulabilir. Cron (CRON_SECRET) her
-- çalışmada çağırır; e-posta bayrağından bağımsızdır. Dönüş: temizlenen satır sayısı.
create or replace function public.outreach_places_purge(p_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_n    integer;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'outreach_cron: yetkisiz' using errcode = '42501';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'utf8')), 'hex');
  if not exists (select 1 from outreach_settings where cron_token_hash = v_hash) then
    raise exception 'outreach_cron: yetkisiz' using errcode = '42501';
  end if;
  update prospects p
     set lat = null, lng = null, places_cached_at = null
   where p.organization_id in (select organization_id from outreach_settings where cron_token_hash = v_hash)
     and p.places_cached_at is not null
     and p.places_cached_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.outreach_places_purge(text) from public;
grant execute on function public.outreach_places_purge(text) to anon, authenticated;

-- ---------- 13) İşlem geçmişi (0012) ----------
-- prospects'e BİLEREK bağlanmaz: log_activity() diff'i lat/lng'yi activity_logs'a süresiz kopyalardı
-- (Places Şartları: lat/lng ≤30 gün). Aday durum değişimleri temas geçmişinde (outreach_messages) izlenir.
drop trigger if exists prospects_activity_log on public.prospects;
do $$
declare t text;
begin
  if to_regprocedure('public.log_activity()') is null then
    raise notice '0019: public.log_activity() yok, trigger atlandı (önce 0012 uygulanmalı)';
    return;
  end if;
  foreach t in array array['outreach_sequences', 'outreach_messages', 'suppression_list'] loop
    execute format('drop trigger if exists %I on public.%I;', t || '_activity_log', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.log_activity();',
      t || '_activity_log', t);
  end loop;
end $$;
