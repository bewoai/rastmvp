"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { PageLoading } from "@/components/list";
import { ClientPortalCard } from "@/components/ClientPortalCard";
import { useStore, useHydrated } from "@/lib/store";
import { TRY, dateTR } from "@/lib/labels";

// Müşteri sayfası: temel bilgiler + "Portal" kartı (hesapsız müşteri portalı bağlantıları, 0018).
export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const clientId = decodeURIComponent(id);
  const hydrated = useHydrated(["clients", "brands", "contacts", "client_portal_tokens"]);
  const client = useStore((s) => s.clients.find((c) => c.id === clientId));
  const allBrands = useStore((s) => s.brands);
  const allContacts = useStore((s) => s.contacts);
  const brands = useMemo(() => allBrands.filter((b) => b.client_id === clientId), [allBrands, clientId]);
  const contacts = useMemo(() => allContacts.filter((c) => c.client_id === clientId), [allContacts, clientId]);

  if (!hydrated) return <PageLoading title="Müşteri" />;
  if (!client) {
    return (
      <>
        <PageHeader title="Müşteri bulunamadı" />
        <EmptyState title="Bu müşteri yok veya silinmiş" cta={{ label: "Müşterilere dön", href: "/crm/clients" }} />
      </>
    );
  }

  const contract = [client.contract_start, client.contract_end].map((d) => (d ? dateTR(d.slice(0, 10)) : "")).filter(Boolean).join(" – ");

  return (
    <>
      <Link
        href="/crm/clients"
        prefetch={false}
        className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-xl px-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Müşteriler
      </Link>
      <PageHeader
        title={client.name}
        subtitle={client.notes || undefined}
        action={
          <Link
            href={`/raporlar/aylik?musteri=${encodeURIComponent(client.id)}`}
            prefetch={false}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            <FileText className="h-4 w-4" aria-hidden /> Aylık rapor
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section aria-labelledby="client-facts-title" className="card p-4">
          <h2 id="client-facts-title" className="text-sm font-semibold text-foreground">Bilgiler</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-xs text-muted">Durum</dt><dd className="mt-0.5"><Badge tone={client.is_active ? "success" : "muted"}>{client.is_active ? "Aktif" : "Pasif"}</Badge></dd></div>
            <div><dt className="text-xs text-muted">Aylık ücret</dt><dd className="mt-0.5 text-foreground">{client.monthly_fee ? TRY(client.monthly_fee) : "—"}</dd></div>
            <div><dt className="text-xs text-muted">Sözleşme</dt><dd className="mt-0.5 text-foreground">{contract || "—"}</dd></div>
            <div><dt className="text-xs text-muted">Ödeme günü</dt><dd className="mt-0.5 text-foreground">{client.payment_day ? `Ayın ${client.payment_day}.` : "—"}</dd></div>
            <div className="col-span-2">
              <dt className="text-xs text-muted">Markalar</dt>
              <dd className="mt-0.5 text-foreground">{brands.length ? brands.map((b) => b.name).join(", ") : "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted">Kişiler</dt>
              <dd className="mt-0.5 space-y-1 text-foreground">
                {contacts.length === 0 && "—"}
                {contacts.map((c) => (
                  <p key={c.id}>
                    {c.full_name}
                    {c.title && <span className="text-muted"> · {c.title}</span>}
                    {c.is_approver && <span className="ml-1.5"><Badge tone="amber">Onaylayan</Badge></span>}
                  </p>
                ))}
              </dd>
            </div>
          </dl>
        </section>

        <ClientPortalCard client={client} />
      </div>
    </>
  );
}
