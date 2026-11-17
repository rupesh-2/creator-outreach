-- Auto-draft: after AI analysis, queue outreach drafts for creators that score high enough.
-- Drafts still land in the review queue; nothing is sent without approval.
alter table settings
  add column auto_draft boolean not null default true,
  add column auto_draft_min_score int not null default 55 check (auto_draft_min_score between 0 and 100),
  add column auto_draft_proposition text not null default 'open' check (auto_draft_proposition in ('mvp', 'partnership', 'open')),
  add column auto_draft_include_budget boolean not null default false;
