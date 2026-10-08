-- =====================================================================
-- Rast OS — Migration 0016: contents.script_source (senaryonun kaynağı)
--
-- Senaryolar uygulama içinde üretilmez (API anahtarı yok). Sahip, Claude Code'da
-- RAST-OS "senaryo-uret" komutuyla writing-draft dosyası üretir; içerik
-- düzenleyicideki "Senaryo içe aktar" bu taslağı hook / script / caption
-- alanlarına yazar ve kaynağı işaretler:
--   script_source = 'claude-code'  : senaryo-uret taslağından içe aktarıldı
--   script_source = 'rast-writer'  : (ileride) crm_sync / rast-writer hattı
--   script_source = 'manual'       : elle yazıldı (isteğe bağlı; NULL = bilinmiyor / eski kayıt)
-- Uygulama yalnızca 'claude-code' yazar. Kolon nullable; mevcut satırlar NULL kalır.
--
-- RLS: contents politikası (0001 / 0008) değişmez; kolon aynı org kapsamında.
-- 0012 log_activity() trigger'ı contents güncellemelerini zaten loglar.
--
-- Idempotent. NOT applied to any environment yet — see README-0016.md.
-- Apply AFTER 0015.
-- =====================================================================

alter table public.contents
  add column if not exists script_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contents_script_source_check' and conrelid = 'public.contents'::regclass
  ) then
    alter table public.contents
      add constraint contents_script_source_check
      check (script_source is null or script_source in ('claude-code', 'rast-writer', 'manual'));
  end if;
end $$;

comment on column public.contents.script_source is
  'Senaryonun kaynağı: claude-code (senaryo-uret taslağı içe aktarıldı), rast-writer, manual; NULL = bilinmiyor.';
