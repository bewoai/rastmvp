-- =====================================================================
-- Rast OS — Migration 0015: Aylık müşteri raporu + teklif → proje bağı
--
-- 1) client_reports : müşteri başına aylık rapor kaydı (Hekim İçerik Sistemi'nin
--    "ay sonunda sade bir rapor" sözü). Rapordaki SAYILAR veritabanında
--    saklanmaz — içerik / çekim / onay tablolarından her açılışta hesaplanır.
--    Burada yalnızca ajansın elle yazdığı kısımlar tutulur:
--      period      : raporun ayı (her zaman ayın 1'i)
--      notes       : serbest metin "Notlar" bölümü
--      highlights  : jsonb nesne {
--                      "points":   ["öne çıkan 1", …]   (madde listesi),
--                      "ads_note": "Reklam / GİP notları" (serbest metin)
--                    }
--                    Reklam metriği (gösterim, tıklama vb.) BİLEREK yok — hekim
--                    müşterilerinde performans iddiası yazılmaz.
--      generated_at: raporun son kaydedildiği / üretildiği an
--    (organization_id, client_id, period) tekil: bir müşterinin bir ayı için tek rapor.
--
-- 2) projects.proposal_id : kabul edilen tekliften oluşturulan proje (Teklif →
--    "Projeye dönüştür"). Teklif başına en fazla bir proje (kısmi tekil indeks);
--    uygulama bu bağ varsa yeni proje açmaz, mevcut projeyi gösterir (idempotent).
--    Teklif silinirse yalnızca proposal_id boşalır, proje kalır.
--
-- RLS: client_reports org kapsamlı (organization_id = current_org_id()), yalnız
-- authenticated; anon'un hiçbir yetkisi yok. projects politikası (0001) değişmez.
--
-- Postgres 15+ gerekir ("on delete set null (proposal_id)"; 0013 ile aynı şart).
-- Idempotent. NOT applied to any environment yet — see README-0015.md.
-- Apply AFTER 0014 (0011 proposals ve 0012 log_activity()'ye dayanır).
-- =====================================================================

-- ---------- clients: bileşik FK hedefi (rapor ↔ müşteri aynı org) ----------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_id_org_unique' and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_id_org_unique unique (id, organization_id);
  end if;
end $$;

-- ---------- client_reports ----------
create table if not exists public.client_reports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null,
  period          date not null,
  notes           text,
  highlights      jsonb not null default '{}'::jsonb,
  generated_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint client_reports_period_first_day
    check (period = date_trunc('month', period)::date),
  constraint client_reports_highlights_object
    check (jsonb_typeof(highlights) = 'object'),
  constraint client_reports_notes_len
    check (notes is null or char_length(notes) <= 10000),
  constraint client_reports_org_client_period_unique
    unique (organization_id, client_id, period),
  -- Rapor, bağlı olduğu müşteriyle AYNI organizasyonda; müşteri silinirse raporları da silinir.
  constraint client_reports_client_fk
    foreign key (client_id, organization_id)
    references public.clients(id, organization_id)
    on delete cascade
);

create index if not exists idx_client_reports_org on public.client_reports(organization_id);
create index if not exists idx_client_reports_client_period on public.client_reports(client_id, period desc);

drop trigger if exists client_reports_set_updated_at on public.client_reports;
create trigger client_reports_set_updated_at
  before update on public.client_reports
  for each row execute function public.set_updated_at();

alter table public.client_reports enable row level security;

drop policy if exists client_reports_org_all on public.client_reports;
create policy client_reports_org_all on public.client_reports for all
  to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

revoke all on public.client_reports from anon;
grant select, insert, update, delete on public.client_reports to authenticated;

-- ---------- projects.proposal_id ----------
alter table public.projects
  add column if not exists proposal_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_proposal_fk' and conrelid = 'public.projects'::regclass
  ) then
    -- Proje ve teklif AYNI organizasyonda (proposals_id_org_unique, 0011).
    -- Teklif silinince yalnızca proposal_id boşalır (organization_id korunur).
    alter table public.projects
      add constraint projects_proposal_fk
      foreign key (proposal_id, organization_id)
      references public.proposals(id, organization_id)
      on delete set null (proposal_id);
  end if;
end $$;

-- Teklif başına en fazla bir proje ("Projeye dönüştür" iki kez çalışsa da ikinci proje oluşmaz).
create unique index if not exists projects_proposal_unique
  on public.projects(proposal_id) where proposal_id is not null;

-- ---------- İşlem geçmişi (0012) ----------
do $$
begin
  if to_regprocedure('public.log_activity()') is null then
    raise notice '0015: public.log_activity() yok, trigger atlandı (önce 0012 uygulanmalı)';
    return;
  end if;
  drop trigger if exists client_reports_activity_log on public.client_reports;
  create trigger client_reports_activity_log
    after insert or update or delete on public.client_reports
    for each row execute function public.log_activity();
end $$;
