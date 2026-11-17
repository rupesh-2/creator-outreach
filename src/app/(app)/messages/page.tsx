import { AlertTriangle, Star } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { MessageEditor } from "@/components/message-editor";
import { NativeSelect } from "@/components/native-select";
import { Empty, PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AnalysisResult } from "@/lib/ai/analysis";
import type { Evidence } from "@/lib/ai/evidence";
import type { LintIssue } from "@/lib/ai/outreach";
import { compact } from "@/lib/format";
import { requireUser } from "@/lib/supabase/server";
import type { Creator, Message } from "@/lib/types";
import { approve, discard, generate, saveDraft } from "../actions";

const LIMITS: Record<string, number> = { instagram_dm: 450, tiktok_dm: 450, follow_up: 300 };
const TITLES: Record<string, string> = {
  "initial:instagram_dm": "Instagram DM",
  "initial:tiktok_dm": "TikTok message",
  "initial:email": "Email",
  "follow_up:email": "Follow-up (email)",
  "follow_up:instagram_dm": "Follow-up (Instagram DM)",
  "follow_up:tiktok_dm": "Follow-up (TikTok DM)",
};

interface Meta {
  observation?: { text: string; evidence: string[] };
  why_good_candidate?: { text: string; evidence: string[] };
  channel_reason?: string;
  issues?: LintIssue[];
}

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const { creator: creatorId } = (await searchParams) as { creator?: string };
  const { supabase } = await requireUser();

  if (!creatorId) {
    const { data } = await supabase
      .from("creators")
      .select("*")
      .in("status", ["pending_review", "qualified", "analyzed", "approved"])
      .order("status", { ascending: false })
      .order("score", { ascending: false })
      .limit(100);
    const list = (data ?? []) as Creator[];
    return (
      <>
        <PageHeader title="Message Generator" description="Pick a creator to generate and review personalised outreach." />
        {list.length ? (
          <div className="overflow-hidden rounded-xl border">
            <ul className="divide-y">
              {list.map((c) => (
                <li key={c.id}>
                  <Link href={`/messages?creator=${c.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">@{c.handle}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.platform} · {compact(c.followers)} followers {c.business_email ? "· has business email" : ""}
                      </div>
                    </div>
                    <StatusBadge status={c.status} />
                    <PriorityBadge priority={c.priority} score={c.score} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Empty>No analyzed creators yet. Run AI analysis first — outreach is grounded in it.</Empty>
        )}
      </>
    );
  }

  const { data: c } = await supabase.from("creators").select("*").eq("id", creatorId).maybeSingle<Creator>();
  if (!c) return <Empty>Creator not found.</Empty>;
  const [{ data: analysis }, { data: msgs }, { count: sentInitial }] = await Promise.all([
    supabase.from("analyses").select("result, evidence").eq("creator_id", c.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("messages").select("*").eq("creator_id", c.id).in("state", ["draft", "approved"]).order("created_at", { ascending: false }),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("creator_id", c.id).eq("kind", "initial").eq("state", "sent"),
  ]);
  const messages = (msgs ?? []) as Message[];
  const batchId = messages[0]?.batch_id;
  const batch = messages.filter((m) => m.batch_id === batchId);
  const meta = (batch[0] as unknown as { meta?: Meta })?.meta ?? {};
  const evidence = new Map(((analysis?.evidence ?? []) as Evidence[]).map((e) => [e.id, e]));
  const blocked = c.status === "do_not_contact" || c.status === "not_interested";
  const order = ["instagram_dm", "tiktok_dm", "email"];
  const sorted = [...batch].sort((a, b) => (a.kind === b.kind ? order.indexOf(a.channel) - order.indexOf(b.channel) : a.kind === "initial" ? -1 : 1));

  return (
    <>
      <PageHeader title={`Outreach for @${c.handle}`} description={`${c.platform} · ${compact(c.followers)} followers${c.business_email ? ` · ${c.business_email}` : ""}`}>
        <Link href={`/creators/${c.id}`} className="text-sm underline">
          Creator details
        </Link>
      </PageHeader>

      {blocked && (
        <Card className="mb-4 border-red-300 bg-red-50 dark:bg-red-950/30">
          <CardHeader>
            <CardTitle className="text-sm">This creator is marked “{c.status.replace(/_/g, " ")}”. Outreach is disabled.</CardTitle>
          </CardHeader>
        </Card>
      )}
      {!!sentInitial && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          An initial message has already been sent to this creator. Only the follow-up can be approved.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generate</CardTitle>
              <CardDescription>Uses the latest AI analysis and only cites collected evidence.</CardDescription>
            </CardHeader>
            <CardContent>
              {analysis ? (
                <ActionForm action={generate} className="space-y-3">
                  <input type="hidden" name="creatorId" value={c.id} />
                  <div className="space-y-1.5">
                    <Label className="text-xs">Collaboration angle</Label>
                    <NativeSelect name="proposition" defaultValue="open" className="w-full">
                      <option value="open">Open conversation (recommended first touch)</option>
                      <option value="mvp">Option A — custom MVP build</option>
                      <option value="partnership">Option B — partnership</option>
                    </NativeSelect>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="includeBudget" /> Mention the $1.5–2k budget
                  </label>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Extra instructions (optional)</Label>
                    <Textarea name="extra" rows={3} placeholder="e.g. keep it under 3 sentences; mention I'm also a runner" />
                  </div>
                  {batch.length > 0 && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="fresh" defaultChecked /> Fresh generation (skip cache)
                    </label>
                  )}
                  <SubmitButton className="w-full" disabled={blocked} pendingText="Writing…">
                    {batch.length ? "Regenerate" : "Generate messages"}
                  </SubmitButton>
                  {batch.length > 0 && <p className="text-xs text-muted-foreground">Regenerating discards current unapproved drafts.</p>}
                </ActionForm>
              ) : (
                <Empty>
                  Run the <Link href={`/creators/${c.id}`} className="underline">AI analysis</Link> first.
                </Empty>
              )}
            </CardContent>
          </Card>

          {analysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Analysis highlights</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Niche:</span> {(analysis.result as AnalysisResult).niche.value}
                </div>
                {(analysis.result as AnalysisResult).potential_problems.slice(0, 2).map((p, i) => (
                  <div key={i}>
                    <span className="text-muted-foreground">Possible problem:</span> {p.problem}
                  </div>
                ))}
                {(analysis.result as AnalysisResult).software_ideas.slice(0, 2).map((p, i) => (
                  <div key={i}>
                    <span className="text-muted-foreground">Idea:</span> {p.idea}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {batch.length === 0 ? (
            <Empty>No drafts yet.</Empty>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Why this creator</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {meta.why_good_candidate && (
                    <p>
                      {meta.why_good_candidate.text} <Refs ids={meta.why_good_candidate.evidence} ev={evidence} />
                    </p>
                  )}
                  {meta.observation && (
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="text-xs font-medium text-muted-foreground">Observation used in the messages</div>
                      {meta.observation.text} <Refs ids={meta.observation.evidence} ev={evidence} />
                      {meta.observation.evidence.map((id) => (
                        <div key={id} className="mt-1 truncate text-xs text-muted-foreground">
                          {id}: {evidence.get(id)?.text ?? "⚠ not in evidence"}
                        </div>
                      ))}
                    </div>
                  )}
                  {meta.channel_reason && (
                    <p>
                      <span className="font-medium">Recommended channel:</span> {batch.find((m) => m.recommended)?.channel.replace("_", " ")} — {meta.channel_reason}
                    </p>
                  )}
                  {!!meta.issues?.length && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      <div className="flex items-center gap-1 font-medium">
                        <AlertTriangle className="size-4" /> Review these before approving
                      </div>
                      <ul className="mt-1 list-disc pl-5">
                        {meta.issues.map((i, k) => (
                          <li key={k}>
                            <span className="font-mono text-xs">{i.field}</span>: {i.issue}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                {sorted.map((m) => {
                  const irrelevant = m.kind === "initial" && m.channel !== "email" && !m.channel.startsWith(c.platform);
                  return (
                    <Card key={m.id} className={irrelevant ? "opacity-60" : undefined}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-sm">
                          {TITLES[`${m.kind}:${m.channel}`] ?? m.channel}
                          {m.recommended && (
                            <span className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[11px] text-primary-foreground">
                              <Star className="size-3" /> Recommended
                            </span>
                          )}
                          {m.state === "approved" && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800">Approved</span>}
                        </CardTitle>
                        {irrelevant && <CardDescription>Creator is on {c.platform}; kept for reference.</CardDescription>}
                        {m.channel === "email" && !c.business_email && <CardDescription>No public business email collected.</CardDescription>}
                      </CardHeader>
                      <CardContent>
                        <MessageEditor
                          messageId={m.id}
                          body={m.body}
                          subject={m.subject}
                          showSubject={m.channel === "email"}
                          maxChars={m.kind === "follow_up" ? LIMITS.follow_up : LIMITS[m.channel]}
                          approved={m.state === "approved"}
                          actions={{ save: saveDraft, approve, discard }}
                        />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">
                Approved messages appear in the{" "}
                <Link href="/inbox" className="underline">
                  Outreach Inbox
                </Link>{" "}
                for sending.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Refs({ ids, ev }: { ids: string[]; ev: Map<string, Evidence> }) {
  return (
    <>
      {ids.map((id) => (
        <span key={id} title={ev.get(id)?.text} className="mr-1 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
          {id}
        </span>
      ))}
    </>
  );
}
