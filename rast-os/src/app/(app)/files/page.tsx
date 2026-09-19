import { PageHeader, EmptyState } from "@/components/ui";

export default function Page() {
  return (
    <>
      <PageHeader
        title="Dosyalar"
        subtitle="Google Drive / Dropbox / NAS bağlantıları ve standart klasör yapısı (Brief, Raw, Audio, Project, Exports, Approved, Archive)."
      />
      <EmptyState
        title="Dosya bağlantıları — yakında"
        hint="Bu modül MVP kapsamında geliştiriliyor. Supabase şeması hazır; kayıt oluşturma ve listeleme ekranları sırayla eklenecek."
      />
    </>
  );
}
