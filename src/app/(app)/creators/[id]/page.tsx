import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AnalysisView } from "@/components/analysis-view";
import { ConfidenceTag, PriorityBadge, StatusBadge } from "@/components/badges";
import { NativeSelect } from "@/components/native-select";
import { Empty, Stat } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AnalysisResult } from "@/lib/ai/analysis";
import type { Evidence } from "@/lib/ai/evidence";
import { compact, date, dateTime, pct } from "@/lib/format";
import { requireUser } from "@/lib/supabase/server";
import { CREATOR_STATUSES, STATUS_LABELS, type Creator, type CreatorPost, type Message } from "@/lib/types";
import { addNote, analyze, markDoNotContact, recordReply, saveCrmFields, updateStatus } from "../../actions";

export default async function CreatorPage({ params }: PageProps<"/creators/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: c } = await supabase.from("creators").select("*").eq("id", id).maybeSingle<Creator>();
  if (!c) notFound();

  const [{ data: posts }, { data: analysis }, { data: messages }, { data: events }] = await Promise.all([
    supabase.from("creator_posts").select("*").eq("creator_id", id).order("posted_at", { ascending: false, nullsFirst: false }).limit(30),
    supabase.from("analyses").select("*").eq("creator_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("messages").select("*").eq("creator_id", id).neq("state", "discarded").order("created_at", { ascending: false }),
    supabase.from("contact_events").select("*").eq("creator_id", id).order("occurred_at", { ascending: false }).limit(100),
  ]);
  const dnc = c.status === "do_not_contact";
  const sb = c.score_breakdown;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">@{c.handle}</h1>
            <a href={c.profile_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
              <ExternalLink className="size-4" />
            </a>
          </div>
          <p className="text-sm text-muted-foreground">
            {c.display_name} · {c.platform} {c.business_email && <>· {c.business_email}</>}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={c.status} />
            <PriorityBadge priority={c.priority} score={c.score} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={updateStatus} className="flex items-center gap-2">
            <input type="hidden" name="creatorId" value={c.id} />
            <NativeSelect name="status" defaultValue={c.status} disabled={dnc}>
              {CREATOR_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
            <SubmitButton size="sm" variant="outline" disabled={dnc}>
              Update
            </SubmitButton>
          </ActionForm>
          <ActionForm action={analyze}>
            <input type="hidden" name="creatorId" value={c.id} />
            {analysis && <input type="hidden" name="fresh" value="on" />}
            <SubmitButton size="sm" variant="outline" pendingText="Analyzing…">
              {analysis ? "Re-run analysis" : "Run AI analysis"}
            </SubmitButton>
          </ActionForm>
          <Button size="sm" disabled={!analysis || dnc} render={<Link href={`/messages?creator=${c.id}`} />}>
            Write outreach
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Followers" value={compact(c.followers)} hint={`following ${compact(c.following)}`} />
        <Stat label="Median views" value={compact(c.median_views)} hint={`avg ${compact(c.avg_views)}`} />
        <Stat label="Engagement" value={pct(c.engagement_rate)} hint="(likes+comments)/views" />
        <Stat label="Posts / 30 days" value={c.posts_last_30d ?? "—"} hint={`last ${date(c.last_posted_at)}`} />
        <Stat label="Total posts" value={compact(c.total_posts)} />
        <Stat label="Last contacted" value={<span className="text-base">{date(c.last_contacted_at)}</span>} hint={`follow-up ${date(c.follow_up_at)}`} />
      </div>

      {c.bio && <p className="mt-4 rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-line">{c.bio}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Source: {c.data_source}
        {c.source_ref ? ` (${c.source_ref})` : ""} · collected {dateTime(c.collected_at)} · permission: {c.data_permission}
      </p>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Score breakdown {sb && <span className="text-muted-foreground">— {sb.total}/100</span>}</CardTitle>
              <CardDescription>Deterministic scoring from collected data. Authenticity is heuristic indicators only, not verification.</CardDescription>
            </CardHeader>
            <CardContent>
              {sb ? (
                <ul className="space-y-3">
                  {sb.components.map((x) => (
                    <li key={x.key}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{x.label}</span>
                        <span className="flex items-center gap-2">
                          <ConfidenceTag c={x.confidence} />
                          <span className="tabular-nums">
                            {x.points}/{x.max}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(x.points / x.max) * 100}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{x.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Not scored yet.</Empty>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI analysis</CardTitle>
              {analysis && (
                <CardDescription>
                  {analysis.provider} · {analysis.model} · {dateTime(analysis.created_at)}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {analysis ? (
                <AnalysisView result={analysis.result as AnalysisResult} evidence={analysis.evidence as Evidence[]} dropped={analysis.dropped_claims} />
              ) : (
                <Empty>No analysis yet. Run it to get niche, themes, problems and collaboration ideas — all cited to collected data.</Empty>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent posts ({posts?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {posts?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1">Date</th>
                        <th>Caption</th>
                        <th className="text-right">Views</th>
                        <th className="text-right">Likes</th>
                        <th className="text-right">Comments</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(posts as CreatorPost[]).map((p) => (
                        <tr key={p.id}>
                          <td className="py-1.5 pr-2 whitespace-nowrap">{date(p.posted_at)}</td>
                          <td className="max-w-md truncate pr-2">
                            <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                              {p.caption || p.url}
                            </a>
                          </td>
                          <td className="text-right tabular-nums">{compact(p.views)}</td>
                          <td className="text-right tabular-nums">{compact(p.likes)}</td>
                          <td className="text-right tabular-nums">{compact(p.comments)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No post-level data collected.</Empty>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CRM</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={saveCrmFields} className="space-y-3">
                <input type="hidden" name="creatorId" value={c.id} />
                <div className="space-y-1.5">
                  <Label className="text-xs">Follow-up date</Label>
                  <Input type="date" name="follow_up_at" defaultValue={c.follow_up_at ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Collaboration opportunities</Label>
                  <Textarea name="collaboration_opportunities" rows={4} defaultValue={c.collaboration_opportunities ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Notes</Label>
                  <Textarea name="notes" rows={4} defaultValue={c.notes ?? ""} />
                </div>
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Log a reply</CardTitle>
              <CardDescription>Paste their reply. Status updates automatically from sentiment.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm action={recordReply} className="space-y-2" resetOnSuccess>
                <input type="hidden" name="creatorId" value={c.id} />
                <Textarea name="body" rows={3} placeholder="Their reply…" required />
                <div className="flex gap-2">
                  <NativeSelect name="channel" defaultValue={c.business_email ? "email" : c.platform === "instagram" ? "instagram_dm" : "tiktok_dm"}>
                    <option value="email">Email</option>
                    <option value="instagram_dm">Instagram DM</option>
                    <option value="tiktok_dm">TikTok DM</option>
                  </NativeSelect>
                  <NativeSelect name="sentiment" defaultValue="neutral">
                    <option value="positive">Positive</option>
                    <option value="neutral">Neutral</option>
                    <option value="negative">Not interested</option>
                  </NativeSelect>
                  <SubmitButton size="sm">Log</SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ActionForm action={addNote} className="flex gap-2" resetOnSuccess>
                <input type="hidden" name="creatorId" value={c.id} />
                <NativeSelect name="type" defaultValue="note">
                  <option value="note">Note</option>
                  <option value="meeting">Meeting</option>
                </NativeSelect>
                <Input name="body" placeholder="Add to timeline…" required />
                <SubmitButton size="sm" variant="outline">
                  Add
                </SubmitButton>
              </ActionForm>
              <ul className="space-y-2 text-sm">
                {(events ?? []).map((e) => (
                  <li key={e.id} className="border-l-2 pl-3">
                    <div className="text-xs text-muted-foreground">
                      {dateTime(e.occurred_at)} · {e.type.replace(/_/g, " ")}
                      {e.sentiment ? ` · ${e.sentiment}` : ""}
                    </div>
                    <div className="whitespace-pre-line">
                      {e.type === "status_change" ? `${e.from_status ? STATUS_LABELS[e.from_status as keyof typeof STATUS_LABELS] : "—"} → ${STATUS_LABELS[e.to_status as keyof typeof STATUS_LABELS]}` : e.body}
                    </div>
                  </li>
                ))}
                {!events?.length && <li className="text-muted-foreground">No activity yet.</li>}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Messages ({messages?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                {((messages ?? []) as Message[]).map((m) => (
                  <li key={m.id} className="rounded-lg border p-2">
                    <div className="mb-1 text-xs text-muted-foreground">
                      {m.kind} · {m.channel.replace("_", " ")} · {m.state}
                      {m.sent_at ? ` · ${dateTime(m.sent_at)}` : ""}
                    </div>
                    {m.subject && <div className="font-medium">{m.subject}</div>}
                    <div className="line-clamp-4 whitespace-pre-line">{m.sent_body ?? m.body}</div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {!dnc && (
            <ActionForm action={markDoNotContact} className="flex gap-2">
              <input type="hidden" name="creatorId" value={c.id} />
              <Input name="reason" placeholder="Reason (optional)" />
              <SubmitButton size="sm" variant="destructive">
                Do not contact
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </>
  );
}
