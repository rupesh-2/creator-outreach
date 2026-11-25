"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function signIn(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  const mode = String(fd.get("mode") ?? "signin");
  const { error } =
    mode === "signup" ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  if (mode === "signup") {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return { ok: true, message: "Check your inbox to confirm your email, then sign in." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Sends a password reset email. The link lands on /auth/confirm (token_hash flow), which signs the user in
 * and forwards to /reset-password. Always reports success so it can't be used to probe which emails exist.
 */
export async function requestPasswordReset(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get("email") ?? "").trim();
  if (!email) return { ok: false, message: "Enter your email." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env.appUrl()}/auth/confirm?next=/reset-password` });
  if (error && /rate limit/i.test(error.message)) return { ok: false, message: "Too many reset emails were sent recently. Try again in an hour." };
  return { ok: true, message: "If that email has an account, a reset link is on its way. Check your inbox (and spam)." };
}

export async function updatePassword(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) return { ok: false, message: "Use at least 8 characters." };
  if (password !== String(fd.get("confirm") ?? "")) return { ok: false, message: "The two passwords don't match." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, message: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: error.message };
  redirect("/");
}
