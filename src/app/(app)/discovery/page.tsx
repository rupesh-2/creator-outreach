import { Download, FileDown } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { NativeSelect } from "@/components/native-select";
import { Empty, PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { integrations } from "@/lib/env";
import { compact, date, pct } from "@/lib/format";
import { creatorQuery, type CreatorFilters } from "@/lib/services/creator-query";
import { requireUser } from "@/lib/supabase/server";
import { CREATOR_STATUSES, STATUS_LABELS, type Creator } from "@/lib/types";
import { addCreatorManual, bulkAnalyze, importCsv, processQueue, queueApifyHashtag, queueApifyProfiles, rescoreAll } from "../actions";

const PAGE = 100;

export default async function DiscoveryPage({ searchParams }: PageProps<"/discovery">) {
  const f = (await searchParams) as CreatorFilters;
  const { supabase } = await requireUser();
  const page = Math.max(0, Number(f.page ?? 0));
  const { data, count } = await creatorQuery(supabase, f).range(page * PAGE, page * PAGE + PAGE - 1);
  const creators = (data ?? []) as unknown as Creator[];
  const apify = integrations().apify;
  const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== "page") as [string, string][]);

  return (
    <>
      <PageHeader title="Influencer Discovery" description="Import creators, then qualify them with the scoring engine and AI analysis.">
        <ActionForm action={rescoreAll}>
          <SubmitButton variant="outline" size="sm" pendingText="Rescoring…">
            Rescore all
          </SubmitButton>
        </ActionForm>
        <Button variant="outline" size="sm" render={<a href={`/api/export/creators?${qs}`} />}>
          <Download className="size-4" /> Export CSV
        </Button>
      </PageHeader>

      <Card className="mb-6">
        <CardContent className="pt-0">
          <Tabs defaultValue="csv">
            <TabsList>
              <TabsTrigger value="csv">CSV import</TabsTrigger>
              <TabsTrigger value="manual">Add manually</TabsTrigger>
              <TabsTrigger value="apify">Apify: profiles</TabsTrigger>
              <TabsTrigger value="hashtag">Apify: hashtag discovery</TabsTrigger>
            </TabsList>

            <TabsContent value="csv" className="pt-4">
              <ActionForm action={importCsv} className="flex flex-wrap items-end gap-3" resetOnSuccess>
                <div className="space-y-1.5">
                  <Label htmlFor="file">CSV file</Label>
                  <Input id="file" name="file" type="file" accept=".csv,text/csv" required className="max-w-xs" />
                </div>
                <SubmitButton pendingText="Importing…">Import</SubmitButton>
                <Button variant="link" size="sm" render={<a href="/api/export/template" />}>
                  <FileDown className="size-4" /> Download template
                </Button>
              </ActionForm>
              <p className="mt-2 text-xs text-muted-foreground">
                One row per creator, or one row per post (repeat platform + handle) to get per-video metrics. Re-importing updates existing creators and
                never overwrites CRM status or notes. Creators on the do-not-contact list are skipped.
              </p>
            </TabsContent>

            <TabsContent value="manual" className="pt-4">
              <ActionForm action={addCreatorManual} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" resetOnSuccess>
                <Field label="Platform">
                  <NativeSelect name="platform" required defaultValue="instagram">
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                  </NativeSelect>
                </Field>
                <Field label="Handle *">
                  <Input name="handle" required placeholder="@handle" />
                </Field>
                <Field label="Display name">
                  <Input name="display_name" />
                </Field>
                <Field label="Followers">
                  <Input name="followers" placeholder="24k" />
                </Field>
                <Field label="Median views (recent)">
                  <Input name="median_views" placeholder="12k" />
                </Field>
                <Field label="Engagement rate">
                  <Input name="engagement_rate" placeholder="5.2%" />
                </Field>
                <Field label="Posts in last 30 days">
                  <Input name="posts_last_30d" type="number" min={0} />
                </Field>
                <Field label="Last posted">
                  <Input name="last_posted_at" type="date" />
                </Field>
                <Field label="Public business email">
                  <Input name="business_email" type="email" />
                </Field>
                <Field label="Profile link">
                  <Input name="external_url" type="url" />
                </Field>
                <Field label="Niche">
                  <Input name="niche" />
                </Field>
                <div className="sm:col-span-2 lg:col-span-4">
                  <Field label="Bio">
                    <Textarea name="bio" rows={2} />
                  </Field>
                </div>
                <div>
                  <SubmitButton>Add creator</SubmitButton>
                </div>
              </ActionForm>
            </TabsContent>

            <TabsContent value="apify" className="pt-4">
              {!apify && <ApifyMissing />}
              <ActionForm action={queueApifyProfiles} className="grid gap-3 lg:grid-cols-[160px_1fr_auto]" resetOnSuccess>
                <Field label="Platform">
                  <NativeSelect name="platform" defaultValue="instagram">
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                  </NativeSelect>
                </Field>
                <Field label="Handles (comma, space or newline separated)">
                  <Textarea name="handles" rows={2} placeholder="mealprepmia, @fitwithjo" required />
                </Field>
                <div className="flex flex-col justify-end gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="autoAnalyze" /> Auto-analyze
                  </label>
                  <SubmitButton disabled={!apify}>Queue collection</SubmitButton>
                </div>
              </ActionForm>
              <QueueRunner />
            </TabsContent>

            <TabsContent value="hashtag" className="pt-4">
              {!apify && <ApifyMissing />}
              <ActionForm action={queueApifyHashtag} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <Field label="Platform">
                  <NativeSelect name="platform" defaultValue="instagram">
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                  </NativeSelect>
                </Field>
                <div className="lg:col-span-2">
                  <Field label="Hashtags">
                    <Input name="hashtags" placeholder="mealprep, highproteinrecipes" required />
                  </Field>
                </div>
                <Field label="Hashtag actor id">
                  <Input name="actor" defaultValue="apify/instagram-hashtag-scraper" required />
                </Field>
                <Field label="Posts to scan">
                  <Input name="limit" type="number" defaultValue={100} min={10} max={1000} />
                </Field>
                <Field label="Max new creators">
                  <Input name="maxNew" type="number" defaultValue={50} min={1} max={200} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="autoAnalyze" /> Auto-analyze
                </label>
                <div>
                  <SubmitButton disabled={!apify}>Queue discovery</SubmitButton>
                </div>
              </ActionForm>
              <p className="mt-2 text-xs text-muted-foreground">
                Scans recent posts for the hashtags, collects unique authors you don&apos;t already have, then queues profile collection for them. For TikTok use a
                hashtag-capable actor such as <code>clockworks/tiktok-scraper</code>. Check each actor&apos;s terms and your platform obligations before running.
              </p>
              <QueueRunner />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <form className="mb-3 flex flex-wrap items-end gap-2" method="get">
        <Input name="q" defaultValue={f.q} placeholder="Search handle, name, bio, niche…" className="w-64" />
        <NativeSelect name="platform" defaultValue={f.platform ?? ""}>
          <option value="">All platforms</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
        </NativeSelect>
        <NativeSelect name="priority" defaultValue={f.priority ?? ""}>
          <option value="">All priorities</option>
          <option value="high">High (70+)</option>
          <option value="medium">Medium (55–69)</option>
          <option value="low">Low (&lt;55)</option>
          <option value="unscored">Unscored</option>
        </NativeSelect>
        <NativeSelect name="status" defaultValue={f.status ?? ""}>
          <option value="">All statuses</option>
          {CREATOR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="sort" defaultValue={f.sort ?? "score"}>
          <option value="score">Sort: score</option>
          <option value="followers">Sort: followers</option>
          <option value="views">Sort: median views</option>
          <option value="engagement">Sort: engagement</option>
          <option value="last_post">Sort: last post</option>
          <option value="recent">Sort: recently added</option>
        </NativeSelect>
        <NativeSelect name="dir" defaultValue={f.dir ?? "desc"}>
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </NativeSelect>
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
        <Link href="/discovery" className="text-sm text-muted-foreground underline">
          Reset
        </Link>
      </form>

      {creators.length ? (
        <ActionForm action={bulkAnalyze}>
          <div className="mb-2 flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              {count} creator{count === 1 ? "" : "s"}
            </span>
            <SubmitButton size="sm" variant="outline">
              Queue AI analysis for selected
            </SubmitButton>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 p-2" />
                  <th className="p-2">Creator</th>
                  <th className="p-2 text-right">Followers</th>
                  <th className="p-2 text-right">Median views</th>
                  <th className="p-2 text-right">Engagement</th>
                  <th className="p-2 text-right">Posts/30d</th>
                  <th className="p-2">Last post</th>
                  <th className="p-2">Score</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {creators.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="p-2">
                      <input type="checkbox" name="ids" value={c.id} aria-label={`Select @${c.handle}`} />
                    </td>
                    <td className="p-2">
                      <Link href={`/creators/${c.id}`} className="font-medium hover:underline">
                        @{c.handle}
                      </Link>
                      <div className="max-w-64 truncate text-xs text-muted-foreground">
                        {c.platform} · {c.display_name ?? ""} {c.business_email ? "· ✉︎" : ""}
                      </div>
                    </td>
                    <td className="p-2 text-right tabular-nums">{compact(c.followers)}</td>
                    <td className="p-2 text-right tabular-nums">{compact(c.median_views)}</td>
                    <td className="p-2 text-right tabular-nums">{pct(c.engagement_rate)}</td>
                    <td className="p-2 text-right tabular-nums">{c.posts_last_30d ?? "—"}</td>
                    <td className="p-2 whitespace-nowrap">{date(c.last_posted_at)}</td>
                    <td className="p-2">
                      <PriorityBadge priority={c.priority} score={c.score} />
                    </td>
                    <td className="p-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{c.data_source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            {page > 0 && (
              <Button variant="outline" size="sm" render={<Link href={`/discovery?${qs}&page=${page - 1}`} />}>
                Previous
              </Button>
            )}
            {(count ?? 0) > (page + 1) * PAGE && (
              <Button variant="outline" size="sm" render={<Link href={`/discovery?${qs}&page=${page + 1}`} />}>
                Next
              </Button>
            )}
          </div>
        </ActionForm>
      ) : (
        <Empty>No creators match. Import a CSV or add one manually to get started.</Empty>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function ApifyMissing() {
  return (
    <Card className="mb-3 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
      <CardHeader>
        <CardTitle className="text-sm">Apify isn&apos;t configured</CardTitle>
        <CardDescription>Set APIFY_TOKEN in your environment to enable collection. CSV and manual import work without it.</CardDescription>
      </CardHeader>
    </Card>
  );
}

function QueueRunner() {
  return (
    <ActionForm action={processQueue} className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span>
        Apify runs take a few minutes. Follow progress, results and errors on{" "}
        <Link href="/activity" className="underline">
          Activity
        </Link>{" "}
        (it runs the queue for you while open), or
      </span>
      <SubmitButton size="sm" variant="ghost" pendingText="Processing…">
        process queue now
      </SubmitButton>
    </ActionForm>
  );
}
