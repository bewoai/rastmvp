"use client";

import { PageHeader } from "@/components/ui";
import { PageLoading, Tabs, usePersistentState } from "@/components/list";
import { useHydrated, useStore } from "@/lib/store";
import { useGrowthStatus } from "@/lib/growth/client";
import { CompliancePanel, GrowthNav } from "@/components/growth/GrowthChrome";
import { DiscoverTab } from "@/components/growth/DiscoverTab";
import { ProspectsTab } from "@/components/growth/ProspectsTab";
import { SequencesTab } from "@/components/growth/SequencesTab";
import { QueueTab } from "@/components/growth/QueueTab";
import { SentTab } from "@/components/growth/SentTab";

type Tab = "kesfet" | "adaylar" | "diziler" | "kuyruk" | "gonderilenler";
const TABS: readonly Tab[] = ["kesfet", "adaylar", "diziler", "kuyruk", "gonderilenler"];

export default function MusteriBulmaPage() {
  const hydrated = useHydrated(["prospects", "outreach_sequences", "outreach_messages", "suppression_list", "leads", "tasks"]);
  const [tab, setTab] = usePersistentState<Tab>("growth-tab", "kesfet", TABS);
  const status = useGrowthStatus();
  const prospects = useStore((s) => s.prospects);
  const sequences = useStore((s) => s.outreach_sequences);
  const messages = useStore((s) => s.outreach_messages);

  if (!hydrated) return <PageLoading title="Müşteri Bulma" />;

  const queueCount = messages.filter((m) => m.channel === "email" && (m.status === "draft" || m.status === "approved")).length;
  const sentCount = messages.filter((m) => m.status === "sent" || m.status === "replied" || m.status === "bounced").length;

  return (
    <>
      <PageHeader
        title="Müşteri Bulma"
        subtitle="Aday bul, puanla, günlük listeyle elle ulaş; e-posta dizileri insan onayıyla (şu an gönderim kapalı)."
        action={<GrowthNav active="modul" />}
      />
      <CompliancePanel dailyCap={status?.dailyCap} emailEnabled={status?.emailEnabled} />
      <Tabs
        label="Müşteri Bulma bölümleri"
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { id: "kesfet", label: "Keşfet" },
          { id: "adaylar", label: "Adaylar", count: prospects.length },
          { id: "diziler", label: "Diziler", count: sequences.length },
          { id: "kuyruk", label: "Onay kuyruğu", count: queueCount },
          { id: "gonderilenler", label: "Gönderilenler", count: sentCount },
        ]}
      />
      <div role="tabpanel" aria-label={tab}>
        {tab === "kesfet" && <DiscoverTab status={status} />}
        {tab === "adaylar" && <ProspectsTab />}
        {tab === "diziler" && <SequencesTab />}
        {tab === "kuyruk" && <QueueTab status={status} />}
        {tab === "gonderilenler" && <SentTab />}
      </div>
    </>
  );
}
