import { PageHeader, Stat } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { compact, daysFromNow, pct, usd } from "@/lib/format";
import { funnel, type Funnel } from "@/lib/services/metrics";
import { requireUser } from "@/lib/supabase/server";

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const { range = "30" } = (await searchParams) as { range?: string };
  const { supabase, user } = await requireUser();
  const days = range === "all" ? null : Number(range) || 30;
  const since = days ? daysFromNow(-days) : undefined;

  let usageQ = supabase.from("llm_usage").select("task, model, input_tokens, output_tokens, cost_usd, cache_hit, error").limit(20000);
  if (since) usageQ = usageQ.gte("created_at", since);
  const [f, { data: usage }, { data: byPlatform }] = await Promise.all([
    funnel(supabase, user.id, since),
    usageQ,
    supabase.from("creators").select("platform, priority, status, last_contacted_at").not("last_contacted_at", "is", null).limit(10000),
  ]);

  const costRows = new Map<string, { calls: number; cached: number; errors: number; inTok: number; outTok: number; cost: number }>();
  for (const u of usage ?? []) {
    const k = `${u.task} · ${u.model}`;
    const r = costRows.get(k) ?? { calls: 0, cached: 0, errors: 0, inTok: 0, outTok: 0, cost: 0 };
    r.calls++;
    if (u.cache_hit) r.cached++;
    if (u.error) r.errors++;
    r.inTok += u.input_tokens;
    r.outTok += u.output_tokens;
    r.cost += Number(u.cost_usd);
    costRows.set(k, r);
  }
  const totalCost = [...costRows.values()].reduce((a, r) => a + r.cost, 0);

  const RESPONDED = ["replied", "interested", "meeting_scheduled", "partnership_discussion", "collaborated", "not_interested"];
  const segment = (key: "platform" | "priority") => {
    const m = new Map<string, { contacted: number; responded: number }>();
    for (const c of byPlatform ?? []) {
      const k = String(c[key] ?? "unscored");
      const r = m.get(k) ?? { contacted: 0, responded: 0 };
      r.contacted++;
      if (RESPONDED.includes(c.status)) r.responded++;
      m.set(k, r);
    }
    return [...m.entries()];
  };

  return (
    <>
      <PageHeader title="Analytics" description="Funnel counts are distinct creators discovered in the selected range.">
        <form className="flex gap-1">
          {[
            ["7", "7d"],
            ["30", "30d"],
            ["90", "90d"],
            ["all", "All"],
          ].map(([v, l]) => (
            <button
              key={v}
              name="range"
              value={v}
              className={`rounded-md px-2.5 py-1 text-sm ${range === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {l}
            </button>
          ))}
        </form>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outreach conversion" value={pct(f.conversion)} hint="Partnerships ÷ contacted" />
        <Stat label="Reply rate" value={pct(f.replyRate)} />
        <Stat label="Positive reply rate" value={pct(f.positiveRate)} />
        <Stat label="LLM spend" value={usd(totalCost)} hint={f.qualified ? `${usd(totalCost / f.qualified)} per qualified creator` : undefined} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Discovery → partnership funnel</CardTitle>
            <CardDescription>Number of creators reaching each stage</CardDescription>
          </CardHeader>
          <CardContent>
            <FunnelBars f={f} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response rate by segment</CardTitle>
            <CardDescription>Contacted creators who replied in any way (all time)</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Segment</th>
                  <th className="text-right">Contacted</th>
                  <th className="text-right">Responded</th>
                  <th className="text-right">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...segment("platform"), ...segment("priority").map(([k, v]) => [`${k} priority`, v] as const)].map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-1.5 capitalize">{k}</td>
                    <td className="text-right tabular-nums">{v.contacted}</td>
                    <td className="text-right tabular-nums">{v.responded}</td>
                    <td className="text-right tabular-nums">{pct(v.contacted ? v.responded / v.contacted : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">LLM usage & cost</CardTitle>
          <CardDescription>Logged per call. Cache hits cost nothing. Models without a known price are logged at $0 — set LLM_PRICING_JSON.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Task · model</th>
                <th className="text-right">Calls</th>
                <th className="text-right">Cache hits</th>
                <th className="text-right">Errors</th>
                <th className="text-right">Input tok</th>
                <th className="text-right">Output tok</th>
                <th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...costRows.entries()].map(([k, r]) => (
                <tr key={k}>
                  <td className="py-1.5">{k}</td>
                  <td className="text-right tabular-nums">{r.calls}</td>
                  <td className="text-right tabular-nums">{r.cached}</td>
                  <td className="text-right tabular-nums">{r.errors}</td>
                  <td className="text-right tabular-nums">{compact(r.inTok)}</td>
                  <td className="text-right tabular-nums">{compact(r.outTok)}</td>
                  <td className="text-right tabular-nums">{usd(r.cost)}</td>
                </tr>
              ))}
              {!costRows.size && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-muted-foreground">
                    No LLM calls in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function FunnelBars({ f }: { f: Funnel }) {
  const steps = [
    ["Discovered", f.discovered],
    ["Qualified", f.qualified],
    ["Contacted", f.contacted],
    ["Replied", f.replied],
    ["Positive reply", f.positive],
    ["Meeting booked", f.meetings],
    ["Partnership", f.partnerships],
  ] as const;
  const max = Math.max(1, f.discovered);
  return (
    <ul className="space-y-2.5">
      {steps.map(([label, v], i) => {
        const prev = i ? steps[i - 1][1] : null;
        return (
          <li key={label} className="grid grid-cols-[110px_1fr_88px] items-center gap-3 text-sm" title={`${label}: ${v}${prev ? ` (${pct(v / prev)} of previous stage)` : ""}`}>
            <span className="text-muted-foreground">{label}</span>
            <div className="h-3">
              {v > 0 && <div className="h-3 rounded-r-[4px] bg-primary" style={{ width: `${Math.max(1, (v / max) * 100)}%` }} />}
            </div>
            <span className="text-right tabular-nums">
              {v}
              {prev ? <span className="ml-1 text-xs text-muted-foreground">{pct(prev ? v / prev : null, 0)}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
