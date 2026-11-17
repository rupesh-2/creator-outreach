import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANALYSIS_SYSTEM, AnalysisSchema, buildAnalysisPrompt, groundAnalysis, type AnalysisResult } from "@/lib/ai/analysis";
import { buildEvidence, type Evidence } from "@/lib/ai/evidence";
import { OUTREACH_SYSTEM, OutreachSchema, availableChannels, buildOutreachPrompt, fallbackChannel, lintOutreach } from "@/lib/ai/outreach";
import { generateJson } from "@/lib/llm";
import type { Creator, CreatorPost, MessageChannel } from "@/lib/types";
import { advanceStatus, rescoreCreator } from "./creators";
import { getSettings } from "./settings";

async function loadCreator(db: SupabaseClient, ownerId: string, creatorId: string) {
  const { data: creator } = await db.from("creators").select("*").eq("id", creatorId).eq("owner_id", ownerId).single<Creator>();
  if (!creator) throw new Error("Creator not found");
  const { data: posts } = await db
    .from("creator_posts")
    .select("*")
    .eq("creator_id", creatorId)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(15);
  return { creator, posts: (posts ?? []) as CreatorPost[] };
}

/** Settings model fields apply to Anthropic/OpenAI only; free providers pick their own model per endpoint. */
const modelFor = (provider: string, model: string) => (provider === "anthropic" || provider === "openai" ? model : "auto");

export async function analyzeCreator(db: SupabaseClient, ownerId: string, creatorId: string, opts: { fresh?: boolean } = {}) {
  const settings = await getSettings(db, ownerId);
  const { creator, posts } = await loadCreator(db, ownerId, creatorId);
  const evidence = buildEvidence(creator, posts);

  const { data, model } = await generateJson({
    db,
    ownerId,
    task: "analysis",
    provider: settings.llm_provider,
    model: modelFor(settings.llm_provider, settings.analysis_model),
    system: ANALYSIS_SYSTEM,
    prompt: buildAnalysisPrompt(creator, evidence, settings.target_niches),
    schema: AnalysisSchema,
    schemaName: "creator_analysis",
    maxTokens: 8000,
    effort: "medium",
    useCache: !opts.fresh,
  });
  const { result, dropped } = groundAnalysis(data, evidence);

  const { data: saved, error } = await db
    .from("analyses")
    .insert({ owner_id: ownerId, creator_id: creatorId, result, evidence, dropped_claims: dropped, provider: settings.llm_provider, model })
    .select("id")
    .single();
  if (error) throw error;

  if (result.collaboration_opportunities.length && !creator.collaboration_opportunities)
    await db
      .from("creators")
      .update({ collaboration_opportunities: result.collaboration_opportunities.map((o) => `• ${o.opportunity}`).join("\n") })
      .eq("id", creatorId);

  await advanceStatus(db, ownerId, creatorId, "analyzed");
  await rescoreCreator(db, ownerId, creatorId, settings); // niche from analysis feeds niche relevance; may promote to qualified
  return { analysisId: saved.id as string, droppedCount: dropped.length };
}

export interface OutreachOptions {
  proposition: "mvp" | "partnership" | "open";
  includeBudget: boolean;
  extraInstructions?: string;
  fresh?: boolean;
}

export async function generateOutreach(db: SupabaseClient, ownerId: string, creatorId: string, opts: OutreachOptions) {
  const settings = await getSettings(db, ownerId);
  const { creator } = await loadCreator(db, ownerId, creatorId);

  const { data: analysis } = await db
    .from("analyses")
    .select("id, result, evidence")
    .eq("creator_id", creatorId)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!analysis) throw new Error("Run the AI analysis first — outreach is grounded in it.");
  const evidence = analysis.evidence as Evidence[];
  const channels = availableChannels(creator);

  const { data: out } = await generateJson({
    db,
    ownerId,
    task: "outreach",
    provider: settings.llm_provider,
    model: modelFor(settings.llm_provider, settings.outreach_model),
    system: OUTREACH_SYSTEM,
    prompt: buildOutreachPrompt({ creator, evidence, analysis: analysis.result as AnalysisResult, settings, ...opts }),
    schema: OutreachSchema,
    schemaName: "creator_outreach",
    maxTokens: 6000,
    effort: "medium",
    useCache: !opts.fresh,
  });

  const issues = lintOutreach(out, { includeBudget: opts.includeBudget, evidence, channels });
  const recommended: MessageChannel = channels.includes(out.recommended_channel) ? out.recommended_channel : fallbackChannel(channels);
  const channelReason = channels.includes(out.recommended_channel)
    ? out.channel_reason
    : `${recommended} chosen automatically (model suggested an unavailable channel).`;
  const batch = randomUUID();
  const meta = { observation: out.observation, why_good_candidate: out.why_good_candidate, channel_reason: channelReason, issues, options: opts };

  // Discard older unsent drafts so the review queue shows only the latest batch.
  await db.from("messages").update({ state: "discarded" }).eq("creator_id", creatorId).eq("owner_id", ownerId).eq("state", "draft");

  const base = { owner_id: ownerId, creator_id: creatorId, analysis_id: analysis.id, batch_id: batch, state: "draft", meta, rationale: out.why_good_candidate.text };
  const rows = [
    { ...base, channel: "instagram_dm", kind: "initial", body: out.instagram_dm, generated_body: out.instagram_dm, recommended: recommended === "instagram_dm" },
    { ...base, channel: "tiktok_dm", kind: "initial", body: out.tiktok_dm, generated_body: out.tiktok_dm, recommended: recommended === "tiktok_dm" },
    { ...base, channel: "email", kind: "initial", subject: out.email_subject, body: out.email_body, generated_body: out.email_body, recommended: recommended === "email" },
    { ...base, channel: recommended, kind: "follow_up", body: out.follow_up, generated_body: out.follow_up, recommended: false },
  ];
  const { error } = await db.from("messages").insert(rows);
  if (error) throw error;
  await advanceStatus(db, ownerId, creatorId, "pending_review");
  return { batchId: batch, issues };
}
