-- =====================================================================
-- Rast OS — Migration 0018: Müşteri portalı (client_portal_tokens)
--
-- Hekim / müşteri, giriş yapmadan gizli bir bağlantıyla (/portal/<token>)
-- kendi hesabının salt okunur özetini görür: bu ay ve geçen ayın içerikleri
-- (durum + onay durumu; bekleyen onay için /onay/<token> bağlantısı), çekim
-- günleri, son aylık rapor ve rapor yazdırma görünümü.
--
--   client_portal_tokens : müşteri başına bir veya daha çok portal bağlantısı
--     token        : 64 hex karakter (gen_random_bytes(32) = 256 bit),
--                    YALNIZCA sunucuda üretilir (istemci değeri yok sayılır)
--     label        : iç not ("Dr. Kemal — WhatsApp"); portalda GÖSTERİLMEZ
--     contact_line : portalın altındaki ajans iletişim satırı (boşsa
--                    "<org adı> · <oluşturan kişinin adı>")
--     revoked_at   : iptal anı (iptal geri alınamaz; yeni bağlantı oluşturulur)
--     last_seen_at : portalın son açılışı (portal_touch, en sık 5 dakikada bir)
--     expires_at   : isteğe bağlı son geçerlilik (null = süresiz)
--
-- Erişim:
--   * Org üyeleri (RLS, current_org_id()): okur, oluşturur, label /
--     contact_line / expires_at değiştirir, iptal eder (revoked_at), siler.
--     token, müşteri, oluşturan, last_seen_at istemciden değiştirilemez
--     (guard trigger).
--   * Anonim: tabloya hiç erişemez. Yalnızca üç SECURITY DEFINER RPC:
--       portal_get(p_token)                 → portal özeti (jsonb) ya da null
--       portal_touch(p_token)               → last_seen_at günceller
--       portal_report_get(p_token, p_period)→ kayıtlı aylık raporun verisi ya da null
--     İptal edilmiş / süresi dolmuş / bulunamayan token için hepsi null döner
--     (neden ayırt edilmez). Hiçbiri iç id, IP, iç not veya başka müşterinin
--     verisini döndürmez.
--
-- Token üretimi 0013'teki public.approval_new_token() ile yapılır (aynı
-- 256 bit / pgcrypto deseni). Saat dilimi: ay sınırları Europe/Istanbul.
--
-- Idempotent. NOT applied to any environment yet — see README-0018.md.
-- Apply AFTER 0017 (0013 approval_new_token + content_approvals, 0015
-- clients_id_org_unique + client_reports, 0012 log_activity()'ye dayanır).
-- =====================================================================

-- ---------- Ön koşul kontrolü ----------
do $$
begin
  if to_regprocedure('public.approval_new_token()') is null then
    raise exception '0018: public.approval_new_token() yok — önce 0013 uygulanmalı';
  end if;
  if to_regclass('public.client_reports') is null then
    raise exception '0018: public.client_reports yok — önce 0015 uygulanmalı';
  end if;
end $$;

-- ---------- client_portal_tokens ----------
create table if not exists public.client_portal_tokens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null,
  token           text not null default public.approval_new_token(),
  label           text,
  contact_line    text,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  last_seen_at    timestamptz,
  expires_at      timestamptz,
  constraint client_portal_tokens_token_unique unique (token),
  constraint client_portal_tokens_token_format check (token ~ '^[0-9a-f]{64}$'),
  constraint client_portal_tokens_label_len check (label is null or char_length(label) <= 120),
  constraint client_portal_tokens_contact_len check (contact_line is null or char_length(contact_line) <= 200),
  -- Bağlantı, müşteriyle AYNI organizasyonda (clients_id_org_unique, 0015); müşteri silinirse bağlantıları da silinir.
  constraint client_portal_tokens_client_fk
    foreign key (client_id, organization_id)
    references public.clients(id, organization_id)
    on delete cascade
);

create index if not exists idx_client_portal_tokens_org on public.client_portal_tokens(organization_id);
create index if not exists idx_client_portal_tokens_client on public.client_portal_tokens(client_id, created_at desc);

-- ---------- Guard trigger: istemci rolleri için bütünlük kuralları ----------
-- SECURITY DEFINER RPC'ler (portal_touch) sahibi olarak çalışır ve muaftır.
create or replace function public.client_portal_tokens_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mutable constant text[] := array['label', 'contact_line', 'revoked_at', 'expires_at'];
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Sunucu tarafı değerler: istemcinin gönderdiği token / tarih / oluşturan yok sayılır.
    new.token        := public.approval_new_token();
    new.created_by   := auth.uid();
    new.created_at   := now();
    new.revoked_at   := null;
    new.last_seen_at := null;
    return new;
  end if;

  -- UPDATE: yalnızca label, contact_line, expires_at ve iptal (revoked_at null → dolu).
  if (to_jsonb(new) - v_mutable) <> (to_jsonb(old) - v_mutable) then
    raise exception 'client_portal_tokens: yalnızca etiket, iletişim satırı, son geçerlilik ve iptal değiştirilebilir'
      using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'client_portal_tokens: iptal edilen bağlantı geri açılamaz; yeni bağlantı oluşturun'
      using errcode = '42501';
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    new.revoked_at := now();
  end if;
  return new;
end $$;

revoke all on function public.client_portal_tokens_guard() from public, anon, authenticated;

drop trigger if exists client_portal_tokens_guard on public.client_portal_tokens;
create trigger client_portal_tokens_guard
  before insert or update on public.client_portal_tokens
  for each row execute function public.client_portal_tokens_guard();

-- ---------- RLS ----------
alter table public.client_portal_tokens enable row level security;

drop policy if exists client_portal_tokens_org_all on public.client_portal_tokens;
create policy client_portal_tokens_org_all on public.client_portal_tokens for all
  to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

revoke all on public.client_portal_tokens from anon;
grant select, insert, update, delete on public.client_portal_tokens to authenticated;

-- ---------- İç yardımcı: geçerli token satırı ----------
-- Yalnızca bu dosyadaki RPC'ler kullanır; anon / authenticated çağıramaz.
create or replace function public.portal_active_token(p_token text)
returns public.client_portal_tokens
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.client_portal_tokens t
  where p_token is not null
    and p_token ~ '^[0-9a-f]{64}$'
    and t.token = p_token
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now());
$$;

revoke all on function public.portal_active_token(text) from public, anon, authenticated;

-- ---------- Public RPC: portal_get ----------
-- Bu ay + geçen ay (Europe/Istanbul). İçerik tarihi: yayınlandıysa yayın tarihi
-- (yoksa planlanan), değilse planlanan (src/lib/report-logic.ts ile aynı kural).
-- Onay bağlantısı (approval.token) YALNIZCA en son sürüm etkin olarak "pending"
-- ise döner (süresi dolan / geri çekilen / karara bağlanan için null).
-- pending: müşterinin onay bekleyen TÜM içerikleri (ay sınırı yok).
-- Uygulamadaki ayna: src/lib/portal-logic.ts → buildPortalPayload (demo + testler).
create or replace function public.portal_get(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t       public.client_portal_tokens%rowtype;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_cur   date := date_trunc('month', (now() at time zone 'Europe/Istanbul'))::date;
  v_prev  date;
  v_next  date;
  v_out   jsonb;
begin
  select * into t from public.portal_active_token(p_token);
  if t.id is null then
    return null;
  end if;

  v_prev := (v_cur - interval '1 month')::date;
  v_next := (v_cur + interval '1 month')::date;

  with own as (
    select co.id, co.title, co.platform, co.content_type, co.status::text as status,
           case when co.status::text = 'published'
                then coalesce(co.published_date, co.planned_date)
                else co.planned_date end as day
    from public.contents co
    where co.organization_id = t.organization_id
      and co.client_id = t.client_id
      and co.status::text <> 'archived'
  ),
  latest as (
    select distinct on (a.content_id)
           a.content_id, a.version, a.title, a.token, a.expires_at,
           case when a.status = 'pending' and a.expires_at <= now() then 'expired' else a.status end as eff
    from public.content_approvals a
    where a.organization_id = t.organization_id
      and a.content_id in (select id from own)
    order by a.content_id, a.version desc
  ),
  all_rows as (
    select o.*, l.version as a_version, l.eff as a_status, l.title as a_title,
           case when l.eff = 'pending' then l.token end as a_token,
           case when l.eff = 'pending' then l.expires_at end as a_expires
    from own o
    left join latest l on l.content_id = o.id
  )
  select jsonb_build_object(
    'client_name',  cl.name,
    'agency_name',  o.name,
    'contact_line', coalesce(nullif(btrim(t.contact_line), ''), concat_ws(' · ', o.name, nullif(btrim(p.full_name), ''))),
    'today',        to_char(v_today, 'YYYY-MM-DD'),
    'months',       jsonb_build_object('current', to_char(v_cur, 'YYYY-MM'), 'previous', to_char(v_prev, 'YYYY-MM')),
    'contents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date',    to_char(r.day, 'YYYY-MM-DD'),
               'month',   to_char(r.day, 'YYYY-MM'),
               'title',   r.title,
               'channel', concat_ws(' · ', nullif(btrim(r.platform), ''), nullif(btrim(r.content_type), '')),
               'status',  r.status,
               'approval', case when r.a_version is null then null else jsonb_build_object(
                             'version',    r.a_version,
                             'status',     r.a_status,
                             'token',      r.a_token,
                             'expires_at', r.a_expires) end
             ) order by r.day, r.title)
      from all_rows r
      where r.day >= v_prev and r.day < v_next
    ), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title',      coalesce(nullif(r.a_title, ''), r.title),
               'version',    r.a_version,
               'token',      r.a_token,
               'expires_at', r.a_expires,
               'date',       to_char(r.day, 'YYYY-MM-DD')
             ) order by r.a_expires, r.title)
      from all_rows r
      where r.a_status = 'pending'
    ), '[]'::jsonb),
    'pending_count', (select count(*) from all_rows r where r.a_status = 'pending'),
    'shoots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date',     to_char(s.scheduled_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD'),
               'time',     to_char(s.scheduled_at at time zone 'Europe/Istanbul', 'HH24:MI'),
               'type',     s.shoot_type,
               'location', s.location,
               'status',   s.status::text
             ) order by s.scheduled_at)
      from public.shoots s
      where s.organization_id = t.organization_id
        and s.client_id = t.client_id
        and s.status::text <> 'cancelled'
        and s.scheduled_at is not null
        and (s.scheduled_at at time zone 'Europe/Istanbul')::date >= v_prev
        and (s.scheduled_at at time zone 'Europe/Istanbul')::date < v_next
    ), '[]'::jsonb),
    'latest_report', (
      select jsonb_build_object(
               'month',        to_char(cr.period, 'YYYY-MM'),
               'notes',        cr.notes,
               'highlights',   cr.highlights,
               'generated_at', cr.generated_at)
      from public.client_reports cr
      where cr.organization_id = t.organization_id
        and cr.client_id = t.client_id
        and cr.period <= v_cur
      order by cr.period desc
      limit 1
    )
  )
  into v_out
  from public.clients cl
  join public.organizations o on o.id = cl.organization_id
  left join public.profiles p on p.id = t.created_by
  where cl.id = t.client_id and cl.organization_id = t.organization_id;

  return v_out;
end $$;

-- Supabase'in varsayılan yetkileri yeni fonksiyonu authenticated'a da açar;
-- "yalnız anon" niyeti için authenticated'dan da açıkça geri alınır (db-check).
revoke all on function public.portal_get(text) from public, authenticated;
grant execute on function public.portal_get(text) to anon;

-- ---------- Public RPC: portal_touch ----------
-- last_seen_at'i günceller (en sık 5 dakikada bir; her yenilemede yazmaz).
-- Geçersiz / iptal / süresi dolmuş token için hiçbir şey yapmaz.
create or replace function public.portal_touch(p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  update public.client_portal_tokens
     set last_seen_at = now()
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
     and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
end $$;

revoke all on function public.portal_touch(text) from public, authenticated;
grant execute on function public.portal_touch(text) to anon;

-- ---------- Public RPC: portal_report_get ----------
-- p_period: 'YYYY-MM'. Yalnızca o ay için KAYITLI bir client_reports satırı
-- varsa veri döner (ajans "raporu kaydet"medikçe ay paylaşılmaz); yoksa null.
-- Dönen içerik / çekim / onay listesi rapor ayının bir üst kümesidir; kesin
-- ay süzgeci uygulamada buildMonthlyReport (src/lib/report-logic.ts) ile yapılır.
-- Zaman damgaları Europe/Istanbul duvar saati olarak ('YYYY-MM-DD"T"HH24:MI')
-- döner (sunucu saat diliminden bağımsız gün hesabı); expires_at gerçek an.
-- Onay token'ı, IP, iç id DÖNMEZ.
create or replace function public.portal_report_get(p_token text, p_period text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t        public.client_portal_tokens%rowtype;
  r        public.client_reports%rowtype;
  v_start  date;
  v_end    date;
  v_end2   date;
  v_out    jsonb;
begin
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return null;
  end if;

  select * into t from public.portal_active_token(p_token);
  if t.id is null then
    return null;
  end if;

  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_end   := (v_start + interval '1 month')::date;
  v_end2  := (v_start + interval '2 months')::date;

  select * into r from public.client_reports
   where organization_id = t.organization_id and client_id = t.client_id and period = v_start;
  if not found then
    return null;
  end if;

  with own as (
    select co.*
    from public.contents co
    where co.organization_id = t.organization_id
      and co.client_id = t.client_id
      and (
        (co.planned_date >= v_start and co.planned_date < v_end2)
        or (co.published_date >= v_start and co.published_date < v_end)
        or exists (
          select 1 from public.content_approvals a
          where a.content_id = co.id and a.organization_id = t.organization_id
            and (
              ((a.sent_at at time zone 'Europe/Istanbul')::date >= v_start and (a.sent_at at time zone 'Europe/Istanbul')::date < v_end)
              or ((a.decided_at at time zone 'Europe/Istanbul')::date >= v_start and (a.decided_at at time zone 'Europe/Istanbul')::date < v_end)
            )
        )
      )
  )
  select jsonb_build_object(
    'client_name', cl.name,
    'agency_name', o.name,
    'brand_names', coalesce((
      select jsonb_agg(b.name order by b.name)
      from public.brands b
      where b.client_id = t.client_id and b.organization_id = t.organization_id
    ), '[]'::jsonb),
    'month', p_period,
    'report', jsonb_build_object(
      'notes',        r.notes,
      'highlights',   r.highlights,
      'generated_at', to_char(r.generated_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD"T"HH24:MI')
    ),
    'contents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title',          c.title,
               'platform',       c.platform,
               'content_type',   c.content_type,
               'status',         c.status::text,
               'planned_date',   to_char(c.planned_date, 'YYYY-MM-DD'),
               'published_date', to_char(c.published_date, 'YYYY-MM-DD'),
               'approvals', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'version',         a.version,
                          'title',           a.title,
                          'status',          a.status,
                          'sent_at',         to_char(a.sent_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD"T"HH24:MI'),
                          'expires_at',      a.expires_at,
                          'decided_at',      to_char(a.decided_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD"T"HH24:MI'),
                          'decided_by_name', a.decided_by_name,
                          'checklist',       a.checklist
                        ) order by a.version)
                 from public.content_approvals a
                 where a.content_id = c.id and a.organization_id = t.organization_id
               ), '[]'::jsonb)
             ) order by c.planned_date nulls last, c.title)
      from own c
    ), '[]'::jsonb),
    'shoots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title',        s.title,
               'shoot_type',   s.shoot_type,
               'scheduled_at', to_char(s.scheduled_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD"T"HH24:MI'),
               'location',     s.location,
               'status',       s.status::text
             ) order by s.scheduled_at)
      from public.shoots s
      where s.organization_id = t.organization_id
        and s.client_id = t.client_id
        and s.scheduled_at is not null
        and (s.scheduled_at at time zone 'Europe/Istanbul')::date >= v_start
        and (s.scheduled_at at time zone 'Europe/Istanbul')::date < v_end
    ), '[]'::jsonb)
  )
  into v_out
  from public.clients cl
  join public.organizations o on o.id = cl.organization_id
  where cl.id = t.client_id and cl.organization_id = t.organization_id;

  return v_out;
end $$;

revoke all on function public.portal_report_get(text, text) from public, authenticated;
grant execute on function public.portal_report_get(text, text) to anon;

-- ---------- İşlem geçmişi (0012) ----------
-- last_seen_at güncellemeleri (portal_touch) log üretmesin diye UPDATE yalnızca
-- anlamlı kolonlarda izlenir.
do $$
begin
  if to_regprocedure('public.log_activity()') is null then
    raise notice '0018: public.log_activity() yok, trigger atlandı (önce 0012 uygulanmalı)';
    return;
  end if;
  drop trigger if exists client_portal_tokens_activity_log on public.client_portal_tokens;
  create trigger client_portal_tokens_activity_log
    after insert or delete or update of label, contact_line, revoked_at, expires_at
    on public.client_portal_tokens
    for each row execute function public.log_activity();
end $$;
