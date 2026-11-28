import { describe, expect, it } from "vitest";
import { isAllowedWebPushEndpoint } from "@/lib/web-push-endpoint";

describe("isAllowedWebPushEndpoint — anti-SSRF validation", () => {
  it("accepts trusted HTTPS browser push service endpoints", () => {
    expect(
      isAllowedWebPushEndpoint(
        "https://fcm.googleapis.com/fcm/send/fXk2a8:APA91bExample"
      )
    ).toBe(true);
    expect(
      isAllowedWebPushEndpoint(
        "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAExample"
      )
    ).toBe(true);
    expect(
      isAllowedWebPushEndpoint(
        "https://web.push.apple.com/QExampleToken123"
      )
    ).toBe(true);
    expect(
      isAllowedWebPushEndpoint(
        "https://wns2-bl2p.notify.windows.com/?token=Example"
      )
    ).toBe(true);
  });

  it("rejects HTTP, localhost, cloud metadata IPs, IPv6, credentials, and untrusted hosts", () => {
    const blocked = [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://localhost/push",
      "https://127.0.0.1/push",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/push",
      "https://internal.service.local/webhook",
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://evil-fcm.googleapis.com.attacker.example/send",
      "https://user:pass@fcm.googleapis.com/fcm/send/abc",
      "https://attacker.example.com/ssrf",
      "not-a-url",
    ];

    for (const url of blocked) {
      expect(isAllowedWebPushEndpoint(url), `expected rejected: ${url}`).toBe(
        false
      );
    }
  });
});
