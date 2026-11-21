"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const handleToggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  if (compact) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleToggle}
        aria-label="Toggle color theme"
        title="Switch Warm Paper / Carbon Ink"
        className={cn("mira-icon-btn shrink-0 text-muted-foreground hover:text-foreground", className)}
      >
        <Sun className="size-4 dark:hidden" />
        <Moon className="hidden size-4 dark:block" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      aria-label="Toggle color theme"
      className={cn(
        "mira-row w-full justify-start gap-2 px-2 text-xs font-normal text-muted-foreground hover:text-foreground",
        className
      )}
    >
      <Sun className="size-3.5 shrink-0 dark:hidden" />
      <Moon className="hidden size-3.5 shrink-0 dark:block" />
      <span className="dark:hidden">Warm Paper</span>
      <span className="hidden dark:inline">Carbon Ink</span>
    </Button>
  );
}
