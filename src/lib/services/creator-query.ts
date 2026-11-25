import type { SupabaseClient } from "@supabase/supabase-js";
import { CREATOR_STATUSES } from "@/lib/types";

export const SORTS = {
  score: "score",
  followers: "followers",
  views: "median_views",
  engagement: "engagement_rate",
  recent: "created_at",
  last_post: "last_posted_at",
} as const;

export interface CreatorFilters {
  q?: string;
  platform?: string;
  priority?: string;
  status?: string;
  /** "target" | "unknown" | ISO country code */
  country?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

/** Shared by the Discovery table and CSV export so both always agree. */
export function creatorQuery(db: SupabaseClient, f: CreatorFilters, columns = "*", targetCountries: string[] = []) {
  let q = db.from("creators").select(columns, { count: "exact" });
  if (f.q) {
    const term = f.q.replace(/[%,()"]/g, " ").trim();
    if (term) q = q.or(`handle.ilike.%${term}%,display_name.ilike.%${term}%,bio.ilike.%${term}%,niche.ilike.%${term}%`);
  }
  if (f.platform === "instagram" || f.platform === "tiktok") q = q.eq("platform", f.platform);
  if (f.priority === "unscored") q = q.is("priority", null);
  else if (f.priority && ["high", "medium", "low"].includes(f.priority)) q = q.eq("priority", f.priority);
  if (f.status && (CREATOR_STATUSES as readonly string[]).includes(f.status)) q = q.eq("status", f.status);
  const codes = targetCountries.filter((c) => /^[A-Z]{2}$/.test(c));
  // Same rule as inTargetRegion(): a target country, or unknown country with English content.
  if (f.country === "target" && codes.length) q = q.or(`country.in.(${codes.join(",")}),and(country.is.null,language.eq.en)`);
  else if (f.country === "unknown") q = q.is("country", null);
  else if (f.country && /^[A-Z]{2}$/.test(f.country)) q = q.eq("country", f.country);
  const col = SORTS[(f.sort ?? "score") as keyof typeof SORTS] ?? "score";
  return q.order(col, { ascending: f.dir === "asc", nullsFirst: false });
}
