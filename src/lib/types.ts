export const PLATFORMS = ["instagram", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CREATOR_STATUSES = [
  "discovered",
  "analyzed",
  "qualified",
  "pending_review",
  "approved",
  "contacted",
  "replied",
  "interested",
  "meeting_scheduled",
  "partnership_discussion",
  "collaborated",
  "not_interested",
  "do_not_contact",
] as const;
export type CreatorStatus = (typeof CREATOR_STATUSES)[number];

export const STATUS_LABELS: Record<CreatorStatus, string> = {
  discovered: "Discovered",
  analyzed: "Analyzed",
  qualified: "Qualified",
  pending_review: "Pending review",
  approved: "Approved",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  meeting_scheduled: "Meeting scheduled",
  partnership_discussion: "Partnership discussion",
  collaborated: "Collaborated",
  not_interested: "Not interested",
  do_not_contact: "Do not contact",
};

export type Priority = "high" | "medium" | "low";
export type DataSource = "csv" | "manual" | "apify" | "api" | "creator_submitted";
export type MessageChannel = "instagram_dm" | "tiktok_dm" | "email";
export type MessageKind = "initial" | "follow_up" | "reply";
export type MessageState = "draft" | "approved" | "sent" | "received" | "discarded";

export interface ScoreComponent {
  key: string;
  label: string;
  points: number;
  max: number;
  reason: string;
  /** measured = computed from collected data; estimated = proxy/heuristic; insufficient_data = not enough evidence */
  confidence: "measured" | "estimated" | "insufficient_data";
}

export interface ScoreBreakdown {
  total: number;
  priority: Priority;
  components: ScoreComponent[];
  warnings: string[];
}

export interface Creator {
  id: string;
  owner_id: string;
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
  avg_views: number | null;
  median_views: number | null;
  engagement_rate: number | null;
  posts_last_30d: number | null;
  last_posted_at: string | null;
  score: number | null;
  priority: Priority | null;
  score_breakdown: ScoreBreakdown | null;
  scored_at: string | null;
  status: CreatorStatus;
  last_contacted_at: string | null;
  follow_up_at: string | null;
  notes: string | null;
  collaboration_opportunities: string | null;
  data_source: DataSource;
  source_ref: string | null;
  collected_at: string;
  data_permission: string;
  created_at: string;
  updated_at: string;
}

export interface CreatorPost {
  id: string;
  creator_id: string;
  external_id: string | null;
  url: string;
  caption: string | null;
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  is_video: boolean;
  data_source: DataSource;
  collected_at: string;
}

export interface Message {
  id: string;
  creator_id: string;
  analysis_id: string | null;
  batch_id: string | null;
  channel: MessageChannel;
  kind: MessageKind;
  state: MessageState;
  subject: string | null;
  generated_body: string | null;
  body: string;
  sent_body: string | null;
  recommended: boolean;
  rationale: string | null;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Settings {
  owner_id: string;
  sender_name: string;
  sender_bio: string;
  sender_email: string | null;
  target_niches: string[];
  min_followers: number;
  max_followers: number;
  daily_email_limit: number;
  llm_provider: string;
  analysis_model: string;
  outreach_model: string;
  apify_instagram_actor: string;
  apify_tiktok_actor: string;
  auto_draft: boolean;
  auto_draft_min_score: number;
  auto_draft_proposition: "mvp" | "partnership" | "open";
  auto_draft_include_budget: boolean;
  email_signature: string;
}
