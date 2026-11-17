import type { Priority, ScoreBreakdown, ScoreComponent } from "@/lib/types";
import type { AggregateMetrics } from "./metrics";

export interface ScoreInput {
  followers: number | null;
  following: number | null;
  bio: string | null;
  niche: string | null;
  business_email: string | null;
  external_url: string | null;
  captions: string[];
  metrics: AggregateMetrics;
}

export interface ScoreConfig {
  target_niches: string[];
  min_followers: number;
  max_followers: number;
  now?: Date;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (n: number) => Intl.NumberFormat("en", { notation: "compact" }).format(n);

export function priorityFor(total: number): Priority {
  if (total >= 70) return "high";
  if (total >= 55) return "medium";
  return "low";
}

function followerSuitability(i: ScoreInput, c: ScoreConfig): ScoreComponent {
  const base = { key: "followers", label: "Follower suitability", max: 10 };
  const f = i.followers;
  if (f == null) return { ...base, points: 0, reason: "Follower count not collected.", confidence: "insufficient_data" };
  const { min_followers: lo, max_followers: hi } = c;
  const span = hi - lo;
  let points: number;
  let reason: string;
  if (f >= lo && f <= hi) {
    // Full points in the middle 60% of the band, 8 at the edges.
    const pos = (f - lo) / span;
    points = pos >= 0.05 && pos <= 0.6 ? 10 : 8;
    reason = `${fmt(f)} followers is inside the ${fmt(lo)}–${fmt(hi)} target range.`;
  } else if (f >= lo * 0.8 && f <= hi * 1.2) {
    points = 4;
    reason = `${fmt(f)} followers is just outside the ${fmt(lo)}–${fmt(hi)} target range.`;
  } else {
    points = 0;
    reason = `${fmt(f)} followers is outside the target range.`;
  }
  return { ...base, points, reason, confidence: "measured" };
}

function averageViews(i: ScoreInput): ScoreComponent {
  const base = { key: "views", label: "Video views", max: 25 };
  const m = i.metrics;
  const typical = m.median_views ?? m.avg_views;
  if (typical == null) return { ...base, points: 0, reason: "No view counts collected for recent videos.", confidence: "insufficient_data" };

  // Absolute reach: 0–10
  const abs = typical >= 50_000 ? 10 : typical >= 20_000 ? 8 : typical >= 10_000 ? 6 : typical >= 5_000 ? 4 : typical >= 2_000 ? 2 : 0;
  // Reach relative to audience: 0–15
  let rel = 0;
  let relText = "";
  if (i.followers) {
    const r = typical / i.followers;
    rel = r >= 0.6 ? 15 : r >= 0.35 ? 12 : r >= 0.2 ? 9 : r >= 0.1 ? 6 : r >= 0.04 ? 3 : 0;
    relText = ` (${pct(r)} of followers)`;
  }
  const lowSample = m.sample_size < 5;
  return {
    ...base,
    points: abs + rel,
    reason: `Median views ${fmt(typical)}${relText} across ${m.sample_size} recent posts.${lowSample ? " Small sample." : ""}`,
    confidence: lowSample || !i.followers ? "estimated" : "measured",
  };
}

function engagement(i: ScoreInput): ScoreComponent {
  const base = { key: "engagement", label: "Engagement", max: 20 };
  const er = i.metrics.engagement_rate;
  if (er == null) return { ...base, points: 0, reason: "No likes/comments data collected.", confidence: "insufficient_data" };
  if (i.metrics.engagement_estimated) {
    // per-follower engagement benchmarks are lower than per-view
    const points = er >= 0.06 ? 16 : er >= 0.03 ? 12 : er >= 0.015 ? 8 : er >= 0.007 ? 4 : 0;
    return { ...base, points, reason: `${pct(er)} engagement per follower (no view counts, so this is estimated).`, confidence: "estimated" };
  }
  const points = er >= 0.08 ? 20 : er >= 0.05 ? 16 : er >= 0.03 ? 11 : er >= 0.02 ? 7 : er >= 0.01 ? 3 : 0;
  return { ...base, points, reason: `${pct(er)} average (likes + comments) / views on recent videos.`, confidence: "measured" };
}

function consistency(i: ScoreInput, now: Date): ScoreComponent {
  const base = { key: "consistency", label: "Posting consistency", max: 10 };
  const { posts_last_30d: n, last_posted_at } = i.metrics;
  if (n == null || !last_posted_at)
    return { ...base, points: 0, reason: "Post dates not collected.", confidence: "insufficient_data" };
  const daysSince = Math.floor((now.getTime() - new Date(last_posted_at).getTime()) / 86_400_000);
  if (daysSince > 30) return { ...base, points: 0, reason: `Last post was ${daysSince} days ago — looks inactive.`, confidence: "measured" };
  const points = n >= 12 ? 10 : n >= 8 ? 8 : n >= 4 ? 6 : n >= 2 ? 3 : 1;
  // If we only scraped e.g. 6 posts and all are in the window, the true count may be higher.
  const capped = n === i.metrics.sample_size;
  return {
    ...base,
    points,
    reason: `${n}${capped ? "+" : ""} posts in the last 30 days; last post ${daysSince}d ago.`,
    confidence: capped ? "estimated" : "measured",
  };
}

export function nicheMatches(text: string, niches: string[]): string[] {
  const t = text.toLowerCase();
  return niches.filter((n) => {
    const kw = n.trim().toLowerCase();
    return kw && new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t);
  });
}

function nicheRelevance(i: ScoreInput, c: ScoreConfig): ScoreComponent {
  const base = { key: "niche", label: "Niche relevance", max: 15 };
  if (!c.target_niches.length)
    return { ...base, points: 8, reason: "No target niches configured in Settings — neutral score.", confidence: "estimated" };
  const corpus = [i.niche ?? "", i.bio ?? "", ...i.captions].join(" \n ");
  if (!corpus.trim()) return { ...base, points: 0, reason: "No bio, niche or captions to match against.", confidence: "insufficient_data" };
  const hits = nicheMatches(corpus, c.target_niches);
  const nicheHit = i.niche ? nicheMatches(i.niche, c.target_niches).length > 0 : false;
  const points = nicheHit ? 15 : hits.length >= 2 ? 13 : hits.length === 1 ? 9 : 0;
  return {
    ...base,
    points,
    reason: hits.length ? `Matches target niche keyword(s): ${hits.join(", ")}.` : "No target niche keywords found in bio, niche or captions.",
    confidence: "estimated",
  };
}

/**
 * Heuristic *indicators* only. We cannot verify fake followers from public metrics;
 * this subtracts points for patterns that commonly correlate with inauthentic audiences.
 */
function authenticity(i: ScoreInput): ScoreComponent {
  const base = { key: "authenticity", label: "Audience authenticity indicators", max: 10 };
  const m = i.metrics;
  if (m.sample_size < 3)
    return { ...base, points: 5, reason: "Fewer than 3 posts collected — not enough evidence either way (neutral).", confidence: "insufficient_data" };
  let points = 10;
  const flags: string[] = [];
  const typical = m.median_views ?? m.avg_views;
  if (i.followers && typical != null && typical / i.followers < 0.02) {
    points -= 4;
    flags.push(`views are under 2% of followers`);
  }
  if (m.engagement_rate != null && !m.engagement_estimated && m.engagement_rate > 0.3) {
    points -= 3;
    flags.push(`unusually high engagement (${pct(m.engagement_rate)}) — could be engagement pods or a small sample`);
  }
  if (i.followers && i.following && i.following > i.followers * 0.8) {
    points -= 3;
    flags.push(`following count is close to or above follower count`);
  }
  if (m.views_cv != null && m.views_cv < 0.08 && m.sample_size >= 5) {
    points -= 2;
    flags.push(`view counts are suspiciously uniform`);
  }
  points = Math.max(0, points);
  return {
    ...base,
    points,
    reason: flags.length
      ? `Indicators flagged: ${flags.join("; ")}. These are signals, not proof.`
      : "No common red-flag patterns in public metrics. This is not a verification of audience authenticity.",
    confidence: "estimated",
  };
}

const BUSINESS_HINTS = /\b(collab|collabs|business|partnerships?|inquir(y|ies)|brand deals?|shop|store|course|coach|coaching|app|newsletter|podcast|founder|ceo|book|merch|program|membership|community|link in bio)\b/i;

function collaborationPotential(i: ScoreInput): ScoreComponent {
  const base = { key: "collab", label: "Collaboration potential", max: 10 };
  let points = 0;
  const reasons: string[] = [];
  if (i.business_email) {
    points += 5;
    reasons.push("public business email");
  }
  if (i.external_url) {
    points += 2;
    reasons.push("external link in profile");
  }
  const hint = i.bio?.match(BUSINESS_HINTS);
  if (hint) {
    points += 3;
    reasons.push(`bio mentions "${hint[0]}"`);
  }
  return {
    ...base,
    points: Math.min(10, points),
    reason: reasons.length ? `Signals: ${reasons.join(", ")}.` : "No public business contact or business signals in profile.",
    confidence: i.bio == null ? "insufficient_data" : "measured",
  };
}

export function scoreCreator(input: ScoreInput, config: ScoreConfig): ScoreBreakdown {
  const now = config.now ?? new Date();
  const components = [
    followerSuitability(input, config),
    averageViews(input),
    engagement(input),
    consistency(input, now),
    nicheRelevance(input, config),
    authenticity(input),
    collaborationPotential(input),
  ];
  const total = Math.round(components.reduce((a, c) => a + c.points, 0));
  const warnings = components.filter((c) => c.confidence === "insufficient_data").map((c) => `${c.label}: ${c.reason}`);
  return { total, priority: priorityFor(total), components, warnings };
}
