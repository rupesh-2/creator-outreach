"use client";

import { Loader2, Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type Tick = () => Promise<{ processed: number; failed: number; waiting: number }>;

/**
 * While this page is open and work is pending, keeps the queue moving (short server runs every ~10s)
 * and refreshes the page so progress is visible without clicking anything.
 */
export function QueueLive({ pending, tick }: { pending: number; tick: Tick }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (paused) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop) return;
      if (pendingRef.current > 0) {
        setBusy(true);
        try {
          const r = await tick();
          const parts = [r.processed && `${r.processed} finished`, r.waiting && `${r.waiting} waiting (Apify or LLM quota)`, r.failed && `${r.failed} failed`].filter(Boolean);
          setLast(`${new Date().toLocaleTimeString()} — ${parts.length ? parts.join(", ") : "nothing ready yet"}`);
        } catch (e) {
          setLast(`Queue run failed: ${(e as Error).message}`);
        } finally {
          setBusy(false);
        }
        startTransition(() => router.refresh());
      }
      timer = setTimeout(loop, 10_000);
    };
    loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [paused, tick, router]);

  const toggle = () => setPaused((p) => !p);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
      <span className="flex items-center gap-2 font-medium">
        {paused ? (
          <span className="size-2 rounded-full bg-muted-foreground" />
        ) : busy ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : (
          <span className={`size-2 rounded-full ${pending ? "animate-pulse bg-emerald-500" : "bg-emerald-500"}`} />
        )}
        {paused ? "Auto-run paused" : pending ? (busy ? "Running queue…" : "Auto-running queue") : "Queue idle — nothing pending"}
      </span>
      <span className="text-xs text-muted-foreground">
        {paused ? "Jobs only run when you click “Process queue now” (or the daily cron in production)." : last ?? "Checks every 10 seconds while this page is open."}
      </span>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={toggle}>
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        {paused ? "Resume" : "Pause"}
      </Button>
    </div>
  );
}
