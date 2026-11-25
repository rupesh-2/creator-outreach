import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refreshes the Supabase session cookie and does an optimistic redirect to /login. Real auth checks live in requireUser(). */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = ["/login", "/forgot-password", "/auth/", "/unsubscribe", "/api/"].some((p) => path.startsWith(p));
  // Only redirect page navigations. Server actions (POST + Next-Action header) must reach the action, whose
  // requireUser() redirects in a way the client router understands; a proxy 307 to /login is followed by fetch
  // and surfaces as "An unexpected response was received from the server".
  const isPageNavigation = request.method === "GET" && !request.headers.has("next-action");
  if (!data.user && !isPublic && isPageNavigation) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    // Keep any cookie changes (refreshed or cleared session) from getUser().
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
