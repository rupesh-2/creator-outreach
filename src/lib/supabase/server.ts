import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { env } from "@/lib/env";

/** Per-request client bound to the signed-in user's session (RLS applies). */
export async function createClient() {
  // Supabase reads the clock (session expiry) and hits the network, so it must run at request time,
  // not while prerendering the App Shell (cookies() alone is available during Partial Prefetching).
  await connection();
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a Server Component; proxy.ts refreshes the session instead
        }
      },
    },
  });
}

/** Returns the client + user, or redirects to /login. Use in every page and server action. */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { supabase, user: data.user };
}
