import { isServer, QueryClient } from "@tanstack/react-query";

export const WORKSPACE_STALE_TIME_MS = 60_000; // 1 minute instant revisits
export const WORKSPACE_GC_TIME_MS = 10 * 60_000; // 10 minutes in-memory retention

export class WorkspaceHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceHttpError";
  }
}

export function shouldRetryWorkspaceQuery(
  failureCount: number,
  error: unknown
): boolean {
  if (error instanceof WorkspaceHttpError) {
    if (
      error.status === 400 ||
      error.status === 401 ||
      error.status === 403 ||
      error.status === 404
    ) {
      return false;
    }
  }
  return failureCount < 2;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: WORKSPACE_STALE_TIME_MS,
        gcTime: WORKSPACE_GC_TIME_MS,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: shouldRetryWorkspaceQuery,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getBrowserQueryClient(): QueryClient {
  if (isServer) {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

export function clearBrowserQueryClient(): void {
  if (browserQueryClient) {
    browserQueryClient.clear();
  }
}

export async function fetchWorkspaceJson<T>(
  url: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    let code = "HTTP_ERROR";
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      if (payload?.error?.code) code = payload.error.code;
      if (payload?.error?.message) message = payload.error.message;
    } catch {
      // Fall back to HTTP status text
    }
    throw new WorkspaceHttpError(response.status, code, message);
  }

  return (await response.json()) as T;
}
