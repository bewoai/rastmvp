-- =====================================================================
-- Rast OS — Migration 0011: Teklifler (proposals + proposal_items)
--
-- Kapsam → fiyat → markalı PDF akışı için teklif başlığı ve kalemleri.
--   proposals       : teklif başlığı (müşteri, no, durum, KDV, geçerlilik,
--                     süreç/takvim notu, koşullar)
--   proposal_items  : teklif kalemleri (sıra, ad, açıklama, miktar, birim,
--                     birim fiyat, aylık mı / tek seferlik mi)
--
-- proposal_no uygulamada üretilir (RC-YYYY-NNN, org + yıl bazında artan);
-- veritabanı yalnızca org içinde tekilliği garanti eder.
--
-- proposal_items da organization_id taşır: uygulamanın ortak store'u her
-- satıra organization_id yazar ve RLS diğer tablolarla birebir aynı kalır.
-- (proposal_id, organization_id) bileşik FK'si, kalemin bağlı olduğu teklifle
-- AYNI organizasyonda olmasını şart koşar ve teklif silinince kalemleri siler.
--
-- RLS: 0001'deki org kapsamlı politika ile aynı (<tablo>_org_all,
-- organization_id = current_org_id()).
--
-- Idempotent. NOT applied to any environment yet — see README-0011.md.
-- Apply AFTER 0010.
-- =====================================================================

-- ---------- updated_at yardımcı trigger fonksiyonu ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------- proposals ----------
create table if not exists public.proposals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  title           text not null,
  proposal_no     text not null,
  status          text not null default 'draft',
  currency        text not null default 'TRY',
  vat_rate        numeric(5,2) not null default 20,
  valid_until     date,
  notes           text,
  terms           text,
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint proposals_status_check
    check (status in ('draft','sent','accepted','rejected','expired')),
  constraint proposals_currency_check
    check (currency in ('TRY','USD','EUR')),
  constraint proposals_vat_rate_check
    check (vat_rate >= 0 and vat_rate <= 100),
  constraint proposals_title_not_blank
    check (btrim(title) <> ''),
  constraint proposals_no_not_blank
    check (btrim(proposal_no) <> ''),
  -- Teklif no organizasyon içinde tekil (RC-2026-001 her org'da ayrı başlar)
  constraint proposals_org_no_unique unique (organization_id, proposal_no),
  -- proposal_items bileşik FK hedefi (kalem ↔ teklif aynı org)
  constraint proposals_id_org_unique unique (id, organization_id)
);

create index if not exists idx_proposals_org on public.proposals(organization_id);
create index if not exists idx_proposals_client on public.proposals(client_id);

drop trigger if exists proposals_set_updated_at on public.proposals;
create trigger proposals_set_updated_at
  before update on public.proposals
  for each row execute function public.set_updated_at();

-- ---------- proposal_items ----------
create table if not exists public.proposal_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id     uuid not null,
  position        int not null default 0,
  name            text not null,
  description     text,
  qty             numeric(12,2) not null default 1,
  unit            text not null default 'ay',
  unit_price      numeric(14,2) not null default 0,
  is_recurring    boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint proposal_items_qty_check check (qty >= 0),
  constraint proposal_items_proposal_fk
    foreign key (proposal_id, organization_id)
    references public.proposals(id, organization_id)
    on delete cascade
);

create index if not exists idx_proposal_items_proposal on public.proposal_items(proposal_id, position);
create index if not exists idx_proposal_items_org on public.proposal_items(organization_id);

-- ---------- RLS (0001 org kapsamlı politika ile aynı) ----------
do $$
declare t text;
begin
  foreach t in array array['proposals','proposal_items'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_org_all on public.%I;', t, t);
    execute format(
      'create policy %I_org_all on public.%I for all
         using (organization_id = current_org_id())
         with check (organization_id = current_org_id());', t, t);
  end loop;
end $$;
