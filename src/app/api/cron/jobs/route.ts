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
  const result = await runJobs(createAdminClient(), { budgetMs: 240_000 });
  return NextResponse.json(result);
}
