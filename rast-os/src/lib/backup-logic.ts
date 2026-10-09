// Yedek (JSON dışa aktarma) saf mantığı: sayfalı çekme, dosya adı, "son yedek" yaşı.
// React/store'dan bağımsızdır; scripts/backup-logic.test.mjs ile doğrudan test edilir.
// Not: Node'un type-stripping'i ile çalıştırıldığı için burada yalnızca `import type` kullanın.

/** PostgREST varsayılan `max-rows` ile aynı: tablo başına tek istekte en çok bu kadar satır. */
export const BACKUP_PAGE_SIZE = 1000;
/** Bu kadar günden eski (veya hiç olmayan) yedek için uyarı gösterilir. */
export const BACKUP_STALE_DAYS = 7;
/** localStorage anahtarı: son başarılı yedeğin ISO zamanı (yalnızca bu tarayıcı). */
export const LAST_BACKUP_KEY = "rast-last-backup";

type Row = Record<string, unknown>;
type PageResult = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/** Yedeğin ihtiyaç duyduğu en küçük Supabase sorgu yüzeyi (testte sahte istemciyle değiştirilebilsin). */
export interface BackupClient {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, opts: { ascending: boolean }) => {
        range: (from: number, to: number) => PageResult;
      };
    };
  };
}

export interface BackupPayload {
  exported_at: string;
  organization_id: string | null;
  tables: Record<string, Row[]>;
  /** Yalnızca bazı tablolar çekilemediyse dolu (tablo → hata iletisi). */
  errors?: Record<string, string>;
}

/**
 * Tek tabloyu sayfa sayfa çeker. `id`'ye göre sıralanır (sayfalar arasında kararlı sıra için;
 * created_at olmayan tablolarda da çalışır). Bir sayfa 1000'den az dönene kadar devam eder.
 * Hata olursa kısmi veri döndürmek yerine hata verir (sessiz eksik yedek tehlikelidir).
 */
export async function fetchAllRows(
  client: BackupClient,
  table: string,
  pageSize: number = BACKUP_PAGE_SIZE,
): Promise<{ rows: Row[]; error?: string }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return { rows: [], error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { rows };
}

/** Tüm tabloları sırayla çeker (tek tek: veritabanına aynı anda onlarca istek yığılmasın). */
export async function buildBackup(
  client: BackupClient,
  tables: readonly string[],
  organizationId: string | null,
  now: Date = new Date(),
  onProgress?: (done: number, total: number, table: string) => void,
): Promise<BackupPayload> {
  const out: BackupPayload = { exported_at: now.toISOString(), organization_id: organizationId, tables: {} };
  const errors: Record<string, string> = {};
  let done = 0;
  for (const table of tables) {
    const r = await fetchAllRows(client, table);
    if (r.error) errors[table] = r.error;
    else out.tables[table] = r.rows;
    done += 1;
    onProgress?.(done, tables.length, table);
  }
  if (Object.keys(errors).length > 0) out.errors = errors;
  return out;
}

/** rast-os-yedek-YYYY-MM-DD.json (yerel tarih). */
export function backupFileName(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `rast-os-yedek-${y}-${m}-${d}.json`;
}

/** Son yedekten bu yana geçen tam gün; tarih yok/bozuksa null. Gelecek tarih 0 sayılır. */
export function daysSinceBackup(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** Uyarı gerekir mi: hiç yedek yok VEYA yaş 7 günden büyük. */
export function isBackupStale(iso: string | null | undefined, nowMs: number): boolean {
  const days = daysSinceBackup(iso, nowMs);
  return days === null || days > BACKUP_STALE_DAYS;
}

/** "Son yedek 9 gün önce" / "Son yedek bugün" / "Henüz yedek alınmadı". */
export function backupAgeLabel(iso: string | null | undefined, nowMs: number): string {
  const days = daysSinceBackup(iso, nowMs);
  if (days === null) return "Henüz yedek alınmadı";
  if (days === 0) return "Son yedek bugün";
  return `Son yedek ${days} gün önce`;
}
