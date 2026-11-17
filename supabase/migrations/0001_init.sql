-- Creator Outreach MVP — initial schema

create type platform as enum ('instagram', 'tiktok');
create type creator_status as enum (
  'discovered','analyzed','qualified','pending_review','approved','contacted',
  'replied','interested','meeting_scheduled','partnership_discussion',
  'collaborated','not_interested','do_not_contact'
);
create type priority as enum ('high','medium','low');
create type data_source as enum ('csv','manual','apify','api','creator_submitted');
create type message_channel as enum ('instagram_dm','tiktok_dm','email');
create type message_kind as enum ('initial','follow_up','reply');
create type message_state as enum ('draft','approved','sent','received','discarded');
create type job_status as enum ('queued','running','done','failed');

-- ───────────────────────── settings ─────────────────────────
create table settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  sender_name text not null default '',
  sender_bio text not null default 'Software engineer who builds products with creators.',
  sender_email text,
  target_niches text[] not null default '{}',
  min_followers int not null default 10000,
  max_followers int not null default 100000,
  daily_email_limit int not null default 20,
  llm_provider text not null default 'anthropic',
  analysis_model text not null default 'claude-opus-5-5',
  outreach_model text not null default 'claude-opus-5-5',
  apify_instagram_actor text not null default 'apify/instagram-profile-scraper',
  apify_tiktok_actor text not null default 'clockworks/tiktok-profile-scraper',
  updated_at timestamptz not null default now()
);

-- ───────────────────────── creators ─────────────────────────
create table creators (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  platform platform not null,
  handle text not null check (handle = lower(handle)),
  profile_url text not null,
  display_name text,
  bio text,
  followers int,
  following int,
  total_posts int,
  business_email text,
  external_url text,
  niche text,
  -- aggregated metrics (computed from creator_posts)
  avg_views numeric,
  median_views numeric,
  engagement_rate numeric,          -- (likes+comments)/views over recent posts
  posts_last_30d int,
  last_posted_at timestamptz,
  -- qualification
  score int,
  priority priority,
  score_breakdown jsonb,
  scored_at timestamptz,
  -- CRM
  status creator_status not null default 'discovered',
  last_contacted_at timestamptz,
  follow_up_at date,
  notes text,
  collaboration_opportunities text,
  -- provenance
  data_source data_source not null,
  source_ref text,                  -- e.g. apify run id, csv filename
  collected_at timestamptz not null default now(),
  data_permission text not null default 'public_profile',
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table creators add constraint creators_owner_platform_handle unique (owner_id, platform, handle);
create index creators_owner_status on creators (owner_id, status);
create index creators_owner_score on creators (owner_id, score desc nulls last);
create index creators_follow_up on creators (owner_id, follow_up_at) where follow_up_at is not null;

create table creator_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references creators(id) on delete cascade,
  external_id text,
  url text not null,
  caption text,
  posted_at timestamptz,
  views int,
  likes int,
  comments int,
  is_video boolean not null default true,
  data_source data_source not null,
  collected_at timestamptz not null default now(),
  unique (creator_id, url)
);
create index creator_posts_creator on creator_posts (creator_id, posted_at desc);

-- ───────────────────────── AI analysis ─────────────────────────
create table analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references creators(id) on delete cascade,
  result jsonb not null,            -- validated AnalysisResult
  evidence jsonb not null,          -- evidence table the model saw (E1..En)
  dropped_claims jsonb not null default '[]',
  provider text not null,
  model text not null,
  created_at timestamptz not null default now()
);
create index analyses_creator on analyses (creator_id, created_at desc);

-- ───────────────────────── messages / CRM ─────────────────────────
create table messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references creators(id) on delete cascade,
  analysis_id uuid references analyses(id) on delete set null,
  batch_id uuid,                    -- groups the 5 generated outputs
  channel message_channel not null,
  kind message_kind not null,
  state message_state not null default 'draft',
  subject text,
  generated_body text,              -- what the AI produced
  body text not null,               -- current (possibly edited) body
  sent_body text,                   -- exactly what was sent
  recommended boolean not null default false,
  meta jsonb not null default '{}',   -- observation, lint issues, generation options
  rationale text,                   -- why-this-creator explanation / channel reasoning
  approved_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index messages_creator on messages (creator_id, created_at desc);
create index messages_owner_state on messages (owner_id, state);

create table contact_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references creators(id) on delete cascade,
  type text not null,               -- status_change | sent | reply | note | meeting | follow_up_set
  from_status creator_status,
  to_status creator_status,
  message_id uuid references messages(id) on delete set null,
  sentiment text,                   -- positive | neutral | negative (for replies)
  body text,
  occurred_at timestamptz not null default now()
);
create index contact_events_creator on contact_events (creator_id, occurred_at desc);
create index contact_events_owner_type on contact_events (owner_id, type, occurred_at);

create table do_not_contact (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  platform platform,
  handle text,
  email text,
  reason text,
  created_at timestamptz not null default now(),
  check (handle is not null or email is not null)
);
create unique index dnc_handle on do_not_contact (owner_id, platform, lower(handle)) where handle is not null;
create unique index dnc_email on do_not_contact (owner_id, lower(email)) where email is not null;

-- ───────────────────────── jobs ─────────────────────────
create table jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null,               -- apify_import | analyze | generate_outreach | rescore
  payload jsonb not null default '{}',
  status job_status not null default 'queued',
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_runnable on jobs (status, run_after) where status = 'queued';

-- Atomically claim up to n runnable jobs (used by cron with the service role).
create or replace function claim_jobs(n int, p_owner uuid default null)
returns setof jobs language sql as $$
  update jobs set status = 'running', attempts = attempts + 1, updated_at = now()
  where id in (
    select id from jobs
    where status = 'queued' and run_after <= now()
      and (p_owner is null or owner_id = p_owner)
    order by run_after
    for update skip locked
    limit n
  )
  returning *;
$$;
revoke execute on function claim_jobs(int, uuid) from public, anon, authenticated;

-- ───────────────────────── LLM observability ─────────────────────────
create table llm_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  task text not null,
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10,5) not null default 0,
  latency_ms int,
  cache_hit boolean not null default false,
  attempts int not null default 1,
  error text,
  created_at timestamptz not null default now()
);
create index llm_usage_owner_time on llm_usage (owner_id, created_at desc);

create table llm_cache (
  key text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- ───────────────────────── updated_at triggers ─────────────────────────
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_creators before update on creators for each row execute function touch_updated_at();
create trigger t_messages before update on messages for each row execute function touch_updated_at();
create trigger t_jobs before update on jobs for each row execute function touch_updated_at();
create trigger t_settings before update on settings for each row execute function touch_updated_at();

-- ───────────────────────── RLS ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['settings','creators','creator_posts','analyses','messages',
                           'contact_events','do_not_contact','jobs','llm_usage','llm_cache']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy owner_all on %I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;
