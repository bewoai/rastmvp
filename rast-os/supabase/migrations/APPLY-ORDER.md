# Migration uygulama sırası (0008 → 0019)

> **Durum:** Bu dosyalardan hiçbiri henüz hiçbir veritabanında çalıştırılmadı.
> Önce staging / branch veritabanında, sonra canlıda uygulanır. Sıra
> numaralara göre ve **tek tek** ilerler; bir adım hata verirse durulur,
> sonrakine geçilmez. Ayrıntı ve rollback için her dosyanın `README-00xx.md`'si.

## Ön adımlar (sahip yapar)

1. **Yeni kayıtları kapat:** Supabase Dashboard → Authentication → Sign In /
   Providers → "Allow new users to sign up" **kapalı**. 0008 uygulanana kadar
   yeni kayıt olan herkes en eski organizasyona otomatik bağlanıyor
   (0001/0007 `handle_new_user()`); açık kalırsa veri sızar.
2. **Önce staging:** Tüm sırayı önce staging / branch projesinde çalıştır,
   aşağıdaki kontrolleri orada yap; ancak hepsi geçince canlıda tekrarla.
3. **Yedek al:** Canlıdan önce veritabanı yedeği / Point-in-Time Recovery
   noktasının olduğunu doğrula.
4. Postgres sürümünün **15+** olduğunu kontrol et (0013 ve 0015 için gerekli; güncel
   Supabase projeleri uygun).

## Sıra

1. `0008_security_hardening.sql` — profiles yetki yükseltme açığını kapatır; otomatik org'a katılmayı kaldırıp davet (`organization_invites`) sistemine geçer.
2. `0009_expense_fx_rate.sql` — giderlere `fx_rate` ve `amount_try` (giriş anındaki kur) ekler.
3. `0010_import_rpc.sql` — İçe Aktar için tek transaction'lık `import_rows()` RPC'si (0008 ve 0009'dan sonra).
4. `0011_proposals.sql` — `proposals` ve `proposal_items` (teklifler) tabloları + RLS.
5. `0012_activity_logs_triggers.sql` — `log_activity()` trigger'ları ile işlem geçmişi (`activity_logs`).
6. `0013_content_approvals.sql` — `content_approvals` tablosu + hesapsız hekim onayı için public token RPC'leri (`approval_get` vb.).
7. `0014_org_targets.sql` — `organizations.mrr_target` / `mrr_target_label` (MRR eşiği; yalnız admin, kolon düzeyinde güncelleme).
8. `0015_client_reports.sql` — `client_reports` (aylık müşteri raporu notları; sayılar saklanmaz) + `projects.proposal_id` (teklif → proje bağı, teklif başına tek proje).
9. `0016_script_source.sql` — `contents.script_source` (senaryonun kaynağı; "Senaryo içe aktar" `claude-code` yazar).
10. `0017_lead_intake_rpc.sql` — web sitesi formu → CRM lead + "Lead'i 24 saat içinde ara" görevi (`lead_intake` RPC, `lead_intake_settings`, `tasks.lead_id`). Sır + org id kurulumu için README-0017.
11. `0019_growth_engine.sql` — Müşteri Bulma: `prospects`, `outreach_sequences`, `outreach_messages`, `suppression_list`, `outreach_settings` + `outreach_unsubscribe` / `outreach_cron_claim` / `outreach_cron_result` RPC'leri. 0011, 0012 ve 0017'den sonra. CRON_SECRET hash'i + ret anahtarı kurulumu için README-0019. (0018 başka dalda olabilir; 0019 ondan bağımsız.)

> 0013 ve 0014 birbirinden bağımsız yazıldı; yine de numara sırasıyla
> (0013 → 0014) uygulanır.

Uygulama: Supabase Dashboard → SQL Editor → dosyayı yapıştır → Run (veya
bağlı projede `supabase db push`). 0008–0019 dosyaları idempotent olarak yazıldı; tekrar çalıştırmak
güvenlidir.

## Son kontroller

RLS kontrollerini SQL Editor'dan değil (o `postgres` olarak çalışır, RLS'i
atlar), uygulamadan / anon key + kullanıcı JWT'si ile yap.

- **0008:** README-0008'deki 10 maddelik tablo. En az: davetsiz yeni e-posta
  ile kayıt → `organization_id` NULL, listeler boş; editor kullanıcı kendi
  `role`'ünü `admin` yapamaz (42501).
- **0009:** USD/EUR gider ekle → `fx_rate` ve `amount_try` dolu; TRY giderde NULL.
- **0010:** Küçük bir dosyayı İçe Aktar ile yükle; hatalı satırlı bir dosyada
  hiçbir değişikliğin kalmadığını gör.
- **0011:** Teklifler sayfasında teklif oluştur / kalem ekle / kaydet.
- **0012:** Bir müşteriyi düzenle →
  `select entity, action, record_label, created_at from public.activity_logs order by created_at desc limit 10;`
  ve Ayarlar → İşlem geçmişi'nde kaydı gör.
- **0013:** İçerik → "Onay" → "Onaya gönder"; linki gizli pencerede aç, onayla →
  `select version, status, decided_by_name, decided_at from public.content_approvals order by created_at desc limit 5;`
- **0014:** Admin olarak Ayarlar'da eşik kaydet → dashboard MRR kartında
  görünür; admin olmayan kullanıcıda kaydetme reddedilir; `organizations.name`
  istemciden değiştirilemez.
- **0015:** Raporlar → Aylık rapor → müşteri + ay seç → not yaz → Kaydet →
  `select client_id, period, generated_at from public.client_reports order by updated_at desc limit 5;`
  Aynı ay ikinci kayıtta yeni satır oluşmaz. Bir teklifi "Kabul edildi" yapıp kaydet →
  proje (+ aylık kalem varsa taslak fatura) oluşur; "Projeye dönüştür" tekrar basılınca
  aynı proje açılır: `select name, proposal_id from public.projects where proposal_id is not null;`
- **0016:** İçerik → "Brief" durumundaki içerik → Senaryo içe aktar → vault örneğini yapıştır → Alanlara aktar → Kaydet →
  `select status, script_source from public.contents order by updated_at desc limit 5;` → `script_ready` / `claude-code`.
- **0017:** README-0017'deki `curl` ile `/api/leads`'e test gönderimi → CRM'de lead + yarına görev; aynı komut tekrarında `duplicate: true`.
- **0019:** README-0019'daki son kontroller: keşif tekrarında aday çoğalmaz; onaylanmamış mesaj gönderilmez; `curl -H "Authorization: Bearer $CRON_SECRET" …/api/growth/cron`; ret bağlantısı → `suppression_list`.
- **Sonra:** Kayıtlar kapalı kalır; yeni kullanıcılar yalnız admin daveti ile
  eklenir. Kayıtları yeniden açmak gerekirse ancak 0008 doğrulandıktan sonra.
