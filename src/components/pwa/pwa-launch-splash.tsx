"use client";

import { useEffect, useState } from "react";
import { isInstalledPwaContext } from "@/components/landing/standalone-root-guard";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

const SPLASH_SESSION_KEY = "folio_pwa_splash_shown";

/**
 * Branded Warm Paper / Carbon Ink launch splash screen that displays ONCE per
 * cold launch of the installed PWA (`display-mode: standalone` / iOS standalone).
 *
 * - Never renders on normal browser visits or search crawlers (zero LCP/SEO impact).
 * - Respects `prefers-reduced-motion: reduce`.
 */
export function PwaLaunchSplash() {
  const [phase, setPhase] = useState<"hidden" | "visible" | "fading">("hidden");

  useEffect(() => {
    if (!isInstalledPwaContext()) {
      return;
    }

    try {
      if (window.sessionStorage.getItem(SPLASH_SESSION_KEY) === "1") {
        return;
      }
      window.sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
    } catch {
      // sessionStorage may be restricted; still show once on initial mount
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const showTimer = window.setTimeout(() => {
      setPhase("visible");
    }, 0);

    const fadeDelay = reducedMotion ? 160 : 520;
    const hideDelay = reducedMotion ? 200 : 760;

    const fadeTimer = window.setTimeout(() => {
      setPhase("fading");
    }, fadeDelay);

    const hideTimer = window.setTimeout(() => {
      setPhase("hidden");
    }, hideDelay);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (phase === "hidden") {
    return null;
  }

  return (
    <div
      role="status"
      aria-label={`Launching ${APP_NAME}`}
      data-pwa-splash={phase}
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background text-foreground transition-opacity duration-200",
        phase === "fading" ? "pointer-events-none opacity-0" : "opacity-100"
      )}
    >
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <div
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-xl border border-border bg-primary text-primary-foreground"
        >
          <span className="text-2xl font-bold tracking-tight">F</span>
        </div>

        <div className="space-y-1">
          <p className="text-base font-semibold tracking-tight text-foreground">
            {APP_NAME}
          </p>
          <p className="text-xs text-muted-foreground">
            Calm personal &amp; shared productivity
          </p>
        </div>

        <div
          aria-hidden="true"
          className="mt-1 h-[2px] w-28 overflow-hidden rounded-full bg-border"
        >
          <div className="folio-splash-bar h-full w-full bg-foreground" />
        </div>
      </div>
    </div>
  );
}
