import { describe, expect, it } from "vitest";
import { handlesFromHashtagItems, normalizeInstagramProfiles, normalizeTiktokItems } from "./apify";
import { parseCreatorsCsv } from "./csv";
import { cleanHandle, num, rate } from "./normalize";

describe("normalize helpers", () => {
  it("parses compact numbers and rates", () => {
    expect(num("12.5k")).toBe(12500);
    expect(num("1,200")).toBe(1200);
    expect(num("1.2M")).toBe(1_200_000);
    expect(num("n/a")).toBeNull();
    expect(rate("4.5%")).toBeCloseTo(0.045);
    expect(rate("0.045")).toBeCloseTo(0.045);
    expect(rate("4.5")).toBeCloseTo(0.045);
  });
  it("cleans handles and URLs", () => {
    expect(cleanHandle("@Foo.Bar")).toBe("foo.bar");
    expect(cleanHandle("https://www.tiktok.com/@cook_it?lang=en")).toBe("cook_it");
    expect(cleanHandle("https://instagram.com/someone/")).toBe("someone");
  });
});

describe("csv", () => {
  it("merges creator rows and collects posts", () => {
    const csv = `platform,handle,followers,bio,post_url,post_views,post_likes,post_comments,post_posted_at
instagram,@mia,24k,"Email me: Mia@Example.com",https://ig/p/1,10k,800,40,2026-11-01
instagram,mia,,,https://ig/p/2,12000,900,50,2026-11-05
tiktok,,5000,,,,,,
`;
    const { creators, errors } = parseCreatorsCsv(csv);
    expect(creators).toHaveLength(1);
    expect(creators[0].followers).toBe(24000);
    expect(creators[0].business_email).toBe("mia@example.com");
    expect(creators[0].posts).toHaveLength(2);
    expect(errors.some((e) => e.includes("Row 4"))).toBe(true);
  });
});

describe("apify normalisers", () => {
  it("instagram profile", () => {
    const [c] = normalizeInstagramProfiles([
      {
        username: "Mia",
        fullName: "Mia",
        biography: "meal prep",
        followersCount: 24000,
        followsCount: 300,
        latestPosts: [{ shortCode: "abc", caption: "lunch", timestamp: "2026-11-01T00:00:00Z", videoPlayCount: 9000, likesCount: 500, commentsCount: 20, type: "Video" }],
      },
    ]);
    expect(c.handle).toBe("mia");
    expect(c.posts[0].url).toBe("https://www.instagram.com/p/abc/");
    expect(c.posts[0].views).toBe(9000);
  });

  it("tiktok groups videos by author", () => {
    const cs = normalizeTiktokItems([
      { authorMeta: { name: "chef", fans: 50000, signature: "biz: chef@x.co" }, webVideoUrl: "https://t/1", playCount: 100, createTime: 1762000000 },
      { authorMeta: { name: "chef", fans: 50000 }, webVideoUrl: "https://t/2", playCount: 200, createTime: 1762100000 },
    ]);
    expect(cs).toHaveLength(1);
    expect(cs[0].posts).toHaveLength(2);
    expect(cs[0].business_email).toBe("chef@x.co");
  });

  it("extracts handles from hashtag results", () => {
    expect(handlesFromHashtagItems([{ ownerUsername: "A" }, { authorMeta: { name: "b" } }, { ownerUsername: "a" }]).sort()).toEqual(["a", "b"]);
  });
});
