export interface PostMetrics {
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export interface AggregateMetrics {
  avg_views: number | null;
  median_views: number | null;
  /** (likes + comments) / views, averaged over posts with views. Fraction, e.g. 0.054 */
  engagement_rate: number | null;
  /** true when engagement was estimated from followers because no view counts exist */
  engagement_estimated: boolean;
  posts_last_30d: number | null;
  last_posted_at: string | null;
  sample_size: number;
  /** coefficient of variation of views (stddev / mean) */
  views_cv: number | null;
}

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function aggregate(posts: PostMetrics[], followers: number | null, now = new Date()): AggregateMetrics {
  const withViews = posts.filter((p) => typeof p.views === "number" && p.views! > 0);
  const views = withViews.map((p) => p.views!);
  const avg = views.length ? views.reduce((a, b) => a + b, 0) / views.length : null;

  let er: number | null = null;
  let estimated = false;
  if (withViews.length) {
    const rates = withViews.map((p) => ((p.likes ?? 0) + (p.comments ?? 0)) / p.views!);
    er = rates.reduce((a, b) => a + b, 0) / rates.length;
  } else if (posts.length && followers) {
    const rates = posts.map((p) => ((p.likes ?? 0) + (p.comments ?? 0)) / followers);
    er = rates.reduce((a, b) => a + b, 0) / rates.length;
    estimated = true;
  }

  const dated = posts.filter((p) => p.posted_at).map((p) => new Date(p.posted_at!).getTime());
  const cutoff = now.getTime() - 30 * 86_400_000;
  const last = dated.length ? new Date(Math.max(...dated)).toISOString() : null;

  let cv: number | null = null;
  if (avg && views.length >= 3) {
    const variance = views.reduce((a, v) => a + (v - avg) ** 2, 0) / views.length;
    cv = Math.sqrt(variance) / avg;
  }

  return {
    avg_views: avg === null ? null : Math.round(avg),
    median_views: median(views),
    engagement_rate: er === null ? null : Number(er.toFixed(5)),
    engagement_estimated: estimated,
    posts_last_30d: dated.length ? dated.filter((t) => t >= cutoff).length : null,
    last_posted_at: last,
    sample_size: posts.length,
    views_cv: cv === null ? null : Number(cv.toFixed(3)),
  };
}
