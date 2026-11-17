import { LogOut } from "lucide-react";
import { Suspense } from "react";
import { AppNav, NavLinks } from "@/components/app-nav";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/supabase/server";
import { signOut } from "../login/actions";

// AI generation runs inside server actions on these pages.
export const maxDuration = 300;

/** Static shell; everything that reads the session streams in behind Suspense. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b bg-muted/30 p-3 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="mb-4 hidden px-3 pt-2 md:block">
          <div className="text-sm font-semibold">Creator Outreach</div>
          <Suspense fallback={<div className="h-4" />}>
            <UserEmail />
          </Suspense>
        </div>
        <Suspense fallback={<NavLinks path={null} counts={{ review: 0, followUps: 0, jobs: 0 }} />}>
          <NavWithCounts />
        </Suspense>
        <form action={signOut} className="mt-4 hidden md:block">
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
            <LogOut className="size-4" /> Sign out
          </Button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}

async function UserEmail() {
  const { user } = await requireUser();
  return <div className="truncate text-xs text-muted-foreground">{user.email}</div>;
}

async function NavWithCounts() {
  const { supabase } = await requireUser();
  const today = new Date().toISOString().slice(0, 10);
  const [{ count: review }, { count: followUps }, { count: jobs }] = await Promise.all([
    supabase.from("creators").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    supabase
      .from("creators")
      .select("id", { count: "exact", head: true })
      .lte("follow_up_at", today)
      .in("status", ["contacted", "replied", "interested", "meeting_scheduled", "partnership_discussion"]),
    supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]),
  ]);
  return <AppNav counts={{ review: review ?? 0, followUps: followUps ?? 0, jobs: jobs ?? 0 }} />;
}
