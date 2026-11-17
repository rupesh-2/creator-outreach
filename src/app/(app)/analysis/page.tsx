import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { Empty, PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisResult } from "@/lib/ai/analysis";
import { compact, dateTime } from "@/lib/format";
import { requireUser } from "@/lib/supabase/server";
import type { Creator } from "@/lib/types";
import { analyze, bulkAnalyze, processQueue } from "../actions";

export default async function AnalysisPage() {
  const { supabase } = await requireUser();
  const [{ data: pending }, { data: recent }] = await Promise.all([
    supabase.from("creators").select("*").eq("status", "discovered").or("priority.is.null,priority.neq.low").order("score", { ascending: false }).limit(50),
    supabase.from("analyses").select("id, creator_id, result, model, created_at, creators(handle, platform, status, score, priority)").order("created_at", { ascending: false }).limit(30),
  ]);
  const queue = (pending ?? []) as Creator[];

  return (
    <>
      <PageHeader title="AI Analysis" description="Grounded analysis of niche, themes, problems and collaboration angles. Every claim cites collected evidence.">
        <ActionForm action={processQueue}>
          <SubmitButton variant="outline" size="sm" pendingText="Processing…">
            Process job queue
          </SubmitButton>
        </ActionForm>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ready to analyze ({queue.length})</CardTitle>
            <CardDescription>Discovered creators scoring medium or above (or unscored). Low scorers are skipped to save LLM spend.</CardDescription>
          </CardHeader>
          <CardContent>
            {queue.length ? (
              <>
                <ActionForm action={bulkAnalyze} className="mb-3">
                  {queue.map((c) => (
                    <input key={c.id} type="hidden" name="ids" value={c.id} />
                  ))}
                  <SubmitButton size="sm">Queue all {queue.length}</SubmitButton>
                </ActionForm>
                <ul className="divide-y">
                  {queue.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-2">
                      <Link href={`/creators/${c.id}`} className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">@{c.handle}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.platform} · {compact(c.followers)} followers · {compact(c.median_views)} median views
                        </div>
                      </Link>
                      <PriorityBadge priority={c.priority} score={c.score} />
                      <ActionForm action={analyze}>
                        <input type="hidden" name="creatorId" value={c.id} />
                        <SubmitButton size="sm" variant="outline" pendingText="…">
                          Analyze now
                        </SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Empty>Nothing waiting. Import creators from Discovery.</Empty>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent analyses</CardTitle>
          </CardHeader>
          <CardContent>
            {recent?.length ? (
              <ul className="divide-y">
                {recent.map((a) => {
                  const r = a.result as AnalysisResult;
                  const c = a.creators as unknown as Pick<Creator, "handle" | "platform" | "status" | "score" | "priority">;
                  return (
                    <li key={a.id} className="py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/creators/${a.creator_id}`} className="font-medium hover:underline">
                          @{c?.handle}
                        </Link>
                        {c && <StatusBadge status={c.status} />}
                        {c && <PriorityBadge priority={c.priority} score={c.score} />}
                        <span className="ml-auto text-xs text-muted-foreground">{dateTime(a.created_at)}</span>
                      </div>
                      <div className="mt-1 text-sm">{r.niche.value}</div>
                      {r.software_ideas[0] && <div className="text-xs text-muted-foreground">Idea: {r.software_ideas[0].idea}</div>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>No analyses yet.</Empty>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
