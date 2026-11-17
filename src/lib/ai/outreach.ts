import { z } from "zod";
import type { Creator, MessageChannel, Settings } from "@/lib/types";
import type { AnalysisResult } from "./analysis";
import { renderEvidence, type Evidence } from "./evidence";

export const OutreachSchema = z.object({
  observation: z.object({
    text: z.string().describe("One specific, genuine observation about their content, in plain words"),
    evidence: z.array(z.string()),
  }),
  why_good_candidate: z.object({ text: z.string(), evidence: z.array(z.string()) }),
  instagram_dm: z.string(),
  tiktok_dm: z.string(),
  email_subject: z.string(),
  email_body: z.string(),
  follow_up: z.string(),
  recommended_channel: z.enum(["email", "instagram_dm", "tiktok_dm"]),
  channel_reason: z.string(),
});
export type OutreachResult = z.infer<typeof OutreachSchema>;

export const OUTREACH_SYSTEM = `You write first-contact messages from an independent software engineer to a content creator.

Goal: start a genuine conversation, not close a deal.

Every message must:
- Open with ONE specific observation grounded in the EVIDENCE table (cite ids in observation.evidence). Refer to a real post, theme or bio detail. Do not exaggerate.
- Say plainly why the sender wants to connect, and introduce the sender as a software engineer (use the SENDER block; never invent credentials).
- Suggest ONE relevant, low-pressure collaboration idea drawn from the ANALYSIS (e.g. a tool that could help with a problem they may have) and frame it as a question or idea, not a pitch.
- Sound like a real person: short sentences, warm, professional, no hype.

Never:
- Use agency/sales language ("scale your brand", "synergy", "exclusive opportunity", "take your content to the next level", "I help creators…", "quick call?").
- Claim to be a fan, to have used their products, to know their audience, or to have "been following for a while".
- Fabricate any detail, number or compliment not supported by evidence.
- Mention money, budgets or pricing unless BUDGET_ALLOWED is yes.
- Use more than one emoji per message.

Lengths: Instagram DM and TikTok DM ≤ 450 characters. Email body 90–160 words, plain text, no signature block beyond the sender's first name (an unsubscribe line is added automatically). Follow-up ≤ 300 characters, polite, references the first message, gives an easy out.

Channel recommendation: prefer email when a public business email exists (it is the creator's stated channel for business). Only recommend a DM channel that matches their platform. Note that TikTok DMs can be restricted by the creator's privacy settings. Use the AVAILABLE_CHANNELS list.`;

export function availableChannels(c: Creator): MessageChannel[] {
  const ch: MessageChannel[] = [];
  if (c.business_email) ch.push("email");
  ch.push(c.platform === "instagram" ? "instagram_dm" : "tiktok_dm");
  return ch;
}

export function buildOutreachPrompt(args: {
  creator: Creator;
  evidence: Evidence[];
  analysis: AnalysisResult;
  settings: Settings;
  includeBudget: boolean;
  proposition: "mvp" | "partnership" | "open";
  extraInstructions?: string;
}): string {
  const { creator: c, settings: s } = args;
  const prop = {
    mvp: "Option A: build a customised MVP for them (initial budget $1,500–$2,000 — only mention the figure if BUDGET_ALLOWED is yes).",
    partnership: "Option B: a partnership — the sender contributes engineering/product, the creator contributes domain knowledge, feedback and possibly distribution.",
    open: "Keep it open: invite a conversation about problems they face that software could solve; either a custom build or a partnership could follow later.",
  }[args.proposition];

  return `SENDER:
Name: ${s.sender_name || "(first name not set)"}
About: ${s.sender_bio}

EVIDENCE:
${renderEvidence(args.evidence)}

ANALYSIS (already grounded in the evidence above):
${JSON.stringify(args.analysis, null, 1)}

COLLABORATION PROPOSITION: ${prop}
BUDGET_ALLOWED: ${args.includeBudget ? "yes" : "no"}
AVAILABLE_CHANNELS: ${availableChannels(c).join(", ")}
CREATOR: @${c.handle} on ${c.platform}${c.display_name ? ` (${c.display_name})` : ""}
${args.extraInstructions ? `\nOPERATOR NOTES: ${args.extraInstructions}` : ""}`;
}

// ───────────────────────── post-generation checks ─────────────────────────

const SALESY = [
  /scale your (brand|business)/i,
  /synerg/i,
  /exclusive opportunity/i,
  /next level/i,
  /\bI help creators\b/i,
  /quick call/i,
  /game[- ]?changer/i,
  /huge fan/i,
  /been following (you )?for/i,
  /love your (content|work)!/i,
  /\bguarantee/i,
  /\bROI\b/,
];

export interface LintIssue {
  field: string;
  issue: string;
}

export function lintOutreach(r: OutreachResult, opts: { includeBudget: boolean; evidence: Evidence[]; channels: MessageChannel[] }): LintIssue[] {
  const issues: LintIssue[] = [];
  const ids = new Set(opts.evidence.map((e) => e.id));
  if (!r.observation.evidence.length || !r.observation.evidence.every((id) => ids.has(id)))
    issues.push({ field: "observation", issue: "Observation is not grounded in collected evidence." });

  const fields: [string, string, number][] = [
    ["instagram_dm", r.instagram_dm, 450],
    ["tiktok_dm", r.tiktok_dm, 450],
    ["email_body", r.email_body, 1400],
    ["follow_up", r.follow_up, 300],
  ];
  for (const [field, text, max] of fields) {
    if (text.length > max) issues.push({ field, issue: `Too long (${text.length}/${max} chars).` });
    for (const re of SALESY) if (re.test(text)) issues.push({ field, issue: `Sales-y phrasing: "${text.match(re)![0]}"` });
    if (!opts.includeBudget && /\$\s?\d|\bbudget\b|\busd\b/i.test(text)) issues.push({ field, issue: "Mentions money although budget is off." });
  }
  if (!opts.channels.includes(r.recommended_channel))
    issues.push({ field: "recommended_channel", issue: `${r.recommended_channel} is not available for this creator.` });
  return issues;
}

/** Deterministic channel choice when the model's pick isn't available. */
export function fallbackChannel(channels: MessageChannel[]): MessageChannel {
  return channels.includes("email") ? "email" : channels[0];
}
