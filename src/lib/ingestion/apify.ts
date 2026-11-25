/**
 * Apify adapter. Only use actors whose collection method you have checked is
 * permitted for your use. We collect public profile + post metrics only, store
 * the run id as provenance, and never send credentials or log in as a user.
 *
 * Actor output shapes vary between actors/versions, so normalisers read several
 * candidate field names and keep the raw item for auditing.
 */
import type { Platform } from "@/lib/types";
import { cleanHandle, extractEmail, isoDate, num, profileUrl, str, type NormalizedCreator, type NormalizedPost } from "./normalize";
import { inferRegion } from "./region";

const API = "https://api.apify.com/v2";

type Item = Record<string, unknown>;
const pick = (o: Item | undefined, ...keys: string[]) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

function actorPath(actorId: string) {
  return actorId.replace("/", "~");
}

export async function startActorRun(token: string, actorId: string, input: unknown): Promise<{ runId: string; datasetId: string }> {
  const res = await fetch(`${API}/acts/${actorPath(actorId)}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify start failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { data } = (await res.json()) as { data: { id: string; defaultDatasetId: string } };
  return { runId: data.id, datasetId: data.defaultDatasetId };
}

export async function getRun(token: string, runId: string): Promise<{ status: string; datasetId: string; usageUsd: number | null }> {
  const res = await fetch(`${API}/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Apify run lookup failed ${res.status}`);
  const { data } = (await res.json()) as { data: { status: string; defaultDatasetId: string; usageTotalUsd?: number } };
  return { status: data.status, datasetId: data.defaultDatasetId, usageUsd: data.usageTotalUsd ?? null };
}

export async function getDatasetItems(token: string, datasetId: string, limit = 2000): Promise<Item[]> {
  const res = await fetch(`${API}/datasets/${datasetId}/items?clean=true&limit=${limit}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Apify dataset fetch failed ${res.status}`);
  return (await res.json()) as Item[];
}

// ───────────────────────── inputs ─────────────────────────

export function profileInput(platform: Platform, handles: string[], postsPerProfile = 12) {
  return platform === "instagram"
    ? { usernames: handles, resultsLimit: postsPerProfile }
    : { profiles: handles, resultsPerPage: postsPerProfile, shouldDownloadVideos: false, shouldDownloadCovers: false };
}

export function hashtagInput(platform: Platform, hashtags: string[], limit: number) {
  const tags = hashtags.map((h) => h.replace(/^#/, ""));
  return platform === "instagram" ? { hashtags: tags, resultsLimit: limit } : { hashtags: tags, resultsPerPage: limit, shouldDownloadVideos: false };
}

/** From hashtag-search items, collect unique creator handles. */
export function handlesFromHashtagItems(items: Item[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const author = it.authorMeta as Item | undefined;
    const h = str(pick(it, "ownerUsername", "username") ?? pick(author, "name", "uniqueId"));
    if (h) set.add(cleanHandle(h));
  }
  return [...set];
}

// ───────────────────────── normalisers ─────────────────────────

function igPost(p: Item): NormalizedPost | null {
  const url = str(pick(p, "url")) ?? (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null);
  if (!url) return null;
  const type = String(pick(p, "type", "productType") ?? "").toLowerCase();
  return {
    external_id: str(pick(p, "id", "shortCode")),
    url,
    caption: str(pick(p, "caption")),
    posted_at: isoDate(pick(p, "timestamp", "takenAt")),
    views: num(pick(p, "videoPlayCount", "videoViewCount", "playCount")),
    likes: num(pick(p, "likesCount", "likes")),
    comments: num(pick(p, "commentsCount", "comments")),
    is_video: type.includes("video") || type.includes("clips") || p.videoUrl != null,
  };
}

export function normalizeInstagramProfiles(items: Item[]): NormalizedCreator[] {
  return items
    .filter((it) => it.username && !it.error)
    .map((it) => {
      const handle = cleanHandle(String(it.username));
      const bio = str(pick(it, "biography", "bio"));
      const rawPosts = (pick(it, "latestPosts", "posts") as Item[] | undefined) ?? [];
      const posts = rawPosts.map(igPost).filter((p): p is NormalizedPost => !!p);
      const region = inferRegion({
        bio,
        displayName: str(pick(it, "fullName", "full_name")),
        captions: posts.map((p) => p.caption),
        locations: rawPosts.map((p) => str(pick(p, "locationName", "location_name"))),
      });
      return {
        platform: "instagram" as const,
        handle,
        profile_url: profileUrl("instagram", handle),
        display_name: str(pick(it, "fullName", "full_name")),
        bio,
        followers: num(pick(it, "followersCount", "followers")),
        following: num(pick(it, "followsCount", "following")),
        total_posts: num(pick(it, "postsCount", "mediaCount")),
        business_email: str(pick(it, "businessEmail", "publicEmail", "email"))?.toLowerCase() ?? extractEmail(bio),
        external_url: str(pick(it, "externalUrl", "external_url")),
        niche: str(pick(it, "businessCategoryName", "categoryName")),
        posts,
        region,
        raw: { ...it, latestPosts: undefined },
      };
    });
}

/** TikTok profile actors usually return one item per video with authorMeta on each. */
export function normalizeTiktokItems(items: Item[]): NormalizedCreator[] {
  const by = new Map<string, NormalizedCreator>();
  const codes = new Map<string, string[]>(); // handle → per-video country codes
  for (const it of items) {
    const a = (it.authorMeta as Item | undefined) ?? {};
    const h = str(pick(a, "name", "uniqueId")) ?? str(pick(it, "username"));
    if (!h) continue;
    const handle = cleanHandle(h);
    let c = by.get(handle);
    if (!c) {
      const bio = str(pick(a, "signature", "bio"));
      const bioLink = pick(a, "bioLink") as Item | string | undefined;
      c = {
        platform: "tiktok",
        handle,
        profile_url: profileUrl("tiktok", handle),
        display_name: str(pick(a, "nickName", "nickname")),
        bio,
        followers: num(pick(a, "fans", "followers")),
        following: num(pick(a, "following")),
        total_posts: num(pick(a, "video", "videoCount")),
        business_email: extractEmail(bio),
        external_url: typeof bioLink === "string" ? bioLink : str(pick(bioLink, "link")),
        niche: null,
        posts: [],
        raw: a,
      };
      by.set(handle, c);
    }
    const cc = str(pick(it, "locationCreated", "region"));
    if (cc) codes.set(handle, [...(codes.get(handle) ?? []), cc]);
    const url = str(pick(it, "webVideoUrl", "url"));
    if (url)
      c.posts.push({
        external_id: str(pick(it, "id")),
        url,
        caption: str(pick(it, "text", "desc")),
        posted_at: isoDate(pick(it, "createTimeISO", "createTime")),
        views: num(pick(it, "playCount")),
        likes: num(pick(it, "diggCount", "likes")),
        comments: num(pick(it, "commentCount", "comments")),
        is_video: true,
      });
  }
  for (const c of by.values())
    c.region = inferRegion({ bio: c.bio, displayName: c.display_name, captions: c.posts.map((p) => p.caption), countryCodes: codes.get(c.handle) });
  return [...by.values()];
}

export function normalizeApifyItems(platform: Platform, items: Item[]) {
  return platform === "instagram" ? normalizeInstagramProfiles(items) : normalizeTiktokItems(items);
}
