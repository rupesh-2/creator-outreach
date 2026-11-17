import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDashed,
  ExternalLink,
  Hourglass,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { Empty, PageHeader, Stat } from "@/components/page-header";
import { QueueLive } from "@/components/queue-live";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { compact, dateTime } from "@/lib/format";
import {
  getActivity,
  type Run,
  type RunCreator,
  type StepState,
} from "@/lib/services/activity";
import { requireUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  cancelPendingJobs,
  processQueue,
  retryFailedJobs,
  runQueueTick,
} from "../actions";

export default async function ActivityPage() {
  const { supabase } = await requireUser();
  const { runs, totals, blockers } = await getActivity(supabase);
  const pending = totals.queued + totals.running;

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every discovery run and AI job, step by step: what’s happening now, what it produced, and what to do next."
      >
        <ActionForm action={processQueue}>
          <SubmitButton size="sm" variant="outline" pendingText="Processing…">
            Process queue now
          </SubmitButton>
        </ActionForm>
      </PageHeader>

      {blockers.map((b) => (
        <div
          key={b}
          className="mb-4 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">Jobs are blocked: {b}</div>
            <div className="mt-0.5">
              Add it to <code>.env.local</code>, restart <code>pnpm dev</code>,
              then click <b>Retry failed</b> on the affected run.{" "}
              <Link href="/settings" className="underline">
                Settings
              </Link>{" "}
              shows which integrations are configured.
            </div>
          </div>
        </div>
      ))}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Waiting"
          value={totals.queued}
          hint={
            totals.waitingOnApify
              ? `${totals.waitingOnApify} of these are scraping on Apify`
              : "Ready to run"
          }
        />
        <Stat label="Running" value={totals.running} />
        <Stat label="Finished" value={totals.done} />
        <Stat
          label="Failed"
          value={totals.failed}
          hint={totals.failed ? "Retry from the run below" : undefined}
        />
      </div>

      <div className="mb-6">
        <QueueLive pending={pending} tick={runQueueTick} />
      </div>

      {runs.length ? (
        <div className="space-y-4">
          {runs.map((r) => (
            <RunCard key={r.id} run={r} />
          ))}
        </div>
      ) : (
        <Empty>
          Nothing has run yet. Start one from{" "}
          <Link href="/discovery" className="underline">
            Discovery
          </Link>{" "}
          (Apify profiles or hashtag discovery).
        </Empty>
      )}
    </>
  );
}

const STATE: Record<
  StepState,
  { icon: typeof Circle; tone: string; label: string }
> = {
  pending: {
    icon: CircleDashed,
    tone: "text-muted-foreground",
    label: "Not started",
  },
  waiting: {
    icon: Hourglass,
    tone: "text-sky-600 dark:text-sky-400",
    label: "In progress",
  },
  running: {
    icon: Loader2,
    tone: "text-sky-600 dark:text-sky-400",
    label: "Running",
  },
  done: {
    icon: CheckCircle2,
    tone: "text-emerald-600 dark:text-emerald-400",
    label: "Done",
  },
  failed: {
    icon: XCircle,
    tone: "text-red-600 dark:text-red-400",
    label: "Failed",
  },
  skipped: {
    icon: MinusCircle,
    tone: "text-muted-foreground",
    label: "Skipped",
  },
};

function StateBadge({ state }: { state: StepState }) {
  const s = STATE[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium",
        s.tone,
      )}
    >
      <s.icon
        className={cn("size-3.5", state === "running" && "animate-spin")}
      />
      {s.label}
    </span>
  );
}

function RunCard({ run }: { run: Run }) {
  const hasFailures =
    run.steps.some((s) => s.state === "failed" || s.error) ||
    run.creators.some((c) => c.analysis === "failed" || c.draft === "failed");
  const hasPending = run.steps.some((s) =>
    ["pending", "waiting"].includes(s.state),
  );
  const ids = run.jobIds.join(",");
  const analysed = run.creators.filter((c) => c.analysis === "done").length;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{run.title}</h2>
            {run.platform && (
              <span className="rounded-md border px-1.5 py-0.5 text-xs capitalize text-muted-foreground">
                {run.platform}
              </span>
            )}
            <StateBadge state={run.state} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Started {dateTime(run.createdAt)}
          </div>
        </div>
        <div className="flex gap-2">
          {hasFailures && (
            <ActionForm action={retryFailedJobs}>
              <input type="hidden" name="jobIds" value={ids} />
              <SubmitButton
                size="sm"
                variant="outline"
                pendingText="Re-queuing…"
              >
                Retry failed
              </SubmitButton>
            </ActionForm>
          )}
          {hasPending && (
            <ActionForm action={cancelPendingJobs}>
              <input type="hidden" name="jobIds" value={ids} />
              <SubmitButton size="sm" variant="ghost" pendingText="Cancelling…">
                Cancel pending
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="relative space-y-3 border-l pl-5">
          {run.steps.map((s, i) => {
            const st = STATE[s.state];
            return (
              <li key={i} className="relative">
                <st.icon
                  className={cn(
                    "absolute top-0.5 -left-[27px] size-4 bg-card",
                    st.tone,
                    s.state === "running" && "animate-spin",
                  )}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {i + 1}. {s.label}
                  </span>
                  <span className={cn("text-xs", st.tone)}>{st.label}</span>
                  {s.apifyRunId && (
                    <a
                      href={`https://console.apify.com/view/runs/${s.apifyRunId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
                    >
                      Apify run <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{s.detail}</p>
                {s.error && (
                  <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {s.error}
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        {run.next && (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
            → {run.next}
          </p>
        )}

        {run.creators.length > 0 && (
          <details
            className="group rounded-lg border"
            open={run.creators.length <= 10}
          >
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium select-none">
              <span className="mr-1 inline-block transition-transform group-open:rotate-90">
                ›
              </span>
              {run.creators.length} creator
              {run.creators.length === 1 ? "" : "s"} from this run
              <span className="ml-2 font-normal text-muted-foreground">
                {run.creators.filter((c) => c.priority === "high").length} high
                priority · {analysed} analysed ·{" "}
                {run.creators.filter((c) => c.draft === "done").length} drafted
              </span>
            </summary>
            <CreatorTable creators={run.creators} />
          </details>
        )}
      </CardContent>
    </Card>
  );
}

const ANALYSIS: Record<RunCreator["analysis"], [string, string]> = {
  off: ["Not queued", "text-muted-foreground"],
  queued: ["Waiting", "text-sky-600 dark:text-sky-400"],
  running: ["Running", "text-sky-600 dark:text-sky-400"],
  done: ["Done", "text-emerald-600 dark:text-emerald-400"],
  failed: ["Failed", "text-red-600 dark:text-red-400"],
};

function CreatorTable({ creators }: { creators: RunCreator[] }) {
  return (
    <div className="max-h-[480px] overflow-auto border-t">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="p-2">Creator</th>
            <th className="p-2 text-right">Followers</th>
            <th className="p-2">Score</th>
            <th className="p-2">CRM status</th>
            <th className="p-2">AI analysis</th>
            <th className="p-2">Drafts</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {creators.map((c) => (
            <tr key={c.id} className="hover:bg-muted/40">
              <td className="p-2">
                <Link
                  href={`/creators/${c.id}`}
                  className="font-medium hover:underline"
                >
                  @{c.handle}
                </Link>
              </td>
              <td className="p-2 text-right tabular-nums">
                {compact(c.followers)}
              </td>
              <td className="p-2">
                <PriorityBadge priority={c.priority} score={c.score} />
              </td>
              <td className="p-2">
                <StatusBadge status={c.status} />
              </td>
              <td
                className={cn("p-2 text-xs", ANALYSIS[c.analysis][1])}
                title={c.analysisError}
              >
                {ANALYSIS[c.analysis][0]}
              </td>
              <td
                className={cn("p-2 text-xs", ANALYSIS[c.draft][1])}
                title={c.draftError}
              >
                {c.draft === "done" ? (
                  <Link
                    href={`/messages?creator=${c.id}`}
                    className="underline"
                  >
                    Review
                  </Link>
                ) : c.draft === "off" ? (
                  "—"
                ) : (
                  ANALYSIS[c.draft][0]
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
