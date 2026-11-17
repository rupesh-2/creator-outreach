"use client";

import { Activity, BarChart3, Bell, Brain, Inbox, KanbanSquare, LayoutDashboard, MessageSquareText, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/discovery", label: "Discovery", icon: Search },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/analysis", label: "AI Analysis", icon: Brain },
  { href: "/messages", label: "Message Generator", icon: MessageSquareText },
  { href: "/inbox", label: "Outreach Inbox", icon: Inbox },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/follow-ups", label: "Follow-ups", icon: Bell },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

type Counts = { review: number; followUps: number; jobs: number };

export function AppNav({ counts }: { counts: Counts }) {
  return <NavLinks path={usePathname()} counts={counts} />;
}

/** Hook-free so it can render in a prerendered Suspense fallback (path = null → nothing active). */
export function NavLinks({ path, counts }: { path: string | null; counts: Counts }) {
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = !!path && (href === "/" ? path === "/" : path.startsWith(href) || (href === "/discovery" && path.startsWith("/creators")));
        const badge = href === "/messages" ? counts.review : href === "/follow-ups" ? counts.followUps : href === "/activity" ? counts.jobs : 0;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1">{label}</span>
            {badge > 0 && (
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-primary-foreground/20" : "bg-muted-foreground/15")}>
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
