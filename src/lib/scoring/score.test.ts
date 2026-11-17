import { describe, expect, it } from "vitest";
import { aggregate, median } from "./metrics";
import { nicheMatches, priorityFor, scoreCreator } from "./score";

const now = new Date("2026-11-17T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

function posts(n: number, views: number, likes: number, comments: number, spacing = 2) {
  return Array.from({ length: n }, (_, k) => ({
    posted_at: daysAgo(k * spacing + 1),
    views: views + k * 1000 * (k % 2 ? 1 : -1) + k * 337,
    likes,
    comments,
  }));
}

const cfg = { target_niches: ["fitness", "meal prep"], min_followers: 10_000, max_followers: 100_000, now };

describe("metrics", () => {
  it("median handles even/odd", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("aggregates views, engagement and cadence", () => {
    const m = aggregate(posts(12, 20_000, 1200, 80), 40_000, now);
    expect(m.sample_size).toBe(12);
    expect(m.posts_last_30d).toBe(12);
    expect(m.engagement_rate).toBeGreaterThan(0.05);
    expect(m.engagement_estimated).toBe(false);
  });

  it("falls back to per-follower engagement when no views", () => {
    const m = aggregate([{ posted_at: daysAgo(1), views: null, likes: 500, comments: 20 }], 20_000, now);
    expect(m.engagement_estimated).toBe(true);
    expect(m.engagement_rate).toBeCloseTo(0.026, 3);
  });
});

describe("scoreCreator", () => {
  it("rates a strong, active, on-niche micro creator as high priority", () => {
    const s = scoreCreator(
      {
        followers: 35_000,
        following: 400,
        bio: "Meal prep for busy people 🍱 | business: hi@x.com | free guide below",
        niche: "fitness meal prep",
        business_email: "hi@x.com",
        external_url: "https://x.com",
        captions: ["5 high protein lunches"],
        metrics: aggregate(posts(14, 30_000, 2400, 150), 35_000, now),
      },
      cfg,
    );
    expect(s.total).toBeGreaterThanOrEqual(70);
    expect(s.priority).toBe("high");
    expect(s.components).toHaveLength(7);
    expect(s.components.reduce((a, c) => a + c.max, 0)).toBe(100);
  });

  it("does not reward follower count alone", () => {
    const s = scoreCreator(
      {
        followers: 90_000,
        following: 85_000,
        bio: "",
        niche: null,
        business_email: null,
        external_url: null,
        captions: [],
        metrics: aggregate(posts(6, 800, 10, 1, 9), 90_000, now),
      },
      cfg,
    );
    expect(s.priority).toBe("low");
    const auth = s.components.find((c) => c.key === "authenticity")!;
    expect(auth.points).toBeLessThan(10);
    expect(auth.reason).toMatch(/not proof/);
  });

  it("labels missing data as insufficient rather than guessing", () => {
    const s = scoreCreator(
      { followers: null, following: null, bio: null, niche: null, business_email: null, external_url: null, captions: [], metrics: aggregate([], null, now) },
      cfg,
    );
    expect(s.warnings.length).toBeGreaterThanOrEqual(4);
    expect(s.components.find((c) => c.key === "views")!.confidence).toBe("insufficient_data");
  });

  it("treats a creator who stopped posting as inactive", () => {
    const old = posts(8, 20_000, 1000, 50).map((p, k) => ({ ...p, posted_at: daysAgo(60 + k) }));
    const s = scoreCreator(
      { followers: 30_000, following: 100, bio: "x", niche: null, business_email: null, external_url: null, captions: [], metrics: aggregate(old, 30_000, now) },
      cfg,
    );
    expect(s.components.find((c) => c.key === "consistency")!.points).toBe(0);
  });
});

describe("helpers", () => {
  it("priority thresholds", () => {
    expect(priorityFor(70)).toBe("high");
    expect(priorityFor(69)).toBe("medium");
    expect(priorityFor(55)).toBe("medium");
    expect(priorityFor(54)).toBe("low");
  });
  it("niche matching is word-bounded", () => {
    expect(nicheMatches("I love fitness", ["fit"])).toEqual(["fit"]);
    expect(nicheMatches("outfit ideas", ["fit"])).toEqual([]);
  });
});
