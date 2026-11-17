import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { integrations } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { configuredEndpoints } from "@/lib/llm/providers/compatible";
import { getSettings } from "@/lib/services/settings";
import { requireUser } from "@/lib/supabase/server";
import { addDncEntry, processQueue, saveSettings } from "../actions";

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const [s, { data: dnc }] = await Promise.all([
    getSettings(supabase, user.id),
    supabase.from("do_not_contact").select("*").order("created_at", { ascending: false }).limit(200),
  ]);
  const i = integrations();
  const freeModels = configuredEndpoints().map(({ label, model }) => ({ label, model }));
  const freeCount = freeModels.length;

  return (
    <>
      <PageHeader title="Settings & Integrations" />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveSettings} className="grid gap-4 sm:grid-cols-2">
              <F label="Your first name (used in messages)">
                <Input name="sender_name" defaultValue={s.sender_name} />
              </F>
              <F label="Reply-to email">
                <Input name="sender_email" type="email" defaultValue={s.sender_email ?? ""} />
              </F>
              <div className="sm:col-span-2">
                <F label="About you (the AI uses only this — never invents credentials)">
                  <Textarea name="sender_bio" rows={3} defaultValue={s.sender_bio} />
                </F>
              </div>
              <div className="sm:col-span-2">
                <F label="Target niches (comma-separated keywords, used for niche relevance)">
                  <Input name="target_niches" defaultValue={s.target_niches.join(", ")} placeholder="fitness, meal prep, personal finance" />
                </F>
              </div>
              <F label="Min followers">
                <Input name="min_followers" type="number" defaultValue={s.min_followers} />
              </F>
              <F label="Max followers">
                <Input name="max_followers" type="number" defaultValue={s.max_followers} />
              </F>
              <F label="Daily email send limit">
                <Input name="daily_email_limit" type="number" defaultValue={s.daily_email_limit} min={1} max={200} />
              </F>
              <F label="LLM provider">
                <NativeSelect name="llm_provider" defaultValue={s.llm_provider}>
                  <option value="free">Free providers — auto-fallback {freeCount ? `(${freeCount} configured)` : "(no keys yet)"}</option>
                  <option value="cerebras">Cerebras (free) {i.cerebras ? "" : "(key missing)"}</option>
                  <option value="groq">Groq (free) {i.groq ? "" : "(key missing)"}</option>
                  <option value="gemini">Gemini (free) {i.gemini ? "" : "(key missing)"}</option>
                  <option value="openrouter">OpenRouter (free) {i.openrouter ? "" : "(key missing)"}</option>
                  <option value="custom">Custom OpenAI-compatible {i.custom ? "" : "(not configured)"}</option>
                  <option value="anthropic">Anthropic {i.anthropic ? "" : "(key missing)"}</option>
                  <option value="openai">OpenAI {i.openai ? "" : "(key missing)"}</option>
                </NativeSelect>
              </F>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                The two model fields below apply to Anthropic and OpenAI only. Free providers use their own model each:{" "}
                {freeModels.length ? freeModels.map((e) => `${e.label} → ${e.model}`).join(", ") : "add a key (see Integrations) to enable them"}. Override with{" "}
                <code>CEREBRAS_MODEL</code>, <code>GROQ_MODEL</code>, <code>GEMINI_MODEL</code> or <code>OPENROUTER_MODEL</code>.
              </p>
              <F label="Analysis model">
                <Input name="analysis_model" defaultValue={s.analysis_model} list="models" />
              </F>
              <F label="Outreach model">
                <Input name="outreach_model" defaultValue={s.outreach_model} list="models" />
              </F>
              <datalist id="models">
                <option value="claude-opus-5-5" />
                <option value="claude-sonnet-5-5" />
                <option value="claude-haiku-5-5" />
              </datalist>
              <fieldset className="space-y-3 rounded-lg border p-3 sm:col-span-2">
                <legend className="px-1 text-xs font-medium">Auto-draft</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="auto_draft" defaultChecked={s.auto_draft} className="mt-0.5" />
                  <span>
                    After AI analysis, draft outreach messages automatically for creators scoring at least the minimum below.
                    <span className="block text-xs text-muted-foreground">
                      Drafts go to Message Generator for your review. Nothing is sent without your approval. Skips creators already drafted or contacted.
                    </span>
                  </span>
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <F label="Minimum score">
                    <Input name="auto_draft_min_score" type="number" min={0} max={100} defaultValue={s.auto_draft_min_score} />
                  </F>
                  <F label="Collaboration angle">
                    <NativeSelect name="auto_draft_proposition" defaultValue={s.auto_draft_proposition}>
                      <option value="open">Open conversation (recommended first touch)</option>
                      <option value="mvp">Option A — custom MVP build</option>
                      <option value="partnership">Option B — partnership</option>
                    </NativeSelect>
                  </F>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" name="auto_draft_include_budget" defaultChecked={s.auto_draft_include_budget} /> Mention budget
                  </label>
                </div>
              </fieldset>
              <F label="Apify Instagram profile actor">
                <Input name="apify_instagram_actor" defaultValue={s.apify_instagram_actor} />
              </F>
              <F label="Apify TikTok profile actor">
                <Input name="apify_tiktok_actor" defaultValue={s.apify_tiktok_actor} />
              </F>
              <div className="sm:col-span-2">
                <SubmitButton>Save settings</SubmitButton>
              </div>
            </ActionForm>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Integrations</CardTitle>
              <CardDescription>Keys live in server-side environment variables only.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {(
                  [
                    ["Anthropic", i.anthropic, "ANTHROPIC_API_KEY"],
                    ["OpenAI", i.openai, "OPENAI_API_KEY"],
                    ["Cerebras (free)", i.cerebras, "CEREBRAS_API_KEY"],
                    ["Groq (free)", i.groq, "GROQ_API_KEY"],
                    ["Gemini (free)", i.gemini, "GEMINI_API_KEY"],
                    ["OpenRouter (free)", i.openrouter, "OPENROUTER_API_KEY"],
                    ["Apify", i.apify, "APIFY_TOKEN"],
                    ["Resend (email)", i.resend, "RESEND_API_KEY + EMAIL_FROM"],
                  ] as const
                ).map(([name, ok, v]) => (
                  <li key={name} className="flex items-center gap-2">
                    {ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-muted-foreground" />}
                    <span className="flex-1">{name}</span>
                    {!ok && <code className="text-[11px] text-muted-foreground">{v}</code>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Do-not-contact list ({dnc?.length ?? 0})</CardTitle>
              <CardDescription>Permanent. Checked before every approval and send, and on import.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ActionForm action={addDncEntry} className="space-y-2" resetOnSuccess>
                <div className="flex gap-2">
                  <NativeSelect name="platform" defaultValue="instagram">
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                  </NativeSelect>
                  <Input name="handle" placeholder="@handle" />
                </div>
                <Input name="email" type="email" placeholder="or email" />
                <Input name="reason" placeholder="Reason" />
                <SubmitButton size="sm" variant="outline">
                  Add
                </SubmitButton>
              </ActionForm>
              <ul className="max-h-64 divide-y overflow-y-auto text-sm">
                {(dnc ?? []).map((d) => (
                  <li key={d.id} className="py-1.5">
                    {d.handle ? `${d.platform} @${d.handle}` : d.email}
                    <div className="text-xs text-muted-foreground">
                      {d.reason} · {dateTime(d.created_at)}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6" id="jobs">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Background jobs</CardTitle>
            <CardDescription>
              Processed by Vercel Cron (see vercel.json) or on demand. Progress, results and errors are on{" "}
              <Link href="/activity" className="underline">
                Activity
              </Link>
              .
            </CardDescription>
          </div>
          <ActionForm action={processQueue}>
            <SubmitButton size="sm" variant="outline" pendingText="Processing…">
              Process queue now
            </SubmitButton>
          </ActionForm>
        </CardHeader>
      </Card>
    </>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
