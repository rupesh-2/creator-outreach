import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runJobs } from "@/lib/jobs/runner";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env.cronSecret()}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Runs once a day (vercel.json): stay up to ~4.5 min so short Apify waits finish in this run.
  const result = await runJobs(createAdminClient(), { budgetMs: 270_000, waitForDue: true });
  return NextResponse.json(result);
}
