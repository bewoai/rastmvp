-- Giderlerde taksit sırasını ve bekleyen ödemeleri takip et.
alter table expenses
  add column if not exists payment_status text not null default 'paid',
  add column if not exists installment_number smallint,
  add column if not exists installment_total smallint;

alter table expenses
  drop constraint if exists expenses_payment_status_check,
  drop constraint if exists expenses_installment_number_check,
  drop constraint if exists expenses_installment_total_check;

alter table expenses
  add constraint expenses_payment_status_check check (payment_status in ('paid', 'pending')),
  add constraint expenses_installment_number_check check (installment_number is null or installment_number > 0),
  add constraint expenses_installment_total_check check (installment_total is null or installment_total > 0);
