-- =====================================================================
-- Rast Creative — Ajans Operasyon Sistemi
-- Migration 0001: Çekirdek şema (MVP)
-- Çok-kiracıya hazır (organization_id), RLS + rol bazlı erişim.
-- Supabase SQL editöründe çalıştırın.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- ENUM tipleri ----------
do $$ begin
  create type user_role as enum ('admin','manager','editor','accountant','client');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_status as enum
    ('new','contacted','needs_assessment','proposal_prep','proposal_sent',
     'awaiting_reply','revision','won','lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum
    ('planning','active','on_hold','review','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum
    ('todo','in_progress','internal_review','client_review','revision','done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type content_status as enum
    ('idea','brief','script_ready','awaiting_shoot','shot','editing',
     'internal_review','sent_to_client','revision_requested','approved',
     'scheduled','published','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type shoot_status as enum ('planned','confirmed','shooting','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type equipment_status as enum
    ('planned','idle','reserved','in_use','assigned','maintenance','broken','lost','sold');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum
    ('draft','issued','partial','paid','overdue','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type priority as enum ('low','medium','high','urgent');
exception when duplicate_object then null; end $$;

-- ---------- Organizasyon & Kullanıcılar ----------
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Supabase auth.users ile 1-1. Rol ve org bilgisi burada.
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  full_name       text,
  role            user_role not null default 'editor',
  avatar_url      text,
  phone           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------- CRM: Leads / Clients / Brands / Contacts ----------
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  company_name    text not null,
  contact_person  text,
  phone           text,
  email           text,
  instagram       text,
  website         text,
  source          text,               -- referans, instagram, web, reklam, linkedin, organik
  interested_in   text,
  est_budget      numeric(14,2),
  notes           text,
  status          lead_status not null default 'new',
  last_contact_at date,
  next_followup_at date,
  lost_reason     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  tax_id          text,
  tax_office      text,
  billing_address text,
  monthly_fee     numeric(14,2),
  contract_start  date,
  contract_end    date,
  payment_day     int,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists brands (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  name            text not null,
  logo_url        text,
  color_palette   text,
  fonts           text,
  tone            text,
  banned_phrases  text,
  target_audience text,
  socials         jsonb default '{}'::jsonb,
  website         text,
  content_categories text,
  hashtag_groups  text,
  competitors     text,
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id       uuid references clients(id) on delete cascade,
  full_name       text not null,
  title           text,
  phone           text,
  email           text,
  is_approver     boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now()
);

-- ---------- Hizmet paketleri ----------
create table if not exists service_packages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id       uuid references clients(id) on delete cascade,
  name            text not null,
  monthly_price   numeric(14,2),
  reels_quota     int default 0,
  story_quota     int default 0,
  shoot_days_quota int default 0,
  revision_quota  int default 0,
  extras          jsonb default '{}'::jsonb,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------- Projeler & Görevler ----------
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  brand_id        uuid references brands(id) on delete set null,
  name            text not null,
  type            text,
  owner_id        uuid references profiles(id) on delete set null,
  start_date      date,
  end_date        date,
  budget          numeric(14,2),
  est_cost        numeric(14,2),
  status          project_status not null default 'planning',
  priority        priority not null default 'medium',
  notes           text,
  drive_url       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id      uuid references projects(id) on delete cascade,
  content_id      uuid,
  title           text not null,
  assignee_id     uuid references profiles(id) on delete set null,
  due_date        date,
  priority        priority not null default 'medium',
  status          task_status not null default 'todo',
  checklist       jsonb default '[]'::jsonb,
  drive_url       text,
  est_hours       numeric(6,2),
  actual_hours    numeric(6,2),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- İçerik ----------
create table if not exists contents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  brand_id        uuid references brands(id) on delete set null,
  project_id      uuid references projects(id) on delete set null,
  title           text not null,
  platform        text,             -- instagram, tiktok, youtube...
  content_type    text,             -- reels, post, story...
  category        text,
  goal            text,
  hook            text,
  script          text,
  caption         text,
  cta             text,
  music           text,
  references_url  text,
  asset_url       text,
  cover_url       text,
  status          content_status not null default 'idea',
  revision_count  int not null default 0,
  approved_by     uuid references contacts(id) on delete set null,
  planned_date    date,
  published_date  date,
  content_link    text,
  portfolio_ok    boolean,
  attachments     jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table tasks
  drop constraint if exists tasks_content_fk,
  add constraint tasks_content_fk
    foreign key (content_id) references contents(id) on delete set null;

-- ---------- Prodüksiyon / Çekimler ----------
create table if not exists shoots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  brand_id        uuid references brands(id) on delete set null,
  project_id      uuid references projects(id) on delete set null,
  title           text not null,
  shoot_type      text,
  scheduled_at    timestamptz,
  location        text,
  crew            jsonb default '[]'::jsonb,
  contact_person  text,
  shot_list       jsonb default '[]'::jsonb,
  checklist       jsonb default '[]'::jsonb,
  status          shoot_status not null default 'planned',
  notes           text,
  created_at      timestamptz not null default now()
);

-- ---------- Ekipman & Envanter ----------
create table if not exists equipment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  brand_model     text,
  serial_no       text,
  category        text,             -- kamera, lens, ışık, ses...
  purchase_date   date,
  purchase_price  numeric(14,2),
  warranty_end    date,
  location        text,
  status          equipment_status not null default 'idle',
  assigned_to     uuid references profiles(id) on delete set null,
  last_service    date,
  next_service    date,
  notes           text,
  photo_url       text,
  created_at      timestamptz not null default now()
);

create table if not exists equipment_bookings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  equipment_id    uuid not null references equipment(id) on delete cascade,
  shoot_id        uuid references shoots(id) on delete cascade,
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  created_at      timestamptz not null default now()
);

-- ---------- Finans ----------
create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  project_id      uuid references projects(id) on delete set null,
  invoice_no      text,
  issue_date      date,
  due_date        date,
  amount          numeric(14,2) not null default 0,
  vat             numeric(14,2) not null default 0,
  paid_amount     numeric(14,2) not null default 0,
  status          invoice_status not null default 'draft',
  file_url        text,
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id      uuid references invoices(id) on delete cascade,
  amount          numeric(14,2) not null,
  method          text,
  paid_at         date not null default current_date,
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists expenses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  category        text,
  vendor          text,
  project_id      uuid references projects(id) on delete set null,
  client_id       uuid references clients(id) on delete set null,
  amount          numeric(14,2) not null default 0,
  vat             numeric(14,2) not null default 0,
  currency        text not null default 'TRY' check (currency in ('TRY', 'USD', 'EUR')),
  paid_at         date,
  method          text,
  payment_status  text not null default 'paid' check (payment_status in ('paid', 'pending')),
  installment_number smallint check (installment_number is null or installment_number > 0),
  installment_total  smallint check (installment_total is null or installment_total > 0),
  is_recurring    boolean not null default false,
  receipt_url     text,
  description     text,
  created_at      timestamptz not null default now()
);

-- ---------- Dosyalar ----------
create table if not exists files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  project_id      uuid references projects(id) on delete set null,
  label           text,
  url             text not null,     -- Drive/Dropbox/NAS bağlantısı
  kind            text,              -- brief, raw, export, approved, archive
  owner_id        uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ---------- Bildirimler & İşlem geçmişi ----------
create table if not exists notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid references profiles(id) on delete cascade,
  title           text not null,
  body            text,
  link            text,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now()
);

create table if not exists activity_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_id        uuid references profiles(id) on delete set null,
  entity          text not null,
  entity_id       uuid,
  action          text not null,     -- create, update, delete
  diff            jsonb,
  created_at      timestamptz not null default now()
);

-- ---------- İndeksler ----------
create index if not exists idx_leads_org on leads(organization_id);
create index if not exists idx_clients_org on clients(organization_id);
create index if not exists idx_brands_client on brands(client_id);
create index if not exists idx_projects_org on projects(organization_id);
create index if not exists idx_tasks_project on tasks(project_id);
create index if not exists idx_contents_brand on contents(brand_id);
create index if not exists idx_shoots_org on shoots(organization_id);
create index if not exists idx_invoices_client on invoices(client_id);
create index if not exists idx_expenses_org on expenses(organization_id);

-- =====================================================================
-- Row Level Security
-- =====================================================================

-- Geçerli kullanıcının org id'sini döndüren yardımcı fonksiyon
create or replace function current_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select organization_id from profiles where id = auth.uid();
$$;

create or replace function current_role_name()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

-- profiles ve organizations
alter table organizations enable row level security;
alter table profiles enable row level security;

drop policy if exists org_select on organizations;
create policy org_select on organizations for select
  using (id = current_org_id());

drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for select
  using (id = auth.uid() or organization_id = current_org_id());

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid());

-- Org kapsamlı tablolar için ortak politika üretici
do $$
declare t text;
begin
  foreach t in array array[
    'leads','clients','brands','contacts','service_packages','projects',
    'tasks','contents','shoots','equipment','equipment_bookings','invoices',
    'payments','expenses','files','notifications','activity_logs'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I_org_all on %I;', t, t);
    execute format(
      'create policy %I_org_all on %I for all
         using (organization_id = current_org_id())
         with check (organization_id = current_org_id());', t, t);
  end loop;
end $$;

-- =====================================================================
-- Yeni auth.users kaydında otomatik profil oluştur
-- =====================================================================
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare default_org uuid;
begin
  select id into default_org from organizations order by created_at limit 1;
  insert into public.profiles (id, organization_id, full_name, role)
  values (
    new.id,
    default_org,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'editor'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =====================================================================
-- Varsayılan organizasyon (Rast Creative)
-- =====================================================================
insert into organizations (name)
select 'Rast Creative'
where not exists (select 1 from organizations);
