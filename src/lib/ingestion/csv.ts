import Papa from "papaparse";
import { cleanHandle, extractEmail, isoDate, num, parsePlatform, profileUrl, rate, str, type NormalizedCreator } from "./normalize";

export const CSV_TEMPLATE_HEADERS = [
  "platform",
  "handle",
  "display_name",
  "bio",
  "followers",
  "following",
  "total_posts",
  "business_email",
  "external_url",
  "niche",
  "avg_views",
  "median_views",
  "engagement_rate",
  "posts_last_30d",
  "last_posted_at",
  // optional: one row per post — repeat the creator columns or leave them blank after the first row
  "post_url",
  "post_caption",
  "post_posted_at",
  "post_views",
  "post_likes",
  "post_comments",
];

export interface CsvParseResult {
  creators: NormalizedCreator[];
  errors: string[];
}

/**
 * Parses a CSV of creators. Rows sharing (platform, handle) are merged; any row
 * with post_url contributes a post. Header names are case-insensitive and
 * tolerate spaces ("Follower Count" → follower_count is NOT mapped; use template names).
 */
export function parseCreatorsCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  const errors = parsed.errors.slice(0, 20).map((e) => `Row ${e.row}: ${e.message}`);
  const byKey = new Map<string, NormalizedCreator>();

  parsed.data.forEach((r, i) => {
    const platform = parsePlatform(r.platform);
    const handle = r.handle ? cleanHandle(r.handle) : "";
    if (!platform || !handle) {
      errors.push(`Row ${i + 2}: missing/invalid platform or handle`);
      return;
    }
    const key = `${platform}:${handle}`;
    let c = byKey.get(key);
    if (!c) {
      c = {
        platform,
        handle,
        profile_url: profileUrl(platform, handle),
        display_name: str(r.display_name),
        bio: str(r.bio),
        followers: num(r.followers),
        following: num(r.following),
        total_posts: num(r.total_posts),
        business_email: str(r.business_email)?.toLowerCase() ?? extractEmail(r.bio),
        external_url: str(r.external_url),
        niche: str(r.niche),
        posts: [],
        provided: {
          avg_views: num(r.avg_views),
          median_views: num(r.median_views),
          engagement_rate: rate(r.engagement_rate),
          posts_last_30d: num(r.posts_last_30d),
          last_posted_at: isoDate(r.last_posted_at),
        },
      };
      byKey.set(key, c);
    }
    if (str(r.post_url)) {
      c.posts.push({
        external_id: null,
        url: r.post_url.trim(),
        caption: str(r.post_caption),
        posted_at: isoDate(r.post_posted_at),
        views: num(r.post_views),
        likes: num(r.post_likes),
        comments: num(r.post_comments),
        is_video: true,
      });
    }
  });

  return { creators: [...byKey.values()], errors };
}
