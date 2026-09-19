-- Giderleri orijinal para biriminde sakla. Eski kayıtlar TL kabul edilir.
alter table expenses
  add column if not exists currency text not null default 'TRY';

alter table expenses
  drop constraint if exists expenses_currency_check;

alter table expenses
  add constraint expenses_currency_check
  check (currency in ('TRY', 'USD', 'EUR'));
