import Link from "next/link";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { Empty, PageHeader, Stat } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { compact, date, pct } from "@/lib/format";
import { funnel } from "@/lib/services/metrics";
import { requireUser } from "@/lib/supabase/server";
import type { Creator } from "@/lib/types";

export default async function OverviewPage() {
  const { supabase, user } = await requireUser();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = new Date().toISOString().slice(0, 10);

  const [f, { count: todayCount }, { data: review }, { data: due }, { data: jobs }] = await Promise.all([
    funnel(supabase, user.id),
    supabase.from("creators").select("id", { count: "exact", head: true }).gte("created_at", startOfDay.toISOString()),
    supabase.from("creators").select("*").eq("status", "pending_review").order("score", { ascending: false }).limit(6),
    supabase
      .from("creators")
      .select("*")
      .lte("follow_up_at", today)
      .in("status", ["contacted", "replied", "interested", "meeting_scheduled", "partnership_discussion"])
      .order("follow_up_at")
      .limit(6),
    supabase.from("jobs").select("status").in("status", ["queued", "running", "failed"]),
  ]);
  const jobCounts = (jobs ?? []).reduce<Record<string, number>>((a, j) => ({ ...a, [j.status]: (a[j.status] ?? 0) + 1 }), {});

  return (
    <>
      <PageHeader title="Overview" description="Discovery → qualification → conversation → partnership." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Discovered" value={compact(f.discovered)} hint={`${todayCount ?? 0} today · target 50`} />
        <Stat label="Qualified" value={compact(f.qualified)} hint="Score ≥ 55" />
        <Stat label="Contacted" value={compact(f.contacted)} />
        <Stat label="Replies" value={compact(f.replied)} hint={`${pct(f.replyRate)} reply rate`} />
        <Stat label="Positive replies" value={compact(f.positive)} hint={`${pct(f.positiveRate)} of contacted`} />
        <Stat label="Meetings booked" value={compact(f.meetings)} />
        <Stat label="Partnerships" value={compact(f.partnerships)} />
        <Stat label="Outreach conversion" value={pct(f.conversion)} hint="Partnerships ÷ contacted" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiting for your review</CardTitle>
          </CardHeader>
          <CardContent>
            {review?.length ? (
              <CreatorList creators={review as Creator[]} href={(c) => `/messages?creator=${c.id}`} />
            ) : (
              <Empty>No drafts waiting. Generate messages for qualified creators.</Empty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Follow-ups due</CardTitle>
          </CardHeader>
          <CardContent>
            {due?.length ? (
              <CreatorList creators={due as Creator[]} href={(c) => `/creators/${c.id}`} extra={(c) => `due ${date(c.follow_up_at)}`} />
            ) : (
              <Empty>Nothing due today.</Empty>
            )}
          </CardContent>
        </Card>
      </div>

      {(jobCounts.queued || jobCounts.running || jobCounts.failed) && (
        <p className="mt-4 text-sm text-muted-foreground">
          Background jobs: {jobCounts.queued ?? 0} queued, {jobCounts.running ?? 0} running, {jobCounts.failed ?? 0} failed —{" "}
          <Link className="underline" href="/activity">
            view queue
          </Link>
        </p>
      )}
    </>
  );
}

function CreatorList({ creators, href, extra }: { creators: Creator[]; href: (c: Creator) => string; extra?: (c: Creator) => string }) {
  return (
    <ul className="divide-y">
      {creators.map((c) => (
        <li key={c.id}>
          <Link href={href(c)} className="flex items-center gap-3 py-2 hover:bg-muted/50">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">@{c.handle}</div>
              <div className="text-xs text-muted-foreground">
                {c.platform} · {compact(c.followers)} followers {extra ? `· ${extra(c)}` : ""}
              </div>
            </div>
            <StatusBadge status={c.status} />
            <PriorityBadge priority={c.priority} score={c.score} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
