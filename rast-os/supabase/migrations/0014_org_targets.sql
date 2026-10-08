-- =====================================================================
-- Rast OS — Migration 0014: Organizasyon hedefleri (MRR / "hastaneden ayrılma eşiği")
--
-- Dashboard "Aylık tekrarlayan gelir (MRR) ve eşik" kartı için org başına iki ayar:
--   mrr_target       : hedef aylık tekrarlayan gelir (TL, KDV hariç); null = belirlenmemiş
--   mrr_target_label : hedefin adı (varsayılan 'Hastaneden ayrılma eşiği')
--
-- Bugün org ayarlarını tutan ayrı bir tablo yok (organizations yalnız id/name/created_at
-- taşıyor), bu yüzden iki kolon doğrudan organizations'a eklenir — yeni tablo/RLS gerekmez.
--
-- RLS / yetki:
--   * SELECT: 0001'deki org_select (id = current_org_id()) aynen geçerli; değişmedi.
--   * UPDATE: organizations'ta şimdiye kadar UPDATE politikası YOKTU (istemci güncelleyemezdi).
--     Burada yalnızca kendi org'unun 'admin'i için bir UPDATE politikası eklenir ve
--     kolon düzeyinde yetki YALNIZCA bu iki kolonla sınırlanır (name/id/created_at
--     istemciden değiştirilemez).
--
-- Idempotent. NOT applied to any environment yet — see README-0014.md.
-- Apply AFTER 0012 (0013_content_approvals ile bağımsızdır; sırası fark etmez).
-- =====================================================================

alter table public.organizations
  add column if not exists mrr_target numeric(14,2),
  add column if not exists mrr_target_label text default 'Hastaneden ayrılma eşiği';

alter table public.organizations
  drop constraint if exists organizations_mrr_target_check;
alter table public.organizations
  add constraint organizations_mrr_target_check
  check (mrr_target is null or mrr_target >= 0);

alter table public.organizations
  drop constraint if exists organizations_mrr_target_label_check;
alter table public.organizations
  add constraint organizations_mrr_target_label_check
  check (mrr_target_label is null or (btrim(mrr_target_label) <> '' and char_length(mrr_target_label) <= 80));

-- Yalnızca admin, yalnızca kendi organizasyonu.
drop policy if exists org_admin_update_targets on public.organizations;
create policy org_admin_update_targets on public.organizations for update
  to authenticated
  using (id = public.current_org_id() and public.current_role_name() = 'admin')
  with check (id = public.current_org_id() and public.current_role_name() = 'admin');

-- Kolon düzeyinde yetki: istemci yalnızca hedef kolonlarını güncelleyebilir.
revoke update on public.organizations from anon, authenticated;
grant update (mrr_target, mrr_target_label) on public.organizations to authenticated;
