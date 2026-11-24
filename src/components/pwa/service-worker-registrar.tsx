"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js` globally once the page is idle so installed PWAs and
 * browsers receive offline navigation fallback and Web Push readiness without
 * requiring users to visit `/app/settings/notifications` first.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !window.isSecureContext
    ) {
      return;
    }

    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          // Ignore registration errors in restricted or private browser modes
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
