import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreatorStatus } from "@/lib/types";

const MEETING_OR_LATER: CreatorStatus[] = ["meeting_scheduled", "partnership_discussion", "collaborated"];

export interface Funnel {
  discovered: number;
  qualified: number;
  contacted: number;
  replied: number;
  positive: number;
  meetings: number;
  partnerships: number;
  conversion: number | null; // partnerships / contacted
  replyRate: number | null;
  positiveRate: number | null;
}

/** Funnel metrics, optionally limited to creators discovered since `since`. Counts are distinct creators. */
export async function funnel(db: SupabaseClient, ownerId: string, since?: string): Promise<Funnel> {
  let q = db.from("creators").select("id, status, priority, last_contacted_at").eq("owner_id", ownerId).limit(10000);
  if (since) q = q.gte("created_at", since);
  const { data: creators } = await q;
  const ids = new Set((creators ?? []).map((c) => c.id));
  const { data: events } = await db
    .from("contact_events")
    .select("creator_id, type, sentiment, to_status")
    .eq("owner_id", ownerId)
    .in("type", ["reply", "status_change"])
    .limit(50000);

  const replied = new Set<string>();
  const positive = new Set<string>();
  const met = new Set<string>();
  for (const e of events ?? []) {
    if (!ids.has(e.creator_id)) continue;
    if (e.type === "reply") {
      replied.add(e.creator_id);
      if (e.sentiment === "positive") positive.add(e.creator_id);
    }
    if (e.type === "status_change" && MEETING_OR_LATER.includes(e.to_status)) met.add(e.creator_id);
  }
  const cs = creators ?? [];
  cs.filter((c) => MEETING_OR_LATER.includes(c.status)).forEach((c) => met.add(c.id));

  const contacted = cs.filter((c) => c.last_contacted_at).length;
  const partnerships = cs.filter((c) => c.status === "collaborated").length;
  const rate = (a: number, b: number) => (b ? a / b : null);
  return {
    discovered: cs.length,
    qualified: cs.filter((c) => c.priority === "high" || c.priority === "medium").length,
    contacted,
    replied: replied.size,
    positive: positive.size,
    meetings: met.size,
    partnerships,
    conversion: rate(partnerships, contacted),
    replyRate: rate(replied.size, contacted),
    positiveRate: rate(positive.size, contacted),
  };
}
