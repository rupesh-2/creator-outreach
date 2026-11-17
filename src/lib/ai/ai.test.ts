import { describe, expect, it } from "vitest";
import type { Creator, CreatorPost } from "@/lib/types";
import { groundAnalysis, type AnalysisResult } from "./analysis";
import { buildEvidence, filterGrounded } from "./evidence";
import { availableChannels, lintOutreach, type OutreachResult } from "./outreach";

const creator = {
  platform: "instagram",
  handle: "mealprepmia",
  profile_url: "https://instagram.com/mealprepmia",
  display_name: "Mia",
  bio: "Budget meal prep for nurses on night shift",
  niche: null,
  external_url: null,
  followers: 24000,
  median_views: 18000,
  engagement_rate: 0.06,
  posts_last_30d: 10,
  business_email: "mia@example.com",
} as unknown as Creator;

const posts = [
  { url: "https://instagram.com/p/1", caption: "5 freezer lunches for 12h shifts", posted_at: "2026-11-10T00:00:00Z", views: 40000, likes: 3000, comments: 200 },
] as CreatorPost[];

describe("evidence + grounding", () => {
  const ev = buildEvidence(creator, posts);

  it("numbers evidence and includes posts", () => {
    expect(ev[0].id).toBe("E1");
    expect(ev.some((e) => e.kind === "post" && e.text.includes("freezer lunches"))).toBe(true);
  });

  it("drops uncited or hallucinated-citation items", () => {
    const { kept, dropped } = filterGrounded(
      [
        { x: 1, evidence: ["E2"] },
        { x: 2, evidence: [] },
        { x: 3, evidence: ["E99"] },
      ],
      ev,
    );
    expect(kept.map((k) => k.x)).toEqual([1]);
    expect(dropped).toHaveLength(2);
  });

  it("top_content must reference a post evidence id", () => {
    const postId = ev.find((e) => e.kind === "post")!.id;
    const r: AnalysisResult = {
      niche: { value: "meal prep", evidence: ["E2"] },
      content_themes: [],
      communication_style: { description: "practical", evidence: ["E2"] },
      audience_interests: [],
      top_content: [
        { evidence_id: postId, why_it_worked: "specific", evidence: [postId] },
        { evidence_id: "E1", why_it_worked: "nope", evidence: ["E1"] },
      ],
      potential_problems: [],
      software_ideas: [],
      collaboration_opportunities: [],
      data_gaps: [],
    };
    const { result, dropped } = groundAnalysis(r, ev);
    expect(result.top_content).toHaveLength(1);
    expect(dropped).toHaveLength(1);
  });
});

describe("outreach lint", () => {
  const ev = buildEvidence(creator, posts);
  const base: OutreachResult = {
    observation: { text: "Your freezer lunches post for 12h shifts", evidence: ["E7"] },
    why_good_candidate: { text: "x", evidence: ["E2"] },
    instagram_dm: "Hi Mia — your freezer lunches for 12h shifts post was really practical.",
    tiktok_dm: "Hi Mia",
    email_subject: "Idea for night-shift meal planning",
    email_body: "Hi Mia, ...",
    follow_up: "Just bumping this in case it got buried — no worries if not a fit.",
    recommended_channel: "email",
    channel_reason: "Business email listed",
  };
  const channels = availableChannels(creator);

  it("prefers email when business email exists", () => {
    expect(channels).toEqual(["email", "instagram_dm"]);
  });

  it("passes a clean message", () => {
    const obsId = ev.find((e) => e.kind === "post")!.id;
    expect(lintOutreach({ ...base, observation: { ...base.observation, evidence: [obsId] } }, { includeBudget: false, evidence: ev, channels })).toEqual([]);
  });

  it("flags budget, sales language, bad channel and ungrounded observation", () => {
    const issues = lintOutreach(
      { ...base, observation: { text: "x", evidence: [] }, instagram_dm: "Let's scale your brand! Budget $1,500", recommended_channel: "tiktok_dm" },
      { includeBudget: false, evidence: ev, channels },
    );
    const text = issues.map((i) => i.issue).join(" | ");
    expect(text).toMatch(/not grounded/);
    expect(text).toMatch(/scale your brand/);
    expect(text).toMatch(/money/);
    expect(text).toMatch(/not available/);
  });
});
