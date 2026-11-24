"use client";

import { useEffect } from "react";
import { APP_NAME } from "@/lib/constants";

/**
 * Root-level fallback error boundary (catches uncaught errors in `RootLayout`).
 * Styled directly with Warm Paper tokens so recovery remains legible even if
 * theme providers or stylesheets fail to mount.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Critical root layout error:", error.digest ?? error.name);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#F9F8F6",
          color: "#171614",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "420px",
            backgroundColor: "#FFFFFF",
            border: "1px solid #E6E4DF",
            borderRadius: "8px",
            padding: "24px",
          }}
        >
          <p
            style={{
              margin: "0 0 8px 0",
              fontSize: "12px",
              fontWeight: 600,
              color: "#C24136",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {APP_NAME} · Recovery
          </p>
          <h1 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: 600 }}>
            Something interrupted the workspace
          </h1>
          <p
            style={{
              margin: "0 0 16px 0",
              fontSize: "13px",
              lineHeight: 1.5,
              color: "#6E6B64",
            }}
          >
            Your tasks, notes, and habit logs remain safely stored. Try
            reloading this view to continue.
          </p>
          {error.digest ? (
            <p
              style={{
                margin: "0 0 16px 0",
                padding: "8px 10px",
                backgroundColor: "#F9F8F6",
                border: "1px solid #E6E4DF",
                borderRadius: "6px",
                fontSize: "11px",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                color: "#6E6B64",
              }}
            >
              Reference · {error.digest}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                flex: 1,
                minHeight: "36px",
                borderRadius: "6px",
                border: "1px solid #171614",
                backgroundColor: "#171614",
                color: "#F9F8F6",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/app/inbox"
              style={{
                flex: 1,
                minHeight: "36px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "6px",
                border: "1px solid #E6E4DF",
                backgroundColor: "#FFFFFF",
                color: "#171614",
                fontSize: "13px",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Go to Inbox
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
