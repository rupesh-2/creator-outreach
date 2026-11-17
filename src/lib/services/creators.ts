import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedCreator } from "@/lib/ingestion/normalize";
import { aggregate, type AggregateMetrics } from "@/lib/scoring/metrics";
import { scoreCreator } from "@/lib/scoring/score";
import type { Creator, CreatorPost, CreatorStatus, DataSource, Settings } from "@/lib/types";
import { getSettings } from "./settings";

export interface ImportSummary {
  inserted: number;
  updated: number;
  skippedDnc: number;
  failed: { handle: string; error: string }[];
  ids: string[];
}

/** Insert/update creators + posts with provenance, then (re)score each one. CRM fields are never overwritten. */
export async function upsertCreators(
  db: SupabaseClient,
  ownerId: string,
  items: NormalizedCreator[],
  source: DataSource,
  sourceRef: string | null,
): Promise<ImportSummary> {
  const settings = await getSettings(db, ownerId);
  const summary: ImportSummary = { inserted: 0, updated: 0, skippedDnc: 0, failed: [], ids: [] };
  const { data: dnc } = await db.from("do_not_contact").select("platform, handle, email").eq("owner_id", ownerId);
  const dncHandles = new Set((dnc ?? []).filter((d) => d.handle).map((d) => `${d.platform}:${d.handle.toLowerCase()}`));
  const dncEmails = new Set((dnc ?? []).filter((d) => d.email).map((d) => d.email.toLowerCase()));

  for (const c of items) {
    try {
      if (dncHandles.has(`${c.platform}:${c.handle}`) || (c.business_email && dncEmails.has(c.business_email))) {
        summary.skippedDnc++;
        continue;
      }
      const { data: existing } = await db
        .from("creators")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("platform", c.platform)
        .eq("handle", c.handle)
        .maybeSingle();

      // Only overwrite profile fields with non-null new values so a sparse re-import doesn't erase data.
      const profile = Object.fromEntries(
        Object.entries({
          display_name: c.display_name,
          bio: c.bio,
          followers: c.followers,
          following: c.following,
          total_posts: c.total_posts,
          business_email: c.business_email,
          external_url: c.external_url,
          niche: c.niche,
          raw: c.raw ?? null,
        }).filter(([, v]) => v !== null && v !== undefined),
      );
      const row = {
        owner_id: ownerId,
        platform: c.platform,
        handle: c.handle,
        profile_url: c.profile_url,
        ...profile,
        data_source: source,
        source_ref: sourceRef,
        collected_at: new Date().toISOString(),
      };
      const { data: saved, error } = await db.from("creators").upsert(row, { onConflict: "owner_id,platform,handle" }).select("id").single();
      if (error) throw error;
      if (existing) summary.updated++;
      else summary.inserted++;
      summary.ids.push(saved.id);

      if (c.posts.length) {
        const { error: pe } = await db.from("creator_posts").upsert(
          c.posts.map((p) => ({ ...p, owner_id: ownerId, creator_id: saved.id, data_source: source, collected_at: new Date().toISOString() })),
          { onConflict: "creator_id,url" },
        );
        if (pe) throw pe;
      }
      await rescoreCreator(db, ownerId, saved.id, settings, c.posts.length ? undefined : c.provided);
    } catch (e) {
      summary.failed.push({ handle: c.handle, error: (e as Error).message ?? String(e) });
    }
  }
  return summary;
}

/** Recompute aggregate metrics and score for one creator; advances early statuses. */
export async function rescoreCreator(
  db: SupabaseClient,
  ownerId: string,
  creatorId: string,
  settings?: Settings,
  provided?: NormalizedCreator["provided"],
) {
  settings ??= await getSettings(db, ownerId);
  const { data: c } = await db.from("creators").select("*").eq("id", creatorId).eq("owner_id", ownerId).single<Creator>();
  if (!c) throw new Error("Creator not found");
  const { data: posts } = await db
    .from("creator_posts")
    .select("posted_at, views, likes, comments, caption")
    .eq("creator_id", creatorId)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(30);
  const p = (posts ?? []) as Pick<CreatorPost, "posted_at" | "views" | "likes" | "comments" | "caption">[];

  let metrics: AggregateMetrics;
  if (p.length) {
    metrics = aggregate(p, c.followers);
  } else {
    // No post-level data — fall back to pre-aggregated values (CSV) or what's already stored.
    const src = provided ?? {};
    metrics = {
      avg_views: src.avg_views ?? c.avg_views,
      median_views: src.median_views ?? c.median_views,
      engagement_rate: src.engagement_rate ?? c.engagement_rate,
      engagement_estimated: false,
      posts_last_30d: src.posts_last_30d ?? c.posts_last_30d,
      last_posted_at: src.last_posted_at ?? c.last_posted_at,
      sample_size: src.posts_last_30d ?? 0,
      views_cv: null,
    };
  }

  const { data: latest } = await db
    .from("analyses")
    .select("result")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const aiNiche: string | undefined = latest?.result?.niche?.value;

  const breakdown = scoreCreator(
    {
      followers: c.followers,
      following: c.following,
      bio: c.bio,
      niche: [c.niche, aiNiche].filter(Boolean).join(" · ") || null,
      business_email: c.business_email,
      external_url: c.external_url,
      captions: p.map((x) => x.caption ?? "").filter(Boolean),
      metrics,
    },
    { target_niches: settings.target_niches, min_followers: settings.min_followers, max_followers: settings.max_followers },
  );

  const update: Partial<Creator> = {
    avg_views: metrics.avg_views,
    median_views: metrics.median_views,
    engagement_rate: metrics.engagement_rate,
    posts_last_30d: metrics.posts_last_30d,
    last_posted_at: metrics.last_posted_at,
    score: breakdown.total,
    priority: breakdown.priority,
    score_breakdown: breakdown,
    scored_at: new Date().toISOString(),
  };
  await db.from("creators").update(update).eq("id", creatorId).eq("owner_id", ownerId);

  // Analyzed creators that score medium/high become qualified.
  if (c.status === "analyzed" && breakdown.priority !== "low") await setStatus(db, ownerId, creatorId, "qualified", c.status);
  return breakdown;
}

export async function setStatus(db: SupabaseClient, ownerId: string, creatorId: string, to: CreatorStatus, from?: CreatorStatus, body?: string) {
  if (from === undefined) {
    const { data } = await db.from("creators").select("status").eq("id", creatorId).eq("owner_id", ownerId).single();
    from = data?.status;
  }
  if (from === to) return;
  await db.from("creators").update({ status: to }).eq("id", creatorId).eq("owner_id", ownerId);
  await db.from("contact_events").insert({ owner_id: ownerId, creator_id: creatorId, type: "status_change", from_status: from, to_status: to, body });
}

const EARLY: CreatorStatus[] = ["discovered", "analyzed", "qualified", "pending_review", "approved"];
/** Move forward automatically only from early pipeline stages; never overwrite a manual later status. */
export async function advanceStatus(db: SupabaseClient, ownerId: string, creatorId: string, to: CreatorStatus) {
  const { data } = await db.from("creators").select("status").eq("id", creatorId).eq("owner_id", ownerId).single();
  if (!data) return;
  const from = data.status as CreatorStatus;
  if (!EARLY.includes(from)) return;
  if (EARLY.indexOf(to) !== -1 && EARLY.indexOf(to) <= EARLY.indexOf(from)) return;
  await setStatus(db, ownerId, creatorId, to, from);
}
