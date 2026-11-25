import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getDatasetItems, getRun, handlesFromHashtagItems, hashtagInput, normalizeApifyItems, profileInput, startActorRun } from "@/lib/ingestion/apify";
import { analyzeCreator, generateOutreach, type OutreachOptions } from "@/lib/services/ai";
import { upsertCreators } from "@/lib/services/creators";
import { OutreachBlocked, sendApprovedEmail } from "@/lib/services/crm";
import { getSettings } from "@/lib/services/settings";
import type { Platform } from "@/lib/types";

export type JobType = "apify_profiles" | "apify_hashtag" | "analyze" | "outreach" | "send_email";

export interface Job {
  id: string;
  owner_id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export async function enqueue(db: SupabaseClient, ownerId: string, type: JobType, payload: Record<string, unknown>, delaySec = 0) {
  const { error } = await db.from("jobs").insert({
    owner_id: ownerId,
    type,
    payload,
    run_after: new Date(Date.now() + delaySec * 1000).toISOString(),
  });
  if (error) throw error;
}

/** Returned by a handler to re-check later without consuming a retry (e.g. waiting for an Apify run). */
class Reschedule {
  constructor(
    readonly payload: Record<string, unknown>,
    readonly delaySec: number,
  ) {}
}

const MAX_POLLS = 40; // ~30 minutes at 45s

async function runApify(db: SupabaseClient, job: Job, actor: string, input: unknown): Promise<unknown[] | Reschedule> {
  const token = env.apifyToken();
  if (!token) throw new Error("APIFY_TOKEN is not set");
  const p = job.payload;
  if (!p.runId) {
    const { runId } = await startActorRun(token, actor, input);
    return new Reschedule({ ...p, runId, polls: 0 }, 45);
  }
  const run = await getRun(token, String(p.runId));
  if (run.status === "SUCCEEDED") return getDatasetItems(token, run.datasetId);
  if (["READY", "RUNNING"].includes(run.status)) {
    const polls = Number(p.polls ?? 0) + 1;
    if (polls > MAX_POLLS) throw new Error(`Apify run ${p.runId} still ${run.status} after ${MAX_POLLS} checks`);
    return new Reschedule({ ...p, polls }, 45);
  }
  throw new Error(`Apify run ${p.runId} ended with status ${run.status}`);
}

async function handle(db: SupabaseClient, job: Job): Promise<unknown> {
  const owner = job.owner_id;
  const p = job.payload;
  switch (job.type) {
    case "apify_profiles": {
      const settings = await getSettings(db, owner);
      const platform = p.platform as Platform;
      const actor = platform === "instagram" ? settings.apify_instagram_actor : settings.apify_tiktok_actor;
      const items = await runApify(db, job, actor, profileInput(platform, p.handles as string[]));
      if (items instanceof Reschedule) return items;
      const creators = normalizeApifyItems(platform, items as Record<string, unknown>[]);
      const summary = await upsertCreators(db, owner, creators, "apify", `apify:${p.runId}`);
      if (p.autoAnalyze) for (const id of summary.ids) await enqueue(db, owner, "analyze", { creatorId: id, parentId: job.id });
      return summary;
    }
    case "apify_hashtag": {
      const platform = p.platform as Platform;
      const actor = String(p.actor);
      const items = await runApify(db, job, actor, hashtagInput(platform, p.hashtags as string[], Number(p.limit ?? 100)));
      if (items instanceof Reschedule) return items;
      const handles = handlesFromHashtagItems(items as Record<string, unknown>[]);
      const { data: known } = await db.from("creators").select("handle").eq("owner_id", owner).eq("platform", platform).in("handle", handles);
      const knownSet = new Set((known ?? []).map((k) => k.handle));
      const fresh = handles.filter((h) => !knownSet.has(h)).slice(0, Number(p.maxNew ?? 50));
      if (fresh.length) await enqueue(db, owner, "apify_profiles", { platform, handles: fresh, autoAnalyze: !!p.autoAnalyze, parentId: job.id });
      return { found: handles.length, queuedForEnrichment: fresh.length };
    }
    case "analyze": {
      const out = await analyzeCreator(db, owner, String(p.creatorId));
      const autoDraft = await maybeQueueDraft(db, owner, String(p.creatorId), job.id);
      return { ...out, autoDraft };
    }
    case "outreach":
      return generateOutreach(db, owner, String(p.creatorId), p.options as unknown as OutreachOptions);
    case "send_email": {
      const messageId = String(p.messageId);
      const { data: m } = await db.from("messages").select("state").eq("id", messageId).eq("owner_id", owner).maybeSingle();
      // Discarded, edited back to draft, or already sent by hand: nothing to do.
      if (!m || m.state !== "approved") return { skipped: `message is ${m?.state ?? "deleted"}` };
      try {
        await sendApprovedEmail(db, owner, messageId);
        return { sent: true };
      } catch (e) {
        if (e instanceof OutreachBlocked && /Daily email limit/.test(e.message)) return new Reschedule(p, 3600); // wait for the 24h window
        if (e instanceof OutreachBlocked) throw Object.assign(new Error(e.message), { retryable: false }); // DNC, already contacted, no address…
        throw e; // Resend/network: retry with backoff
      }
    }
    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

/** Queue an approved email to go out automatically after `delaySec` (a short window to discard it). No-op if already queued. */
export async function queueEmailSend(db: SupabaseClient, owner: string, messageId: string, creatorId: string, delaySec = 30) {
  const { count } = await db
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", owner)
    .eq("type", "send_email")
    .eq("payload->>messageId", messageId)
    .in("status", ["queued", "running"]);
  if (count) return false;
  await enqueue(db, owner, "send_email", { messageId, creatorId }, delaySec);
  return true;
}

const DRAFTABLE: string[] = ["discovered", "analyzed", "qualified"];

/**
 * Auto-draft pipeline: once a creator is analysed, queue outreach drafts if they score high enough
 * and haven't been drafted or contacted yet. Drafts go to the review queue — nothing is sent.
 * Returns why it did or didn't queue, for the job result.
 */
export async function maybeQueueDraft(db: SupabaseClient, owner: string, creatorId: string, parentId?: string): Promise<string> {
  const settings = await getSettings(db, owner);
  if (!settings.auto_draft) return "off";
  const { data: c } = await db.from("creators").select("score, status").eq("id", creatorId).eq("owner_id", owner).maybeSingle();
  if (!c) return "creator not found";
  if (c.score == null || c.score < settings.auto_draft_min_score) return `score ${c.score ?? "—"} below ${settings.auto_draft_min_score}`;
  if (!DRAFTABLE.includes(c.status)) return `status ${c.status}`;
  const [{ count: msgs }, { count: jobs }] = await Promise.all([
    db.from("messages").select("id", { count: "exact", head: true }).eq("creator_id", creatorId).eq("owner_id", owner).neq("state", "discarded"),
    db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", owner)
      .eq("type", "outreach")
      .eq("payload->>creatorId", creatorId)
      .in("status", ["queued", "running"]),
  ]);
  if (msgs || jobs) return "already drafted";
  await enqueue(db, owner, "outreach", {
    creatorId,
    options: { proposition: settings.auto_draft_proposition, includeBudget: settings.auto_draft_include_budget },
    auto: true,
    ...(parentId ? { parentId } : {}),
  });
  return "queued";
}

/** Claims and runs jobs until the time budget is spent. Safe to run concurrently (SKIP LOCKED). */
export async function runJobs(db: SupabaseClient, opts: { ownerId?: string; budgetMs?: number; batch?: number } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  let processed = 0;
  let failed = 0;
  let waiting = 0;
  while (Date.now() < deadline) {
    const { data: jobs, error } = await db.rpc("claim_jobs", { n: opts.batch ?? 3, p_owner: opts.ownerId ?? null });
    if (error) throw error;
    if (!jobs?.length) break;
    await Promise.all(
      (jobs as Job[]).map(async (job) => {
        try {
          const out = await handle(db, job);
          if (out instanceof Reschedule) {
            await db
              .from("jobs")
              .update({ status: "queued", payload: out.payload, attempts: job.attempts - 1, run_after: new Date(Date.now() + out.delaySec * 1000).toISOString() })
              .eq("id", job.id);
            waiting++;
          } else {
            await db.from("jobs").update({ status: "done", result: out ?? null, last_error: null }).eq("id", job.id);
            processed++;
          }
        } catch (e) {
          const msg = String((e as Error)?.message ?? e).slice(0, 1000);
          const limited = e as { rateLimited?: boolean; retryAfterMs?: number };
          if (limited?.rateLimited) {
            // Out of free quota: wait it out without using up an attempt.
            await db
              .from("jobs")
              .update({ status: "queued", attempts: job.attempts - 1, last_error: msg, run_after: new Date(Date.now() + Math.max(limited.retryAfterMs ?? 0, 60_000)).toISOString() })
              .eq("id", job.id);
            waiting++;
            return;
          }
          // Config errors (missing API key etc.) won't fix themselves: fail now instead of burning retries.
          const retryable = (e as { retryable?: boolean })?.retryable !== false && !/ is not set$/.test(msg);
          const final = !retryable || job.attempts >= job.max_attempts;
          await db
            .from("jobs")
            .update({
              status: final ? "failed" : "queued",
              last_error: msg,
              run_after: new Date(Date.now() + 30_000 * 2 ** job.attempts).toISOString(),
            })
            .eq("id", job.id);
          failed++;
        }
      }),
    );
  }
  return { processed, failed, waiting };
}
