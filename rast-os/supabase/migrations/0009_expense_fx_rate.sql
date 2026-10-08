-- =====================================================================
-- Rast OS — Migration 0009: Expense FX snapshot (historical exchange rate)
--
-- USD/EUR giderler şimdiye kadar yalnızca orijinal tutarla saklanıyor ve TL
-- karşılığı her ekranda o anki (tarayıcıdaki) kurla yeniden hesaplanıyordu;
-- kur değişince geçmiş ayların gider toplamları da değişiyordu.
--
-- Bu migration giriş anındaki kuru ve TL karşılığını saklayacak kolonları ekler:
--   fx_rate    : giriş anında kullanılan kur (1 birim USD/EUR = fx_rate TL)
--   amount_try : amount * fx_rate (KDV hariç, TL)
-- TRY giderlerde iki kolon da NULL kalır. Uygulama amount_try doluysa onu,
-- değilse (eski kayıtlar) güncel kurla çevrimi kullanır.
--
-- Idempotent. NOT applied to any environment yet — see README-0009.md.
-- Apply AFTER 0008.
--
-- BACKFILL: Bu migration eski kayıtları DOLDURMAZ (bilerek). Geçmiş kur
-- bilinmediği için otomatik doldurma yanlış "tarihsel" değer üretir. İsteğe
-- bağlı, elle doldurma örneği README-0009.md içinde.
-- =====================================================================

alter table public.expenses
  add column if not exists fx_rate numeric(12,6),
  add column if not exists amount_try numeric(14,2);

alter table public.expenses
  drop constraint if exists expenses_fx_rate_positive;

alter table public.expenses
  add constraint expenses_fx_rate_positive check (fx_rate is null or fx_rate > 0);

comment on column public.expenses.fx_rate is
  'Giriş anındaki kur: 1 birim (currency) = fx_rate TL. TRY giderlerde NULL.';
comment on column public.expenses.amount_try is
  'amount * fx_rate (KDV hariç, TL), giriş anında sabitlenir. NULL ise uygulama güncel kurla çevirir.';
