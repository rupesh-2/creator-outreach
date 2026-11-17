import type { Creator, CreatorPost } from "@/lib/types";

export interface Evidence {
  id: string; // E1, E2…
  kind: "profile" | "metrics" | "post" | "contact";
  text: string;
  url?: string;
}

const compact = (n: number | null | undefined) => (n == null ? "unknown" : Intl.NumberFormat("en", { notation: "compact" }).format(n));

/**
 * Build the numbered fact table the model is allowed to cite. Anything not in
 * this table is, by construction, not something we know about the creator.
 */
export function buildEvidence(c: Creator, posts: CreatorPost[]): Evidence[] {
  const ev: Evidence[] = [];
  const add = (e: Omit<Evidence, "id">) => ev.push({ id: `E${ev.length + 1}`, ...e });

  add({ kind: "profile", text: `Platform: ${c.platform}. Handle: @${c.handle}. Display name: ${c.display_name ?? "unknown"}.`, url: c.profile_url });
  if (c.bio?.trim()) add({ kind: "profile", text: `Bio: "${c.bio.trim()}"` });
  if (c.niche) add({ kind: "profile", text: `Niche label from data source: ${c.niche}` });
  if (c.external_url) add({ kind: "profile", text: `Profile link: ${c.external_url}` });
  add({
    kind: "metrics",
    text:
      `Followers ${compact(c.followers)}, median views on recent videos ${compact(c.median_views)}, ` +
      `engagement ${(c.engagement_rate != null ? (c.engagement_rate * 100).toFixed(1) + "%" : "unknown")}, ` +
      `${c.posts_last_30d ?? "unknown"} posts in last 30 days.`,
  });
  add({ kind: "contact", text: c.business_email ? "A public business email is listed." : "No public business email collected." });

  const sorted = [...posts].sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? "")).slice(0, 15);
  for (const p of sorted) {
    const date = p.posted_at ? p.posted_at.slice(0, 10) : "unknown date";
    const caption = (p.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || "(no caption collected)";
    add({
      kind: "post",
      url: p.url,
      text: `Post ${date} — views ${compact(p.views)}, likes ${compact(p.likes)}, comments ${compact(p.comments)}. Caption: "${caption}"`,
    });
  }
  return ev;
}

export function renderEvidence(ev: Evidence[]): string {
  return ev.map((e) => `[${e.id}] (${e.kind}) ${e.text}`).join("\n");
}

/** Keep only items whose evidence ids are non-empty and all exist. Returns kept + dropped. */
export function filterGrounded<T extends { evidence: string[] }>(items: T[], ev: Evidence[]): { kept: T[]; dropped: T[] } {
  const ids = new Set(ev.map((e) => e.id));
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const it of items) {
    (it.evidence.length > 0 && it.evidence.every((id) => ids.has(id)) ? kept : dropped).push(it);
  }
  return { kept, dropped };
}
