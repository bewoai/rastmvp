-- =====================================================================
-- Rast OS — Migration 0002
-- Tekil İşler (jobs) tablosu + uygulama-DB kolon uyumları
-- =====================================================================

-- Uygulama serbest-metin alanları (MVP: kişi seçici yerine metin)
alter table brands   add column if not exists instagram text;
alter table projects add column if not exists owner text;
alter table tasks    add column if not exists assignee text;

-- equipment.assigned_to: uuid FK -> serbest metin
alter table equipment drop column if exists assigned_to;
alter table equipment add column if not exists assigned_to text;

-- ---------- Tekil İşler ----------
do $$ begin
  create type job_status as enum ('quote','confirmed','in_progress','delivered','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('unpaid','partial','paid');
exception when duplicate_object then null; end $$;

create table if not exists jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_name   text not null,
  contact         text,
  service         text,
  job_type        text,
  date            date,
  price           numeric(14,2) not null default 0,
  cost            numeric(14,2),
  paid_amount     numeric(14,2) not null default 0,
  status          job_status not null default 'quote',
  payment_status  payment_status not null default 'unpaid',
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_jobs_org on jobs(organization_id);

alter table jobs enable row level security;
drop policy if exists jobs_org_all on jobs;
create policy jobs_org_all on jobs for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
