import { ExternalLink, Mail } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Empty, PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { integrations } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { getSettings } from "@/lib/services/settings";
import { requireUser } from "@/lib/supabase/server";
import type { Creator, Message } from "@/lib/types";
import { discard, markSent, sendEmail } from "../actions";

type Row = Message & { creators: Pick<Creator, "id" | "handle" | "platform" | "profile_url" | "business_email" | "status"> };
const CREATOR_COLS = "creators(id, handle, platform, profile_url, business_email, status)";

export default async function InboxPage() {
  const { supabase, user } = await requireUser();
  const [{ data: approved }, { data: sent }, { data: replies }, { data: sendJobs }, settings] = await Promise.all([
    supabase.from("messages").select(`*, ${CREATOR_COLS}`).eq("state", "approved").order("approved_at"),
    supabase.from("messages").select(`*, ${CREATOR_COLS}`).eq("state", "sent").order("sent_at", { ascending: false }).limit(25),
    supabase.from("messages").select(`*, ${CREATOR_COLS}`).eq("state", "received").order("sent_at", { ascending: false }).limit(25),
    supabase
      .from("jobs")
      .select("payload, status, run_after, last_error, created_at")
      .eq("type", "send_email")
      .order("created_at", { ascending: false })
      .limit(200),
    getSettings(supabase, user.id),
  ]);
  const signature = settings.email_signature?.trim() ?? "";
  // Latest auto-send job per message.
  const autoSend = new Map<string, { status: string; run_after: string; last_error: string | null }>();
  for (const j of sendJobs ?? []) {
    const id = String((j.payload as { messageId?: string }).messageId);
    if (!autoSend.has(id)) autoSend.set(id, j);
  }
  const canEmail = integrations().resend;
  const queue = (approved ?? []) as Row[];

  return (
    <>
      <PageHeader
        title="Outreach Inbox"
        description="Approved messages waiting to be sent. Approved emails go out automatically about 30 seconds after approval. DMs are sent by you on the platform, then marked sent here."
      />
      <h2 className="mb-3 text-sm font-semibold">Ready to send ({queue.length})</h2>
      {queue.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {queue.map((m) => {
            const c = m.creators;
            const isEmail = m.channel === "email";
            return (
              <Card key={m.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Link href={`/creators/${c.id}`} className="hover:underline">
                      @{c.handle}
                    </Link>
                    <span className="font-normal text-muted-foreground">
                      {m.kind === "follow_up" ? "follow-up" : "first message"} · {m.channel.replace("_", " ")}
                    </span>
                  </CardTitle>
                  {isEmail && <CardDescription>To: {c.business_email ?? "— no email"}</CardDescription>}
                  {isEmail && <AutoSendStatus job={autoSend.get(m.id)} />}
                </CardHeader>
                <CardContent className="space-y-3">
                  {m.subject && <div className="text-sm font-medium">{m.subject}</div>}
                  <p className="rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-line">
                    {m.body}
                    {isEmail && signature && !m.body.trimEnd().endsWith(signature) && (
                      <span className="mt-3 block border-t pt-2 text-muted-foreground" title="Added automatically when sent (Settings → Email signature)">
                        {signature}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <CopyButton text={m.body} />
                    {!isEmail && (
                      <a href={c.profile_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">
                        Open profile <ExternalLink className="size-3" />
                      </a>
                    )}
                    {isEmail && canEmail && (
                      <ActionForm action={sendEmail}>
                        <input type="hidden" name="messageId" value={m.id} />
                        <SubmitButton size="sm" pendingText="Sending…">
                          <Mail className="size-4" /> {autoSend.get(m.id)?.status === "queued" ? "Send now" : "Send email"}
                        </SubmitButton>
                      </ActionForm>
                    )}
                    <ActionForm action={discard}>
                      <input type="hidden" name="messageId" value={m.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Discard
                      </SubmitButton>
                    </ActionForm>
                  </div>
                  {(!isEmail || !canEmail) && (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium">I sent it — mark as sent</summary>
                      <ActionForm action={markSent} className="mt-2 space-y-2">
                        <input type="hidden" name="messageId" value={m.id} />
                        <Textarea name="sentBody" rows={4} defaultValue={m.body} aria-label="Exactly what you sent" />
                        <p className="text-xs text-muted-foreground">Edit to match exactly what you sent, so the record stays accurate.</p>
                        <SubmitButton size="sm">Mark sent</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Empty>
          Nothing approved yet. Review drafts in the <Link href="/messages" className="underline">Message Generator</Link>.
        </Empty>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Log title="Recently sent" rows={(sent ?? []) as Row[]} body={(m) => m.sent_body ?? m.body} />
        <Log title="Replies received" rows={(replies ?? []) as Row[]} body={(m) => m.body} empty="Log replies from a creator's page." />
      </div>
    </>
  );
}

function Log({ title, rows, body, empty = "Nothing yet." }: { title: string; rows: Row[]; body: (m: Row) => string; empty?: string }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length ? (
        <ul className="divide-y rounded-xl border">
          {rows.map((m) => (
            <li key={m.id} className="p-3 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground">
                <Link href={`/creators/${m.creators.id}`} className="font-medium text-foreground hover:underline">
                  @{m.creators.handle}
                </Link>
                <span>
                  {m.channel.replace("_", " ")} · {dateTime(m.sent_at)}
                </span>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-line">{body(m)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{empty}</Empty>
      )}
    </div>
  );
}

function AutoSendStatus({ job }: { job?: { status: string; run_after: string; last_error: string | null } }) {
  if (!job) return null;
  if (job.status === "queued" || job.status === "running")
    return (
      <p className="text-xs text-sky-700 dark:text-sky-400">
        {job.last_error ? `Waiting to retry (${job.last_error}) — next try ${dateTime(job.run_after)}` : `Sending automatically · ${dateTime(job.run_after)}`}. Discard to cancel.
      </p>
    );
  if (job.status === "failed") return <p className="text-xs text-red-600 dark:text-red-400">Automatic send failed: {job.last_error}</p>;
  return null;
}
