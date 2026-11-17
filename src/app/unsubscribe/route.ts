import type { NextRequest } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/outreach/unsubscribe";
import { addToDoNotContact } from "@/lib/services/crm";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Creator } from "@/lib/types";

const page = (body: string, status = 200) =>
  new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#111;background:#fff}
button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #111;background:#111;color:#fff;cursor:pointer}
@media(prefers-color-scheme:dark){body{background:#0a0a0a;color:#eee}button{background:#eee;color:#111}}</style></head><body>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

async function unsubscribe(token: string | null) {
  const t = token ? verifyUnsubscribeToken(token) : null;
  if (!t) return false;
  const db = createAdminClient();
  const { data: c } = await db.from("creators").select("*").eq("id", t.creatorId).eq("owner_id", t.ownerId).maybeSingle<Creator>();
  if (c) await addToDoNotContact(db, t.ownerId, { ...c, business_email: t.email }, "Unsubscribed via email link");
  else {
    const { error } = await db.from("do_not_contact").insert({ owner_id: t.ownerId, email: t.email, reason: "Unsubscribed via email link" });
    if (error && error.code !== "23505") throw error;
  }
  return true;
}

// GET shows a confirmation (link scanners must not unsubscribe people on prefetch).
export function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  if (!token || !verifyUnsubscribeToken(token)) return page("<h1>Invalid link</h1><p>This unsubscribe link is invalid or incomplete.</p>", 400);
  return page(
    `<h1>Unsubscribe</h1><p>Click below and you won't receive any more emails from me.</p>
<form method="post"><input type="hidden" name="t" value="${token.replace(/[^A-Za-z0-9._-]/g, "")}"><button>Unsubscribe</button></form>`,
  );
}

// POST handles both the confirmation form and RFC 8058 one-click (List-Unsubscribe-Post).
export async function POST(req: NextRequest) {
  let token = req.nextUrl.searchParams.get("t");
  if (!token) {
    const fd = await req.formData().catch(() => null);
    token = (fd?.get("t") as string | null) ?? null;
  }
  const ok = await unsubscribe(token);
  return ok ? page("<h1>Done</h1><p>You've been unsubscribed and won't hear from me again. Sorry for the bother.</p>") : page("<h1>Invalid link</h1>", 400);
}
