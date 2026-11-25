"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { unstable_rethrow } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { parseCreatorsCsv } from "@/lib/ingestion/csv";
import { cleanHandle, num, parsePlatform, profileUrl, rate, isoDate } from "@/lib/ingestion/normalize";
import { enqueue, queueEmailSend, runJobs } from "@/lib/jobs/runner";
import { analyzeCreator, generateOutreach } from "@/lib/services/ai";
import { rescoreCreator, setStatus, upsertCreators } from "@/lib/services/creators";
import { OutreachBlocked, addToDoNotContact, approveMessage, logReply, markSentManually, sendApprovedEmail } from "@/lib/services/crm";
import { integrations } from "@/lib/env";
import { getSettings } from "@/lib/services/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/server";
import { CREATOR_STATUSES, type Creator, type CreatorStatus, type MessageChannel } from "@/lib/types";

type Ctx = Awaited<ReturnType<typeof requireUser>>;

/** Auth + error wrapper: every action verifies the session and returns a toast-able result. */
function action(fn: (ctx: Ctx, fd: FormData) => Promise<string | void>) {
  return async (_prev: ActionResult | null, fd: FormData): Promise<ActionResult> => {
    try {
      const ctx = await requireUser();
      const message = await fn(ctx, fd);
      revalidatePath("/", "layout");
      return { ok: true, message: message ?? undefined };
    } catch (e) {
      unstable_rethrow(e);
      console.error(e);
      const msg = e instanceof OutreachBlocked ? e.message : ((e as Error)?.message ?? "Something went wrong");
      return { ok: false, message: msg };
    }
  };
}

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

// ───────────────────────── ingestion ─────────────────────────

export const importCsv = action(async ({ supabase, user }, fd) => {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Choose a CSV file.");
  if (file.size > 5_000_000) throw new Error("CSV is larger than 5 MB — split it up.");
  const { creators, errors } = parseCreatorsCsv(await file.text());
  if (!creators.length) throw new Error(errors[0] ?? "No valid rows found.");
  const r = await upsertCreators(supabase, user.id, creators, "csv", file.name);
  return `Imported ${r.inserted} new, updated ${r.updated}${r.skippedDnc ? `, skipped ${r.skippedDnc} on do-not-contact` : ""}${
    r.failed.length ? `, ${r.failed.length} failed (${r.failed[0].error})` : ""
  }${errors.length ? `. ${errors.length} row issue(s): ${errors[0]}` : ""}.`;
});

export const addCreatorManual = action(async ({ supabase, user }, fd) => {
  const platform = parsePlatform(s(fd, "platform"));
  const handle = cleanHandle(s(fd, "handle"));
  if (!platform || !handle) throw new Error("Platform and handle are required.");
  const r = await upsertCreators(
    supabase,
    user.id,
    [
      {
        platform,
        handle,
        profile_url: profileUrl(platform, handle),
        display_name: s(fd, "display_name") || null,
        bio: s(fd, "bio") || null,
        followers: num(s(fd, "followers")),
        following: null,
        total_posts: null,
        business_email: s(fd, "business_email").toLowerCase() || null,
        external_url: s(fd, "external_url") || null,
        niche: s(fd, "niche") || null,
        posts: [],
        provided: {
          median_views: num(s(fd, "median_views")),
          engagement_rate: rate(s(fd, "engagement_rate")),
          posts_last_30d: num(s(fd, "posts_last_30d")),
          last_posted_at: isoDate(s(fd, "last_posted_at")),
        },
      },
    ],
    "manual",
    "manual entry",
  );
  if (r.skippedDnc) throw new OutreachBlocked(`@${handle} is on the do-not-contact list.`);
  if (r.failed.length) throw new Error(r.failed[0].error);
  return `${r.inserted ? "Added" : "Updated"} @${handle}.`;
});

export const queueApifyProfiles = action(async ({ supabase, user }, fd) => {
  const platform = parsePlatform(s(fd, "platform"));
  const handles = [...new Set(s(fd, "handles").split(/[\s,]+/).map(cleanHandle).filter(Boolean))];
  if (!platform || !handles.length) throw new Error("Choose a platform and enter at least one handle.");
  if (handles.length > 200) throw new Error("Max 200 handles per run.");
  await enqueue(supabase, user.id, "apify_profiles", { platform, handles, autoAnalyze: fd.get("autoAnalyze") === "on" });
  return `Queued Apify collection for ${handles.length} ${platform} profile(s). Process the queue from here or wait for the cron.`;
});

export const queueApifyHashtag = action(async ({ supabase, user }, fd) => {
  const platform = parsePlatform(s(fd, "platform"));
  const hashtags = s(fd, "hashtags").split(/[\s,]+/).filter(Boolean);
  const actor = s(fd, "actor");
  if (!platform || !hashtags.length || !actor) throw new Error("Platform, hashtags and actor are required.");
  await enqueue(supabase, user.id, "apify_hashtag", {
    platform,
    hashtags,
    actor,
    limit: Number(s(fd, "limit") || 100),
    maxNew: Number(s(fd, "maxNew") || 50),
    autoAnalyze: fd.get("autoAnalyze") === "on",
  });
  return `Queued hashtag discovery for ${hashtags.join(", ")}.`;
});

export const processQueue = action(async ({ user }) => {
  // Service role, but scoped to the current user's jobs.
  const r = await runJobs(createAdminClient(), { ownerId: user.id, budgetMs: 200_000 });
  return `Processed ${r.processed} job(s)${r.waiting ? `, ${r.waiting} waiting (Apify run or free LLM quota)` : ""}${r.failed ? `, ${r.failed} failed (will retry)` : ""}.`;
});

/** Short queue run for the Activity page's auto-run loop (called repeatedly from the client). */
export async function runQueueTick() {
  const { user } = await requireUser();
  return runJobs(createAdminClient(), { ownerId: user.id, budgetMs: 20_000 });
}

const jobIdsFrom = (fd: FormData) => s(fd, "jobIds").split(",").filter(Boolean);

export const retryFailedJobs = action(async ({ supabase }, fd) => {
  const ids = jobIdsFrom(fd);
  // RLS limits this to the user's own jobs. Config failures also leave "queued" jobs with an error; reset those too.
  const { data, error } = await supabase
    .from("jobs")
    .update({ status: "queued", attempts: 0, last_error: null, run_after: new Date().toISOString() })
    .in("id", ids)
    .or("status.eq.failed,last_error.not.is.null")
    .neq("status", "done")
    .select("id");
  if (error) throw error;
  return `Re-queued ${data?.length ?? 0} job(s).`;
});

export const cancelPendingJobs = action(async ({ supabase }, fd) => {
  const { data, error } = await supabase
    .from("jobs")
    .update({ status: "failed", last_error: "Cancelled by you" })
    .in("id", jobIdsFrom(fd))
    .eq("status", "queued")
    .select("id");
  if (error) throw error;
  return `Cancelled ${data?.length ?? 0} pending job(s).`;
});

export const rescoreAll = action(async ({ supabase, user }) => {
  const settings = await getSettings(supabase, user.id);
  const { data } = await supabase.from("creators").select("id").eq("owner_id", user.id);
  for (const c of data ?? []) await rescoreCreator(supabase, user.id, c.id, settings);
  return `Rescored ${data?.length ?? 0} creators.`;
});

// ───────────────────────── AI ─────────────────────────

export const analyze = action(async ({ supabase, user }, fd) => {
  const r = await analyzeCreator(supabase, user.id, s(fd, "creatorId"), { fresh: fd.get("fresh") === "on" });
  return `Analysis complete${r.droppedCount ? ` — ${r.droppedCount} ungrounded claim(s) removed` : ""}.`;
});

export const bulkAnalyze = action(async ({ supabase, user }, fd) => {
  const ids = fd.getAll("ids").map(String).filter(Boolean);
  if (!ids.length) throw new Error("Select at least one creator.");
  for (const id of ids) await enqueue(supabase, user.id, "analyze", { creatorId: id });
  return `Queued ${ids.length} analysis job(s).`;
});

export const generate = action(async ({ supabase, user }, fd) => {
  const proposition = (s(fd, "proposition") || "open") as "mvp" | "partnership" | "open";
  const r = await generateOutreach(supabase, user.id, s(fd, "creatorId"), {
    proposition,
    includeBudget: fd.get("includeBudget") === "on",
    extraInstructions: s(fd, "extra") || undefined,
    fresh: fd.get("fresh") === "on",
  });
  return r.issues.length ? `Drafts ready — ${r.issues.length} item(s) flagged for review.` : "Drafts ready for review.";
});

// ───────────────────────── messages ─────────────────────────

const AUTO_SEND_DELAY_SEC = 30;

export const approve = action(async ({ supabase, user }, fd) => {
  const body = s(fd, "body");
  if (!body) throw new Error("Message body is empty.");
  const messageId = s(fd, "messageId");
  const m = await approveMessage(supabase, user.id, messageId, body, s(fd, "subject") || null);
  if (m.channel !== "email" || !m.hasEmail || !integrations().resend) return "Approved.";

  // Auto-send: queue it with a short window to discard, then run the queue after responding so it goes out
  // without any page open. In production the cron also picks up anything left over.
  const admin = createAdminClient();
  await queueEmailSend(admin, user.id, messageId, m.creatorId, AUTO_SEND_DELAY_SEC);
  after(async () => {
    await new Promise((r) => setTimeout(r, (AUTO_SEND_DELAY_SEC + 2) * 1000));
    await runJobs(admin, { ownerId: user.id, budgetMs: 60_000 }).catch((e) => console.error("auto-send", e));
  });
  return `Approved — sending automatically in ${AUTO_SEND_DELAY_SEC} seconds. Discard it in Outreach Inbox to cancel.`;
});

export const saveDraft = action(async ({ supabase, user }, fd) => {
  await supabase
    .from("messages")
    .update({ body: s(fd, "body"), subject: s(fd, "subject") || null })
    .eq("id", s(fd, "messageId"))
    .eq("owner_id", user.id)
    .in("state", ["draft", "approved"]);
  return "Saved.";
});

export const discard = action(async ({ supabase, user }, fd) => {
  await supabase.from("messages").update({ state: "discarded" }).eq("id", s(fd, "messageId")).eq("owner_id", user.id).neq("state", "sent");
  return "Discarded.";
});

export const markSent = action(async ({ supabase, user }, fd) => {
  const { data: m } = await supabase.from("messages").select("body").eq("id", s(fd, "messageId")).eq("owner_id", user.id).single();
  await markSentManually(supabase, user.id, s(fd, "messageId"), s(fd, "sentBody") || m?.body || "");
  return "Marked as sent. Follow-up scheduled in 5 days.";
});

export const sendEmail = action(async ({ supabase, user }, fd) => {
  await sendApprovedEmail(supabase, user.id, s(fd, "messageId"));
  return "Email sent.";
});

// ───────────────────────── CRM ─────────────────────────

export const recordReply = action(async ({ supabase, user }, fd) => {
  const body = s(fd, "body");
  if (!body) throw new Error("Paste the reply text.");
  await logReply(supabase, user.id, s(fd, "creatorId"), {
    body,
    channel: (s(fd, "channel") || "email") as MessageChannel,
    sentiment: (s(fd, "sentiment") || "neutral") as "positive" | "neutral" | "negative",
  });
  return "Reply logged.";
});

export const updateStatus = action(async ({ supabase, user }, fd) => {
  const to = s(fd, "status") as CreatorStatus;
  if (!CREATOR_STATUSES.includes(to)) throw new Error("Invalid status");
  const id = s(fd, "creatorId");
  if (to === "do_not_contact") {
    const { data: c } = await supabase.from("creators").select("*").eq("id", id).eq("owner_id", user.id).single<Creator>();
    if (!c) throw new Error("Creator not found");
    await addToDoNotContact(supabase, user.id, c, "Marked do-not-contact from pipeline");
    return "Added to do-not-contact list.";
  }
  const { data: cur } = await supabase.from("creators").select("status").eq("id", id).eq("owner_id", user.id).single();
  if (cur?.status === "do_not_contact") throw new OutreachBlocked("Do-not-contact is permanent.");
  await setStatus(supabase, user.id, id, to, cur?.status);
  return "Status updated.";
});

export const saveCrmFields = action(async ({ supabase, user }, fd) => {
  const id = s(fd, "creatorId");
  const followUp = s(fd, "follow_up_at") || null;
  const { data: before } = await supabase.from("creators").select("notes, follow_up_at").eq("id", id).eq("owner_id", user.id).single();
  await supabase
    .from("creators")
    .update({ notes: s(fd, "notes") || null, collaboration_opportunities: s(fd, "collaboration_opportunities") || null, follow_up_at: followUp })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (followUp && followUp !== before?.follow_up_at)
    await supabase.from("contact_events").insert({ owner_id: user.id, creator_id: id, type: "follow_up_set", body: `Follow-up set for ${followUp}` });
  return "Saved.";
});

export const addNote = action(async ({ supabase, user }, fd) => {
  const body = s(fd, "body");
  if (!body) throw new Error("Note is empty.");
  await supabase.from("contact_events").insert({ owner_id: user.id, creator_id: s(fd, "creatorId"), type: s(fd, "type") || "note", body });
  return "Added to timeline.";
});

export const markDoNotContact = action(async ({ supabase, user }, fd) => {
  const { data: c } = await supabase.from("creators").select("*").eq("id", s(fd, "creatorId")).eq("owner_id", user.id).single<Creator>();
  if (!c) throw new Error("Creator not found");
  await addToDoNotContact(supabase, user.id, c, s(fd, "reason") || "Manual");
  return `@${c.handle} added to the do-not-contact list.`;
});

export const addDncEntry = action(async ({ supabase, user }, fd) => {
  const platform = parsePlatform(s(fd, "platform"));
  const handle = s(fd, "handle") ? cleanHandle(s(fd, "handle")) : null;
  const email = s(fd, "email").toLowerCase() || null;
  if (!handle && !email) throw new Error("Enter a handle or an email.");
  if (handle && !platform) throw new Error("Choose the platform for the handle.");
  const { error } = await supabase
    .from("do_not_contact")
    .insert({ owner_id: user.id, platform: handle ? platform : null, handle, email, reason: s(fd, "reason") || "Manual" });
  if (error && error.code !== "23505") throw error;
  // Also flag any matching creator
  if (handle && platform) {
    const { data: c } = await supabase.from("creators").select("*").eq("owner_id", user.id).eq("platform", platform).eq("handle", handle).maybeSingle<Creator>();
    if (c) await addToDoNotContact(supabase, user.id, c, s(fd, "reason") || "Manual");
  }
  return "Added to do-not-contact list.";
});

// ───────────────────────── settings ─────────────────────────

export const saveSettings = action(async ({ supabase, user }, fd) => {
  await getSettings(supabase, user.id);
  const n = (k: string, d: number) => {
    const v = Number(s(fd, k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const { error } = await supabase
    .from("settings")
    .update({
      sender_name: s(fd, "sender_name"),
      sender_bio: s(fd, "sender_bio"),
      sender_email: s(fd, "sender_email") || null,
      target_niches: s(fd, "target_niches").split(",").map((x) => x.trim()).filter(Boolean),
      min_followers: n("min_followers", 10000),
      max_followers: n("max_followers", 100000),
      daily_email_limit: n("daily_email_limit", 20),
      llm_provider: s(fd, "llm_provider") || "anthropic",
      analysis_model: s(fd, "analysis_model") || "claude-opus-5-5",
      outreach_model: s(fd, "outreach_model") || "claude-opus-5-5",
      apify_instagram_actor: s(fd, "apify_instagram_actor") || "apify/instagram-profile-scraper",
      apify_tiktok_actor: s(fd, "apify_tiktok_actor") || "clockworks/tiktok-profile-scraper",
      auto_draft: fd.get("auto_draft") === "on",
      auto_draft_min_score: Math.min(100, Math.max(0, Math.round(Number(s(fd, "auto_draft_min_score")) || 55))),
      auto_draft_proposition: (["mvp", "partnership", "open"].includes(s(fd, "auto_draft_proposition")) ? s(fd, "auto_draft_proposition") : "open"),
      auto_draft_include_budget: fd.get("auto_draft_include_budget") === "on",
    })
    .eq("owner_id", user.id);
  if (error) throw error;
  return "Settings saved. Use “Rescore all” to apply new niche/follower settings to existing creators.";
});

export const snoozeFollowUp = action(async ({ supabase, user }, fd) => {
  const days = Number(s(fd, "days") || 3);
  const d = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  await supabase.from("creators").update({ follow_up_at: d }).eq("id", s(fd, "creatorId")).eq("owner_id", user.id);
  return `Follow-up moved to ${d}.`;
});

export const clearFollowUp = action(async ({ supabase, user }, fd) => {
  await supabase.from("creators").update({ follow_up_at: null }).eq("id", s(fd, "creatorId")).eq("owner_id", user.id);
  return "Follow-up cleared.";
});
