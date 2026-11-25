"use client";

import { CalendarClock } from "lucide-react";
import { useSyncExternalStore } from "react";

/** Daily queue run, matching vercel.json ("0 9 * * *" = 09:00 UTC). */
const CRON_UTC_HOUR = 9;

function nextRun(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_UTC_HOUR));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// Render the time in the viewer's own timezone; the server render shows UTC until hydration.
const subscribe = () => () => {};
const localLabel = () => nextRun().toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const serverLabel = () => `${nextRun().toISOString().slice(11, 16)} UTC`;

/** Explains when queued work runs. No polling: the queue runs once a day, or on demand via "Process queue now". */
export function QueueSchedule({ pending }: { pending: number }) {
  const when = useSyncExternalStore(subscribe, localLabel, serverLabel);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
      <CalendarClock className="size-4 text-muted-foreground" />
      <span className="font-medium">{pending ? `${pending} job${pending === 1 ? "" : "s"} waiting` : "Queue idle — nothing pending"}</span>
      <span className="text-xs text-muted-foreground">
        The queue runs automatically once a day (next: {when}). Click “Process queue now” to run it immediately. Approved emails don’t wait —
        they send about 30 seconds after you approve them.
      </span>
    </div>
  );
}
