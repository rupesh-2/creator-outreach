# Creator Outreach MVP — Plan

Lean, single-operator tool for finding micro-creators (10k–100k followers) on Instagram and TikTok, scoring them, writing grounded and personalised outreach, and tracking each relationship through to a partnership.

---

## 1. Architecture

```
┌────────────────────────── Next.js 16 (Vercel) ───────────────────────────┐
│  App Router pages (RSC + server actions)       Route handlers            │
│  ─ Overview / Discovery / Creator / Analysis   /api/cron/jobs  (Vercel   │
│  ─ Messages / Inbox / Pipeline / Follow-ups      Cron, every 5 min)      │
│  ─ Analytics / Settings                        /api/export/creators.csv  │
│                                                /api/unsubscribe          │
│  src/lib                                                                 │
│  ├─ ingestion/   adapters: csv, manual, apify  → normalize → upsert      │
│  ├─ scoring/     pure, deterministic 0–100 engine + explanations         │
│  ├─ llm/         Provider interface → anthropic | openai                 │
│  │               + retries, response cache, usage/cost log               │
│  ├─ ai/          analysis + outreach prompts, zod schemas,               │
│  │               grounding validator (evidence ids must exist)           │
│  ├─ outreach/    DNC + duplicate guard, email sender (Resend),           │
│  │               daily send limits, unsubscribe tokens                   │
│  └─ jobs/        Postgres-backed queue (claim with SKIP LOCKED)          │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   │ supabase-js (RLS for user requests,
                                   │ service role only inside cron/jobs)
                        ┌──────────▼──────────┐
                        │ Supabase Postgres + │
                        │ Supabase Auth       │
                        └─────────────────────┘
```

Key decisions:

| Decision | Why |
|---|---|
| **Postgres job queue + Vercel Cron**, no Redis/Inngest | No extra infrastructure or cost. 50 creators a day is tiny. `claim_jobs()` uses `FOR UPDATE SKIP LOCKED`, and failed jobs retry with exponential backoff. |
| **Deterministic scoring in code, not LLM** | Repeatable, explainable and free. The LLM only adds the *niche relevance* signal, and that signal is labelled. |
| **LLM behind a `LlmProvider` interface** | Anthropic and OpenAI adapters ship. The model and provider are set per task in Settings. |
| **Evidence-cited AI output** | The prompt numbers every fact (`E1`, `E2`, …). Every observation must cite evidence ids, and the validator drops any observation whose citations don't exist. |
| **Human-in-the-loop sending** | DMs are never automated. The app generates the DM, you copy it, send it yourself, then click "Mark sent". Email goes out only after approval, through Resend, with a daily cap and an unsubscribe link. |
| **Single-tenant with RLS** | Every row has an `owner_id` with an `auth.uid()` policy. It stays simple now and leaves room for multiple users later. |

## 2. Database schema

Full DDL: `supabase/migrations/0001_init.sql`. Tables:

| Table | Purpose |
|---|---|
| `creators` | One row per (platform, handle). Holds profile fields, aggregated metrics (avg/median views, engagement rate, posting cadence), business email, status, score, priority, score breakdown (jsonb), and `data_source`, `source_ref`, `collected_at`, `data_permission` |
| `creator_posts` | Recent videos/posts: URL, caption, posted_at, views, likes, comments, plus source and timestamp |
| `analyses` | AI analysis versions: niche, themes, style, evidence-cited observations, problems, software ideas, collaboration angles, model, cost |
| `messages` | Generated drafts and sent messages: channel (instagram_dm / tiktok_dm / email / follow_up), kind, body, subject, state (draft→approved→sent), what was actually sent |
| `contact_events` | Timeline: status changes, sends, replies, notes, meetings |
| `do_not_contact` | Permanent list keyed by platform+handle and/or email. It is checked before any approve or send. |
| `jobs` | Background queue: type, payload, status, attempts, run_after, last_error |
| `llm_usage` | Each LLM call: provider, model, task, input/output tokens, cost in USD, latency, cache hit, error |
| `llm_cache` | Response cache keyed by sha256(provider+model+prompt) |
| `settings` | Per-owner config: niche keywords, sender profile, daily limits, models per task |

`creator_status` enum: discovered, analyzed, qualified, pending_review, approved, contacted, replied, interested, meeting_scheduled, partnership_discussion, collaborated, not_interested, do_not_contact.

Duplicate-outreach protection:
- `unique(owner_id, platform, lower(handle))` on creators.
- Before a message is approved or sent, the app checks the DNC list (handle or email) and checks whether an initial message was already sent to this creator on any channel.

## 3. Integration requirements

| Integration | Needed for | What you need to provide | Notes |
|---|---|---|---|
| Supabase | DB + Auth | Project URL, anon key, service-role key | Free tier is enough for the MVP |
| Anthropic and/or OpenAI | Analysis + outreach | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Pick the provider and model per task in Settings |
| Apify (optional) | Profile + post metrics | `APIFY_TOKEN`, actor ids | Default actors: `apify/instagram-profile-scraper`, `clockworks/tiktok-profile-scraper`. **You are responsible for checking that each actor's use complies with the platform's terms in your jurisdiction.** The app collects only public profile/post metrics and stores the source with each record. |
| CSV / manual import | Always-available ingestion | — | Template at `/api/export/template.csv` |
| Resend (optional) | Approved email sends | `RESEND_API_KEY`, verified domain | Adds a `List-Unsubscribe` header and an unsubscribe link. Respects the daily cap. |
| Vercel Cron | Job runner | `CRON_SECRET` | `vercel.json` hits `/api/cron/jobs` every 5 min (Pro) or daily (Hobby; trigger manually from the UI otherwise) |

Out of scope by design: Instagram/TikTok DM APIs. Unsolicited DMs aren't allowed through those APIs, so DMs stay manual (copy, send yourself, mark sent).

## 4. Milestones

| # | Milestone | Deliverable |
|---|---|---|
| M1 | Foundation | Next.js + Supabase auth, schema, RLS, app shell, settings |
| M2 | Ingestion | CSV/manual import, Apify adapter, normalisation, metric aggregation, provenance |
| M3 | Qualification | Scoring engine + unit tests, explanations, priority, Discovery table (search/filter/sort/CSV) |
| M4 | AI analysis | LLM provider layer (retry, cache, cost log), grounded analysis, Analysis page |
| M5 | Outreach generator | 5 outputs + channel recommendation, grounding validator, review/edit/approve |
| M6 | CRM + sending | Pipeline board, contact timeline, DNC, duplicate guard, email send + unsubscribe, manual DM "mark sent", reply logging, follow-ups |
| M7 | Analytics | Funnel metrics, conversion rates, LLM cost dashboard |

## 5. Cost estimate (monthly, ~50 creators researched/day, ~28 qualified)

| Item | Estimate |
|---|---|
| Vercel | $0 Hobby (cron once a day) or $20 Pro (5-min cron) |
| Supabase | $0 Free tier (500 MB is plenty); $25 Pro if you want backups |
| Apify | ~$0.5–$2.6 per 1k profiles/posts depending on actor → **~$10–40/mo** at 1,500 profiles plus posts; the $5 free credit covers testing. Using the $49 Starter plan is simplest. |
| Resend | $0 (3k emails/mo free) |
| LLM: analysis (~5k in / 1.5k out tokens) + outreach (~6k in / 2k out), only for qualified creators (~850/mo) | Claude Opus 5.5 ($4/$20 per MTok): **~$90–110/mo**. Claude Sonnet 5.5 ($2/$10): ~$45–55/mo. Claude Haiku 5.5 ($0.10/$0.50): ~$3/mo. The model can be switched per task in Settings. The cache avoids paying twice for re-runs. |
| **Total** | **~$60–200/mo**, depending on model choice and plans |

Build cost: the MVP is scoped so a single engineer can build it within the $1.5–2k budget (this repo is that build).
