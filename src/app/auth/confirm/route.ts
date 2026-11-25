import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for Supabase email links (password recovery, signup confirmation).
 * Handles both the token_hash flow and the PKCE `code` flow, signs the user in, then forwards to `next`.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get("next");
  const dest = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  const supabase = await createClient();

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  let error: { message: string } | null = null;
  if (tokenHash && type) ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  else if (code) ({ error } = await supabase.auth.exchangeCodeForSession(code));
  else error = { message: "missing token" };

  if (error) return NextResponse.redirect(new URL(`/forgot-password?error=${encodeURIComponent("That link is invalid or has expired. Request a new one.")}`, url));
  return NextResponse.redirect(new URL(type === "recovery" || dest === "/reset-password" ? "/reset-password" : dest, url));
}
