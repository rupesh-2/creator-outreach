"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
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
