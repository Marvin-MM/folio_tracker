"use client";

import { useEffect } from "react";

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export function isInstalledPwaContext(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (window.navigator as NavigatorWithStandalone).standalone === true
  );
}

/**
 * Ensures installed PWA users never land on the public marketing page (`/`):
 * when launched or navigated to `/` in standalone mode, immediately redirects
 * to `/login` (paired with `@media (display-mode: standalone)` CSS hiding so
 * zero marketing content ever flashes).
 */
export function StandaloneRootGuard() {
  useEffect(() => {
    if (isInstalledPwaContext()) {
      window.location.replace("/login");
    }
  }, []);

  return null;
}
