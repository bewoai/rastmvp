// Müşteri Bulma — demo (Supabase'siz) örnek verisi. Adaylar sahte Places kimlikleri (mock-…) taşır; ad / telefon
// gibi alanlar SAKLANMAZ, demo'da MockPlacesClient'tan canlıymış gibi çekilir (gerçek veriyle aynı akış).
import type { OutreachMessage, Prospect, OutreachSequence, SuppressionEntry } from "../types";
import { DEFAULT_SEQUENCES } from "./logic";
import { scoreProspect } from "./score";
import { MOCK_PLACES } from "./places";

const DAY = 86_400_000;

export function growthDemoSeed(now: number): {
  prospects: Prospect[];
  outreach_sequences: OutreachSequence[];
  outreach_messages: OutreachMessage[];
  suppression_list: SuppressionEntry[];
} {
  const iso = (d: number) => new Date(now - d * DAY).toISOString();
  const day = (d: number) => new Date(now + d * DAY + 3 * 3_600_000).toISOString().slice(0, 10);

  const mk = (placeId: string, status: Prospect["status"], extra: Partial<Prospect> = {}): Prospect => {
    const mp = MOCK_PLACES.find((p) => p.placeId === placeId)!;
    const email = mp.website ? `info@${new URL(mp.website).hostname}` : null;
    const instagram = mp.website ? new URL(mp.website).hostname.replace(/\.example$/, "").replace(/[^a-z0-9]/g, "") : null;
    const sectorText = { hekim: "Diş / klinik", mobilya: "Mobilya", insaat: "İnşaat / emlak" }[mp.sector];
    const { score, breakdown } = scoreProspect({
      sector: sectorText, rating: mp.rating, reviewsCount: mp.reviewsCount, website: mp.website,
      site: mp.website ? { https: true, hasTitle: true, hasOg: true } : null, instagram, email, city: mp.city,
    });
    return {
      id: `pr-${placeId}`,
      source: "places",
      external_id: placeId,
      sector: sectorText,
      city: mp.city,
      district: mp.district,
      email,
      instagram,
      field_sources: { ...(email ? { email: "website" as const } : {}), ...(instagram ? { instagram: "website" as const } : {}) },
      lat: mp.lat ?? null,
      lng: mp.lng ?? null,
      places_cached_at: iso(2),
      score,
      score_breakdown: breakdown,
      status,
      created_at: iso(5),
      ...extra,
    };
  };

  const prospects: Prospect[] = [
    mk("mock-hekim-01", "queued"),
    mk("mock-hekim-02", "queued"),
    mk("mock-hekim-03", "qualified"),
    mk("mock-hekim-04", "qualified"),
    mk("mock-hekim-05", "qualified"),
    mk("mock-hekim-06", "qualified"),
    mk("mock-hekim-07", "qualified"),
    mk("mock-mobilya-11", "qualified"),
    mk("mock-mobilya-13", "qualified"),
    mk("mock-insaat-15", "qualified"),
    mk("mock-insaat-16", "qualified"),
    // 14 günlük bekleme: 2 gün önce WhatsApp'tan yazıldı
    mk("mock-hekim-08", "contacted", { last_contacted_at: iso(2) }),
    // Dün arandı
    mk("mock-insaat-17", "contacted", { last_contacted_at: iso(1) }),
    // "Sonra" ile ertelendi
    mk("mock-insaat-18", "qualified", { next_action_at: day(3), notes: "Proje lansmanı sonrası tekrar ara." }),
    mk("mock-mobilya-12", "new"),
    mk("mock-mobilya-14", "suppressed", { notes: "İlgilenmiyor (telefonda belirtti)." }),
  ];

  const hekim = DEFAULT_SEQUENCES.find((s) => s.sector === "hekim")!;
  const outreach_sequences: OutreachSequence[] = [
    { id: "seq-hekim", name: hekim.name, sector: "hekim", channel: "email", steps: hekim.steps, active: true, created_at: iso(6) },
  ];

  const draft = (id: string, prospectId: string, to: string): OutreachMessage => ({
    id, prospect_id: prospectId, sequence_id: "seq-hekim", step_no: 1, channel: "email", manual: false, to_email: to,
    subject: hekim.steps[0].subject, body: hekim.steps[0].body, status: "draft", scheduled_for: null, created_at: iso(1),
  });

  const outreach_messages: OutreachMessage[] = [
    draft("om-d1", "pr-mock-hekim-01", "info@demo-hekim-01.example"),
    draft("om-d2", "pr-mock-hekim-02", "info@demo-hekim-02.example"),
    {
      id: "om-m1", prospect_id: "pr-mock-hekim-08", sequence_id: null, step_no: 1, channel: "whatsapp", manual: true,
      subject: "WhatsApp attım", body: "", status: "sent", sent_at: iso(2), created_at: iso(2),
    },
    {
      id: "om-m2", prospect_id: "pr-mock-insaat-17", sequence_id: null, step_no: 1, channel: "phone", manual: true,
      subject: "Aradım", body: "", status: "sent", sent_at: iso(1), created_at: iso(1),
    },
  ];

  const suppression_list: SuppressionEntry[] = [
    { id: "sup-1", kind: "email", value: "info@demo-mobilya-14.example", reason: "manual", note: "İlgilenmiyor", created_at: iso(3) },
  ];

  return { prospects, outreach_sequences, outreach_messages, suppression_list };
}
