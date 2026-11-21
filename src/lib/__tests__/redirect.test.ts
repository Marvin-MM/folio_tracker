import { describe, expect, it } from "vitest";
import { sanitizeCallbackUrl } from "@/lib/redirect";

describe("sanitizeCallbackUrl (open-redirect defense)", () => {
  it("allows valid relative app paths with query params and hashes", () => {
    expect(sanitizeCallbackUrl("/app/inbox")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("/app/today?filter=overdue#item-1")).toBe(
      "/app/today?filter=overdue#item-1"
    );
    expect(sanitizeCallbackUrl("/app/settings")).toBe("/app/settings");
    expect(sanitizeCallbackUrl("  /app/notes  ")).toBe("/app/notes");
  });

  it("falls back to default path for empty, null, or undefined values", () => {
    expect(sanitizeCallbackUrl(null)).toBe("/app/inbox");
    expect(sanitizeCallbackUrl(undefined)).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("   ")).toBe("/app/inbox");
  });

  it("rejects absolute external URLs", () => {
    expect(sanitizeCallbackUrl("https://evil.com/phish")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("http://evil.com")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("ftp://evil.com/file")).toBe("/app/inbox");
  });

  it("rejects protocol-relative and backslash bypass attempts", () => {
    expect(sanitizeCallbackUrl("//evil.com")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("//evil.com/app/inbox")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("/\\evil.com")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("/app\\..\\evil")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("/%2f/evil.com")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("/%5cevil.com")).toBe("/app/inbox");
  });

  it("rejects dangerous URI schemes and control characters", () => {
    expect(sanitizeCallbackUrl("javascript:alert(1)")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("data:text/html,<script>alert(1)</script>")).toBe(
      "/app/inbox"
    );
    expect(sanitizeCallbackUrl("/app/inbox\r\nSet-Cookie: evil=1")).toBe(
      "/app/inbox"
    );
  });

  it("prevents auth route redirect loops", () => {
    expect(sanitizeCallbackUrl("/login")).toBe("/app/inbox");
    expect(sanitizeCallbackUrl("/register?callbackURL=/app/today")).toBe(
      "/app/inbox"
    );
    expect(sanitizeCallbackUrl("/reset-password?token=abc")).toBe("/app/inbox");
  });

  it("respects custom fallback paths", () => {
    expect(sanitizeCallbackUrl("https://evil.com", "/app/today")).toBe(
      "/app/today"
    );
  });
});
