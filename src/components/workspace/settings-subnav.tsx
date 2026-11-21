"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SETTINGS_TABS = [
  { href: "/app/settings", label: "General" },
  { href: "/app/settings/notifications", label: "Notifications & Push" },
] as const;

export function SettingsSubnav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings sections"
      className="mb-4 flex items-center gap-1 border-b border-border pb-2"
    >
      {SETTINGS_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "mira-row inline-flex items-center rounded-md px-2.5 text-xs transition-colors",
              active
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
