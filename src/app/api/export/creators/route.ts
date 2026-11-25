import Papa from "papaparse";
import type { NextRequest } from "next/server";
import { creatorQuery } from "@/lib/services/creator-query";
import { createClient } from "@/lib/supabase/server";

const COLUMNS =
  "platform,handle,profile_url,display_name,country,language,followers,following,median_views,avg_views,engagement_rate,posts_last_30d,last_posted_at,business_email,niche,score,priority,status,last_contacted_at,follow_up_at,data_source,source_ref,collected_at,notes";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Unauthorized", { status: 401 });
  const f = Object.fromEntries(req.nextUrl.searchParams);
  const { data: s } = await supabase.from("settings").select("target_countries").eq("owner_id", auth.user.id).maybeSingle();
  const { data, error } = await creatorQuery(supabase, f, COLUMNS, s?.target_countries ?? []).limit(10000);
  if (error) return new Response(error.message, { status: 500 });
  const csv = Papa.unparse((data ?? []) as unknown as Record<string, unknown>[], { columns: COLUMNS.split(",") });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="creators-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
