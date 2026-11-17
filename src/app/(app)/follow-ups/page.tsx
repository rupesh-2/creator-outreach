import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/badges";
import { Empty, PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { date, daysFromNow } from "@/lib/format";
import { requireUser } from "@/lib/supabase/server";
import type { Creator } from "@/lib/types";
import { clearFollowUp, snoozeFollowUp } from "../actions";

const ACTIVE = ["contacted", "replied", "interested", "meeting_scheduled", "partnership_discussion"];

export default async function FollowUpsPage() {
  const { supabase } = await requireUser();
  const today = new Date().toISOString().slice(0, 10);
  const week = daysFromNow(7).slice(0, 10);
  const { data } = await supabase
    .from("creators")
    .select("*")
    .not("follow_up_at", "is", null)
    .lte("follow_up_at", week)
    .in("status", ACTIVE)
    .order("follow_up_at");
  const all = (data ?? []) as Creator[];
  const due = all.filter((c) => c.follow_up_at! <= today);
  const upcoming = all.filter((c) => c.follow_up_at! > today);

  return (
    <>
      <PageHeader
        title="Follow-up Management"
        description="Sending a message schedules a follow-up 5 days later. Logging a reply clears it. One polite follow-up is usually enough."
      />
      <Section title={`Due now (${due.length})`} rows={due} today={today} />
      <div className="h-8" />
      <Section title={`Next 7 days (${upcoming.length})`} rows={upcoming} today={today} />
    </>
  );
}

function Section({ title, rows, today }: { title: string; rows: Creator[]; today: string }) {
  return (
    <>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length ? (
        <ul className="divide-y rounded-xl border">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <Link href={`/creators/${c.id}`} className="font-medium hover:underline">
                  @{c.handle}
                </Link>
                <div className="text-xs text-muted-foreground">
                  last contacted {date(c.last_contacted_at)} · follow-up {date(c.follow_up_at)}
                  {c.follow_up_at! < today && <span className="ml-1 font-medium text-red-600">overdue</span>}
                </div>
              </div>
              <StatusBadge status={c.status} />
              <Button size="sm" render={<Link href={`/messages?creator=${c.id}`} />}>
                Follow-up draft
              </Button>
              <ActionForm action={snoozeFollowUp}>
                <input type="hidden" name="creatorId" value={c.id} />
                <input type="hidden" name="days" value="3" />
                <SubmitButton size="sm" variant="outline">
                  Snooze 3d
                </SubmitButton>
              </ActionForm>
              <ActionForm action={clearFollowUp}>
                <input type="hidden" name="creatorId" value={c.id} />
                <SubmitButton size="sm" variant="ghost">
                  Clear
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing here.</Empty>
      )}
    </>
  );
}
