import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Creator } from "@/lib/types";

export type JobStatus = "queued" | "running" | "done" | "failed";
export type StepState =
  "pending" | "waiting" | "running" | "done" | "failed" | "skipped";

export interface JobRow {
  id: string;
  type: "apify_profiles" | "apify_hashtag" | "analyze" | "outreach" | "send_email";
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Step {
  label: string;
  state: StepState;
  detail: string;
  apifyRunId?: string;
  error?: string;
}

export type RunCreator = Pick<
  Creator,
  "id" | "handle" | "platform" | "followers" | "score" | "priority" | "status"
> & {
  analysis: JobStatus | "off";
  analysisError?: string;
  /** Auto-drafted outreach (outreach job) status. */
  draft: JobStatus | "off";
  draftError?: string;
};

export interface Run {
  id: string;
  title: string;
  platform: string | null;
  createdAt: string;
  state: StepState;
  steps: Step[];
  creators: RunCreator[];
  next: string | null;
  /** Ids of every job in this run (root + descendants), for retry/cancel. */
  jobIds: string[];
}

export interface Activity {
  runs: Run[];
  totals: Record<JobStatus, number> & { waitingOnApify: number };
  /** Errors that block whole job types until the user fixes config (e.g. a missing API key). */
  blockers: string[];
}

const TOP_LEVEL_LIMIT = 30;

export async function getActivity(db: SupabaseClient): Promise<Activity> {
  const { data } = await db
    .from("jobs")
    .select(
      "id, type, status, payload, result, attempts, max_attempts, run_after, last_error, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(2000);
  const jobs = (data ?? []) as JobRow[];

  const children = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const parent = j.payload.parentId as string | undefined;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), j]);
  }
  const kids = (j: JobRow) => children.get(j.id) ?? [];

  // Creators referenced by profile results or analysis jobs.
  const creatorIds = new Set<string>();
  for (const j of jobs) {
    if (j.type === "apify_profiles")
      for (const id of (j.result?.ids as string[] | undefined) ?? [])
        creatorIds.add(id);
    if (j.type === "analyze" || j.type === "outreach" || j.type === "send_email")
      creatorIds.add(String(j.payload.creatorId));
  }
  const creatorsById = new Map<string, RunCreator>();
  const ids = [...creatorIds];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: cs } = await db
      .from("creators")
      .select("id, handle, platform, followers, score, priority, status")
      .in("id", ids.slice(i, i + 200));
    for (const c of cs ?? [])
      creatorsById.set(c.id, {
        ...(c as RunCreator),
        analysis: "off",
        draft: "off",
      });
  }

  // A creator can be queued for analysis more than once (overlapping runs, manual re-queues):
  // show the most advanced attempt, and keep every job id so retry/cancel reach all of them.
  const analysisJobs = new Map<string, JobRow[]>();
  for (const j of jobs.filter((j) => j.type === "analyze")) {
    const id = String(j.payload.creatorId);
    analysisJobs.set(id, [...(analysisJobs.get(id) ?? []), j]);
  }
  for (const [id, list] of analysisJobs) {
    const c = creatorsById.get(id);
    if (!c) continue;
    const best = list.reduce((a, b) =>
      rank(b.status) > rank(a.status) ? b : a,
    );
    c.analysis = best.status;
    c.analysisError =
      best.status !== "done" ? (best.last_error ?? undefined) : undefined;
  }

  const draftJobs = new Map<string, JobRow[]>();
  for (const j of jobs.filter((j) => j.type === "outreach")) {
    const id = String(j.payload.creatorId);
    draftJobs.set(id, [...(draftJobs.get(id) ?? []), j]);
  }
  for (const [id, list] of draftJobs) {
    const c = creatorsById.get(id);
    if (!c) continue;
    const best = list.reduce((a, b) =>
      rank(b.status) > rank(a.status) ? b : a,
    );
    c.draft = best.status;
    c.draftError =
      best.status !== "done" ? (best.last_error ?? undefined) : undefined;
  }
  const related = { analysisJobs, draftJobs };

  const roots = jobs.filter(
    (j) =>
      !j.payload.parentId || !jobs.some((p) => p.id === j.payload.parentId),
  );
  const runs: Run[] = [];
  const manual: JobRow[] = [];
  for (const root of roots) {
    if (root.type === "apify_hashtag")
      runs.push(hashtagRun(root, kids, creatorsById, related));
    else if (root.type === "apify_profiles")
      runs.push(profilesRun(root, kids, creatorsById, related, null));
    else manual.push(root);
  }
  runs.push(...manualRuns(manual, creatorsById));
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const totals = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    waitingOnApify: 0,
  };
  for (const j of jobs) {
    totals[j.status]++;
    if (j.status === "queued" && j.payload.runId) totals.waitingOnApify++;
  }
  const blockers = [
    ...new Set(
      jobs
        .filter(
          (j) =>
            j.status !== "done" &&
            j.last_error &&
            / is not set$/.test(j.last_error),
        )
        .map((j) => j.last_error as string),
    ),
  ];
  return { runs: runs.slice(0, TOP_LEVEL_LIMIT), totals, blockers };
}

function apifyStep(label: string, j: JobRow, doneDetail: string): Step {
  const runId = j.payload.runId as string | undefined;
  const polls = Number(j.payload.polls ?? 0);
  const base = { label, apifyRunId: runId };
  if (j.status === "done")
    return { ...base, state: "done", detail: doneDetail };
  if (j.status === "failed")
    return {
      ...base,
      state: "failed",
      detail: "Failed",
      error: j.last_error ?? undefined,
    };
  if (j.status === "running")
    return { ...base, state: "running", detail: "Checking now…" };
  const retry = j.last_error ? ` Last attempt failed: ${j.last_error}` : "";
  if (!runId)
    return {
      ...base,
      state: "pending",
      detail: `Not started yet — waiting for the queue to run.${retry}`,
    };
  return {
    ...base,
    state: "waiting",
    detail: `Scraping on Apify${polls ? ` (checked ${polls}×)` : ""}. Results are picked up automatically.${retry}`,
  };
}

function hashtagRun(
  h: JobRow,
  kids: (j: JobRow) => JobRow[],
  creators: Map<string, RunCreator>,
  related: {
    analysisJobs: Map<string, JobRow[]>;
    draftJobs: Map<string, JobRow[]>;
  },
): Run {
  const tags = (h.payload.hashtags as string[]) ?? [];
  const r = h.result as { found?: number; queuedForEnrichment?: number } | null;
  const scan = apifyStep(
    "Scan hashtag posts",
    h,
    `Found ${r?.found ?? 0} unique authors · ${r?.queuedForEnrichment ?? 0} new sent for profile collection${
      r?.found &&
      r.queuedForEnrichment !== undefined &&
      r.queuedForEnrichment < r.found
        ? " (rest already known or over your “Max new” cap)"
        : ""
    }`,
  );
  const profileJobs = kids(h).filter((k) => k.type === "apify_profiles");
  const base: Run = {
    id: h.id,
    title: tags.map((t) => `#${t}`).join("  "),
    platform: (h.payload.platform as string) ?? null,
    createdAt: h.created_at,
    state: "pending",
    steps: [scan],
    creators: [],
    next: null,
    jobIds: [h.id],
  };
  if (h.status === "done" && !profileJobs.length) {
    base.steps.push({
      label: "Collect profiles",
      state: "skipped",
      detail: "No new creators to collect.",
    });
    base.steps.push({
      label: "AI analysis",
      state: "skipped",
      detail: "Nothing to analyse.",
    });
    base.steps.push({
      label: "Draft messages",
      state: "skipped",
      detail: "Nothing to draft.",
    });
    return finalize(base);
  }
  if (!profileJobs.length) {
    base.steps.push({
      label: "Collect profiles",
      state: "pending",
      detail: "Starts when the scan finishes.",
    });
    base.steps.push({
      label: "AI analysis",
      state: h.payload.autoAnalyze ? "pending" : "skipped",
      detail: h.payload.autoAnalyze
        ? "Starts after profiles are collected."
        : "Auto-analyze was off.",
    });
    base.steps.push({
      label: "Draft messages",
      state: h.payload.autoAnalyze ? "pending" : "skipped",
      detail: h.payload.autoAnalyze
        ? "Qualified creators get drafts automatically after analysis."
        : "Needs analysis first.",
    });
    return finalize(base);
  }
  const sub = profileJobs.map((p) =>
    profilesRun(p, kids, creators, related, h),
  );
  return finalize({
    ...base,
    steps: [scan, ...mergeSteps(sub.map((s) => s.steps))],
    creators: dedupe(sub.flatMap((s) => s.creators)),
    jobIds: [h.id, ...sub.flatMap((s) => s.jobIds)],
  });
}

function profilesRun(
  p: JobRow,
  kids: (j: JobRow) => JobRow[],
  creators: Map<string, RunCreator>,
  related: {
    analysisJobs: Map<string, JobRow[]>;
    draftJobs: Map<string, JobRow[]>;
  },
  parent: JobRow | null,
): Run {
  const handles = (p.payload.handles as string[]) ?? [];
  const r = p.result as {
    inserted?: number;
    updated?: number;
    skippedDnc?: number;
    failed?: unknown[];
    ids?: string[];
  } | null;
  const collect = apifyStep(
    "Collect profiles",
    p,
    `${handles.length} handles → ${r?.inserted ?? 0} new creators saved, ${r?.updated ?? 0} updated${r?.skippedDnc ? `, ${r.skippedDnc} skipped (do-not-contact)` : ""}${
      r?.failed?.length ? `, ${r.failed.length} failed` : ""
    }. All scored automatically.`,
  );
  if (p.status !== "done")
    collect.detail = `${handles.length} handles · ${collect.detail}`;

  const ids = [...new Set((r?.ids ?? []) as string[])];
  const list = ids
    .map((id) => creators.get(id))
    .filter((c): c is RunCreator => !!c)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const analyses = [
    ...kids(p).filter((k) => k.type === "analyze"),
    ...ids.flatMap((id) => related.analysisJobs.get(id) ?? []),
  ];
  const drafts = ids.flatMap((id) => related.draftJobs.get(id) ?? []);

  const autoAnalyze = !!p.payload.autoAnalyze;
  let analysis: Step;
  if (!autoAnalyze)
    analysis = {
      label: "AI analysis",
      state: "skipped",
      detail:
        "Auto-analyze was off — select creators in Discovery and queue analysis.",
    };
  else if (p.status !== "done")
    analysis = {
      label: "AI analysis",
      state: "pending",
      detail: "Starts after profiles are collected.",
    };
  else analysis = creatorAnalysisStep(list);

  const run: Run = {
    id: p.id,
    title: parent
      ? ""
      : `${handles.length} profile${handles.length === 1 ? "" : "s"}: ${handles
          .slice(0, 4)
          .map((h) => `@${h}`)
          .join(", ")}${handles.length > 4 ? "…" : ""}`,
    platform: (p.payload.platform as string) ?? null,
    createdAt: p.created_at,
    state: "pending",
    steps: [collect, analysis, creatorDraftStep(list, analysis)],
    creators: list,
    next: null,
    jobIds: [
      ...new Set([
        p.id,
        ...analyses.map((a) => a.id),
        ...drafts.map((d) => d.id),
      ]),
    ],
  };
  return parent ? run : finalize(run);
}

/** Auto-drafted outreach, counted per creator. Always present so merged runs line up step-by-step. */
function creatorDraftStep(list: RunCreator[], analysis: Step): Step {
  const label = "Draft messages";
  const queued = list.filter((c) => c.draft !== "off");
  if (!queued.length)
    return ["pending", "waiting", "running"].includes(analysis.state)
      ? {
          label,
          state: "pending",
          detail:
            "Qualified creators get drafts automatically after analysis (Settings → Auto-draft).",
        }
      : {
          label,
          state: "skipped",
          detail:
            "No drafts queued — auto-draft is off, or no creator reached the minimum score.",
        };
  const c = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const x of queued) c[x.draft as JobStatus]++;
  const parts = [
    `${c.done}/${queued.length} drafted`,
    c.running && `${c.running} running`,
    c.queued && `${c.queued} waiting`,
    c.failed && `${c.failed} failed`,
  ].filter(Boolean);
  const state: StepState = c.running
    ? "running"
    : c.queued
      ? "waiting"
      : c.failed
        ? "failed"
        : "done";
  return {
    label,
    state,
    detail: `${parts.join(" · ")}${c.done ? " — ready for your review in Message Generator" : ""}`,
    error: queued.find((x) => x.draftError)?.draftError,
  };
}

/** Analysis progress counted per creator (not per job), so it lines up with the creator list. */
function creatorAnalysisStep(list: RunCreator[]): Step {
  const queued = list.filter((c) => c.analysis !== "off");
  if (!queued.length)
    return {
      label: "AI analysis",
      state: "skipped",
      detail: "None of these creators were queued for analysis.",
    };
  const c = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const x of queued) c[x.analysis as JobStatus]++;
  const parts = [
    `${c.done}/${queued.length} analysed`,
    c.running && `${c.running} running`,
    c.queued && `${c.queued} waiting`,
    c.failed && `${c.failed} failed`,
  ].filter(Boolean);
  const state: StepState = c.running
    ? "running"
    : c.queued
      ? "waiting"
      : c.failed
        ? "failed"
        : "done";
  return {
    label: "AI analysis",
    state,
    detail: parts.join(" · "),
    error: queued.find((x) => x.analysisError)?.analysisError,
  };
}

function analysisStep(jobs: JobRow[]): Step {
  if (!jobs.length)
    return {
      label: "AI analysis",
      state: "skipped",
      detail: "No creators to analyse.",
    };
  const c = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const j of jobs) c[j.status]++;
  const err =
    jobs.find((j) => j.status !== "done" && j.last_error)?.last_error ??
    undefined;
  const parts = [
    `${c.done}/${jobs.length} analysed`,
    c.running && `${c.running} running`,
    c.queued && `${c.queued} waiting`,
    c.failed && `${c.failed} failed`,
  ].filter(Boolean);
  const state: StepState = c.running
    ? "running"
    : c.queued
      ? "waiting"
      : c.failed
        ? "failed"
        : "done";
  return { label: "AI analysis", state, detail: parts.join(" · "), error: err };
}

/** Combine the profile/analysis steps when one hashtag scan fans out into several profile jobs. */
function mergeSteps(stepLists: Step[][]): Step[] {
  if (stepLists.length === 1) return stepLists[0];
  return stepLists[0].map((_, i) => {
    const s = stepLists.map((l) => l[i]);
    const order: StepState[] = [
      "failed",
      "running",
      "waiting",
      "pending",
      "done",
      "skipped",
    ];
    const state = order.find((o) => s.some((x) => x.state === o)) ?? "done";
    return {
      label: s[0].label,
      state,
      detail: s.map((x) => x.detail).join(" | "),
      error: s.find((x) => x.error)?.error,
    };
  });
}

function manualRuns(jobs: JobRow[], creators: Map<string, RunCreator>): Run[] {
  // Group manually queued analysis/outreach jobs that were queued within the same minute.
  const groups = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const key = `${j.type}:${j.created_at.slice(0, 16)}`;
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  return [...groups.values()].map((g) => {
    const type = g[0].type;
    const step = analysisStep(g);
    if (type === "outreach") step.label = "Draft outreach";
    if (type === "send_email") {
      step.label = "Send email";
      step.detail = step.detail.replace("analysed", "sent");
    }
    const list = g
      .map((j) => {
        const c = creators.get(String(j.payload.creatorId));
        return c
          ? ({
              ...c,
              analysis: j.status,
              analysisError:
                j.status === "failed" ? (j.last_error ?? undefined) : undefined,
            } as RunCreator)
          : null;
      })
      .filter((c): c is RunCreator => !!c);
    return finalize({
      id: g[0].id,
      title: `${type === "outreach" ? "Outreach drafts" : type === "send_email" ? "Email sends" : "AI analysis"} for ${g.length} creator${g.length === 1 ? "" : "s"}`,
      platform: null,
      createdAt: g[g.length - 1].created_at,
      state: "pending",
      steps: [step],
      creators: dedupe(list),
      next: null,
      jobIds: g.map((j) => j.id),
    });
  });
}

function finalize(run: Run): Run {
  const active = run.steps.find((s) =>
    ["running", "waiting", "pending"].includes(s.state),
  );
  run.state = active
    ? active.state
    : run.steps.some((s) => s.state === "failed")
      ? "failed"
      : "done";
  const failedStep = run.steps.find((s) => s.state === "failed" || s.error);
  if (failedStep?.error && / is not set$/.test(failedStep.error))
    run.next = `${failedStep.error.replace(/ is not set$/, "")} is missing. Add it to .env.local, restart the dev server, then click “Retry failed”.`;
  else if (run.state === "failed")
    run.next =
      "Something failed — see the error above. Fix it, then click “Retry failed”.";
  else if (run.state === "done" && run.creators.some((c) => c.draft === "done"))
    run.next =
      "Drafts are ready. Review, edit and approve them in Message Generator, then send from Outreach Inbox.";
  else if (run.state === "done" && run.creators.length)
    run.next =
      "Done. Review the creators below or in Discovery, then write messages for the best ones.";
  else if (active) run.next = null;
  return run;
}

const rank = (s: JobStatus) =>
  ({ failed: 0, queued: 1, running: 2, done: 3 })[s];

function dedupe(list: RunCreator[]): RunCreator[] {
  const seen = new Map<string, RunCreator>();
  for (const c of list) {
    const prev = seen.get(c.id);
    if (!prev || (prev.analysis !== "done" && c.analysis === "done"))
      seen.set(c.id, c);
  }
  return [...seen.values()].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
