import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/constants";

export const alt =
  "Folio — Calm personal tasks, quiet notes, durable reminders, and honest habits";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#F9F8F6",
          color: "#171614",
          padding: "56px 64px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #E6E4DF",
            paddingBottom: "24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "8px",
                backgroundColor: "#171614",
                color: "#F9F8F6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
                fontWeight: 700,
              }}
            >
              F
            </div>
            <span
              style={{
                fontSize: "24px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              {APP_NAME}
            </span>
          </div>
          <div
            style={{
              fontSize: "15px",
              color: "#6E6B64",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            WARM PAPER · CARBON INK
          </div>
        </div>

        {/* Editorial Headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            maxWidth: "960px",
          }}
        >
          <div
            style={{
              fontSize: "62px",
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              color: "#171614",
            }}
          >
            Tasks, quiet notes, and honest habits — in one calm sheet.
          </div>
          <div
            style={{
              fontSize: "24px",
              lineHeight: 1.4,
              color: "#6E6B64",
              maxWidth: "820px",
            }}
          >
            Natural-language quick capture, durable multi-channel reminders,
            shared projects with RBAC, and an Accountability Circle.
          </div>
        </div>

        {/* Bottom capability strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #E6E4DF",
            paddingTop: "24px",
          }}
        >
          <div style={{ display: "flex", gap: "12px" }}>
            {[
              { label: "Tasks & Quick Capture", color: "#171614" },
              { label: "Durable Reminders", color: "#B4690E" },
              { label: "Real-Calendar Habits", color: "#2E7D5B" },
              { label: "Shared Projects & Circle", color: "#3B5B8A" },
            ].map((pill) => (
              <div
                key={pill.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "1px solid #E6E4DF",
                  backgroundColor: "#FFFFFF",
                  fontSize: "16px",
                  fontWeight: 500,
                  color: "#171614",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "9999px",
                    backgroundColor: pill.color,
                  }}
                />
                <span>{pill.label}</span>
              </div>
            ))}
          </div>
          <span
            style={{
              fontSize: "16px",
              color: "#6E6B64",
            }}
          >
            folio.renult.xyz
          </span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
