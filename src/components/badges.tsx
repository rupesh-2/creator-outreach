import { cn } from "cn";
import { STATUS_LABELS, type CreatorStatus, type Priority } from "@/lib/types";

const PRIORITY: Record<Priority, string> = {
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function PriorityBadge({ priority, score }: { priority: Priority | null; score: number | null }) {
  if (!priority) return <span className="text-xs text-muted-foreground">Unscored</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums", PRIORITY[priority])}>
      {score} · {priority}
    </span>
  );
}

const STATUS_TONE: Partial<Record<CreatorStatus, string>> = {
  interested: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  meeting_scheduled: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  partnership_discussion: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  collaborated: "bg-emerald-600 text-white",
  not_interested: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  do_not_contact: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  replied: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  pending_review: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export function StatusBadge({ status }: { status: CreatorStatus }) {
  return (
    <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_TONE[status] ?? "bg-muted text-muted-foreground")}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ConfidenceTag({ c }: { c: "measured" | "estimated" | "insufficient_data" }) {
  const map = {
    measured: ["Measured", "text-emerald-700 dark:text-emerald-400"],
    estimated: ["Estimated", "text-amber-700 dark:text-amber-400"],
    insufficient_data: ["Insufficient data", "text-red-600 dark:text-red-400"],
  } as const;
  return <span className={cn("text-[11px] font-medium uppercase tracking-wide", map[c][1])}>{map[c][0]}</span>;
}
