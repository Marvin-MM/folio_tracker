import type { ReactNode } from "react";
import Link from "next/link";
import { Compass, LayoutGrid, LogIn } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface PublicChromeProps {
  children: ReactNode;
  activeNav?: "explore" | "operation" | "profile";
  isAuthenticated: boolean;
  callbackPath?: string;
}

export function PublicChrome({
  children,
  activeNav,
  isAuthenticated,
  callbackPath = "/explore",
}: PublicChromeProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-xs">
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex items-center gap-4">
            <Link
              href={isAuthenticated ? "/app/operations" : "/"}
              className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
            >
              <BrandMark />
              <span>{APP_NAME}</span>
            </Link>

            <nav aria-label="Public navigation" className="flex items-center gap-1">
              <Link
                href="/explore"
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors md:h-7",
                  activeNav === "explore"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <Compass className="size-3.5" />
                Explore
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            {isAuthenticated ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 px-3 text-xs md:h-7"
              >
                <Link href="/app/operations">
                  <LayoutGrid className="size-3.5" />
                  Open Workspace
                </Link>
              </Button>
            ) : (
              <Button
                asChild
                size="sm"
                className="h-9 gap-1.5 px-3 text-xs md:h-7"
              >
                <Link
                  href={`/login?callbackURL=${encodeURIComponent(callbackPath)}`}
                >
                  <LogIn className="size-3.5" />
                  Sign in
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-card/40 px-4 py-4 text-center text-[11px] text-muted-foreground">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <span>{APP_NAME} · Universal Operation Blueprints</span>
          <div className="flex items-center gap-3">
            <Link href="/explore" className="hover:text-foreground">
              Explore Directory
            </Link>
            <Link
              href={isAuthenticated ? "/app/operations" : "/login"}
              className="hover:text-foreground"
            >
              {isAuthenticated ? "My Operations" : "Sign in"}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
