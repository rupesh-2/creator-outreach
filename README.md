# Creator Outreach

A lean tool for finding micro-creators (10k–100k followers) on Instagram and TikTok, scoring them, analysing their content with an LLM, and writing grounded, personalised outreach. Every message is reviewed and approved by you before it's sent, and every relationship is tracked through to a partnership.

Architecture, schema, integrations, milestones and costs: [`docs/PLAN.md`](docs/PLAN.md).

## Setup (≈15 minutes)

1. **Supabase**: create a project. In SQL Editor, run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) (or use `supabase db push`). Under Authentication → Providers, keep Email enabled. While testing you can turn off "Confirm email".
2. **Environment**: `cp .env.example .env.local` and fill it in. You need the Supabase keys, at least one LLM key, `CRON_SECRET` and `UNSUBSCRIBE_SECRET` (`openssl rand -hex 32`). Apify and Resend are optional.
3. `pnpm install && pnpm dev`, open http://localhost:3000 and create your account.
4. In **Settings**, fill in your first name, a short honest bio (the AI uses only this to introduce you), your target niche keywords, and the model for each task.

### Deploy (Vercel)

Import the repo and add the same env vars, setting `APP_URL` to your production URL. `vercel.json` runs the job queue once a day, which is the Hobby plan limit. On Pro, change the schedule to `*/5 * * * *`. Either way, the "Process queue now" buttons run it on demand.

## Daily workflow

1. **Discovery**: import a CSV, add creators by hand, or queue Apify collection (by handle, or by hashtag discovery). Each creator is scored 0–100 on import.
2. **AI Analysis**: queue analysis for medium/high scorers. Analysis can move a creator to *Qualified* (its niche signal feeds the score).
3. **Message Generator**: generate the Instagram DM, TikTok message, email, follow-up, and the "why this creator" explanation. Fix anything flagged, then approve.
4. **Outreach Inbox**: emails send through Resend, with an unsubscribe link and a daily cap. DMs are copied, sent by you on the platform, then marked sent. Nothing is sent automatically.
5. **Creator page / Pipeline**: log replies (sentiment updates the status), add notes and meetings, and move stages.
6. **Follow-ups**: a follow-up is due 5 days after a send and is cleared when a reply is logged.
7. **Analytics**: the funnel, reply and conversion rates, and LLM spend.

## How the data-quality rules are enforced

| Rule | Where |
|---|---|
| Don't rank on follower count alone | `src/lib/scoring/score.ts`: followers are 10 of 100 points. Views relative to audience and engagement dominate. |
| Label uncertain metrics | Every score component carries `measured` / `estimated` / `insufficient_data`. Authenticity is labelled "indicators, not proof". |
| AI must not invent facts | `src/lib/ai/evidence.ts` builds a numbered evidence table. Every claim must cite ids, and uncited or mis-cited claims are dropped and shown as removed. |
| No sales tone, no fabricated familiarity, budget only on request | `lintOutreach()` in `src/lib/ai/outreach.ts` flags these before you approve. |
| No duplicate outreach / permanent DNC | `assertCanContact()` in `src/lib/services/crm.ts` runs on every approve and send. DNC is also checked on import, and unsubscribe links add the creator to it. |
| No unsolicited automated DMs | DMs are manual by design. Email requires approval, respects the daily limit and includes `List-Unsubscribe`. |

## Scripts

```
pnpm dev          # local dev
pnpm test         # unit tests + migration test on an in-process Postgres (PGlite)
pnpm typecheck
pnpm lint
pnpm build
```

## Notes

- **Apify actor output shapes vary.** The normalisers in `src/lib/ingestion/apify.ts` read several field names and keep the raw item. Run one small collection first and check a creator's page. You are responsible for checking that each actor's collection method is permitted for your use.
- **LLM providers**: Anthropic (default `claude-opus-5-5`) and OpenAI are implemented behind `LlmProvider` in `src/lib/llm`. To add one, implement `complete()` and register it in `getProvider()`. Costs use the built-in Anthropic price table. Add others with `LLM_PRICING_JSON='{"model":[inPerM,outPerM]}'`.
