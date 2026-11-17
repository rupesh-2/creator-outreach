import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PriorityBadge } from "@/components/badges";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { compact, date } from "@/lib/format";
import { requireUser } from "@/lib/supabase/server";
import { CREATOR_STATUSES, STATUS_LABELS, type Creator, type CreatorStatus } from "@/lib/types";
import { updateStatus } from "../actions";

const COLUMNS: CreatorStatus[] = [
  "qualified",
  "pending_review",
  "approved",
  "contacted",
  "replied",
  "interested",
  "meeting_scheduled",
  "partnership_discussion",
  "collaborated",
  "not_interested",
];

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const { all } = (await searchParams) as { all?: string };
  const { supabase } = await requireUser();
  const cols = all ? CREATOR_STATUSES.filter((s) => s !== "do_not_contact") : COLUMNS;
  const { data } = await supabase
    .from("creators")
    .select("id, handle, platform, followers, score, priority, status, last_contacted_at, follow_up_at")
    .in("status", cols)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(1000);
  const by = new Map<CreatorStatus, Creator[]>();
  for (const c of (data ?? []) as Creator[]) by.set(c.status, [...(by.get(c.status) ?? []), c]);

  return (
    <>
      <PageHeader title="CRM / Pipeline" description="Every relationship by stage. Change a stage from the card.">
        <Link href={all ? "/pipeline" : "/pipeline?all=1"} className="text-sm underline">
          {all ? "Hide discovered/analyzed" : "Show all stages"}
        </Link>
      </PageHeader>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        <div className="flex gap-3">
          {cols.map((s) => {
            const items = by.get(s) ?? [];
            return (
              <section key={s} className="w-64 shrink-0 rounded-xl bg-muted/40 p-2">
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold">
                  {STATUS_LABELS[s]} <span className="text-muted-foreground tabular-nums">{items.length}</span>
                </h2>
                <ul className="space-y-2">
                  {items.slice(0, 60).map((c) => (
                    <li key={c.id} className="rounded-lg border bg-card p-2 text-sm shadow-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/creators/${c.id}`} className="truncate font-medium hover:underline">
                          @{c.handle}
                        </Link>
                        <PriorityBadge priority={c.priority} score={c.score} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {c.platform} · {compact(c.followers)}
                        {c.last_contacted_at && ` · sent ${date(c.last_contacted_at)}`}
                        {c.follow_up_at && ` · f/u ${date(c.follow_up_at)}`}
                      </div>
                      <ActionForm action={updateStatus} className="mt-2 flex gap-1">
                        <input type="hidden" name="creatorId" value={c.id} />
                        <NativeSelect name="status" defaultValue={c.status} className="h-7 min-w-0 flex-1 text-xs">
                          {CREATOR_STATUSES.map((x) => (
                            <option key={x} value={x}>
                              {STATUS_LABELS[x]}
                            </option>
                          ))}
                        </NativeSelect>
                        <SubmitButton size="xs" variant="outline">
                          Move
                        </SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                  {items.length > 60 && <li className="px-1 text-xs text-muted-foreground">+{items.length - 60} more</li>}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
