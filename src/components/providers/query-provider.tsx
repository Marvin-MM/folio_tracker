"use client";

import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { getBrowserQueryClient } from "@/lib/query/query-client";
import { useWorkspaceUIStore } from "@/stores/workspace-ui-store";

interface WorkspaceQueryProviderProps {
  children: React.ReactNode;
}

/**
 * Mounts the shared TanStack Query v5 client for `/app/*`, safely rehydrates
 * non-PII Zustand layout preferences after client mount (preventing SSR
 * hydration mismatches), and tracks live browser online/offline status.
 */
export function WorkspaceQueryProvider({
  children,
}: WorkspaceQueryProviderProps) {
  const [queryClient] = useState(() => getBrowserQueryClient());

  useEffect(() => {
    void useWorkspaceUIStore.persist?.rehydrate();

    const syncOnline = () => {
      useWorkspaceUIStore.getState().setIsOnline(navigator.onLine);
    };

    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);

    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      ) : null}
    </QueryClientProvider>
  );
}
