import type { Platform } from "@/lib/types";
import type { RegionGuess } from "./region";

export interface NormalizedPost {
  external_id: string | null;
  url: string;
  caption: string | null;
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  is_video: boolean;
}

export interface NormalizedCreator {
  platform: Platform;
  handle: string;
  profile_url: string;
  display_name: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  total_posts: number | null;
  business_email: string | null;
  external_url: string | null;
  niche: string | null;
  posts: NormalizedPost[];
  /** Pre-aggregated metrics (e.g. from a CSV) used only when no posts are provided */
  provided?: {
    avg_views?: number | null;
    median_views?: number | null;
    engagement_rate?: number | null;
    posts_last_30d?: number | null;
    last_posted_at?: string | null;
  };
  raw?: unknown;
  /** Detected country/language (Apify imports). Undefined = not detected, so existing values are kept. */
  region?: RegionGuess;
}

export function cleanHandle(h: string): string {
  return h
    .trim()
    .replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com)\/@?/i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

export function profileUrl(platform: Platform, handle: string): string {
  return platform === "instagram" ? `https://www.instagram.com/${handle}/` : `https://www.tiktok.com/@${handle}`;
}

export function parsePlatform(v: unknown): Platform | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.startsWith("insta") || s === "ig") return "instagram";
  if (s.startsWith("tik") || s === "tt") return "tiktok";
  return null;
}

/** Parse "12.5k", "1,200", "1.2M", 1200 → number. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().toLowerCase().replace(/,/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/);
  if (!m) return null;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

/** Accepts "4.5%", "4.5", "0.045" → 0.045 */
export function rate(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  const n = parseFloat(s.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return s.includes("%") || n > 1 ? n / 100 : n;
}

export function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  // unix seconds
  if (typeof v === "number" || /^\d{9,11}$/.test(String(v))) {
    const n = Number(v);
    return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
export function extractEmail(...sources: (string | null | undefined)[]): string | null {
  for (const s of sources) {
    const m = s?.match(EMAIL_RE);
    if (m) return m[0].toLowerCase();
  }
  return null;
}

export const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
