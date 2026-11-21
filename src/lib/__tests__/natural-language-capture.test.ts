import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it } from "vitest";
import { parseQuickCapture } from "@/lib/natural-language-capture";

describe("parseQuickCapture (chrono-node + IANA timezone)", () => {
  // Reference: Sat 2026-11-21 14:00:00 UTC (17:00 EAT in Africa/Kampala)
  const referenceNow = new Date(Date.UTC(2026, 10, 21, 14, 0, 0));

  it("extracts natural-language time for tasks in the user's IANA timezone", () => {
    const parsed = parseQuickCapture(
      "Pay Umeme bill tomorrow 9am",
      "Africa/Kampala",
      { referenceNow }
    );

    expect(parsed.kind).toBe("task");
    expect(parsed.cleanTitle).toBe("Pay Umeme bill");
    expect(parsed.detectedPhrase?.toLowerCase()).toContain("tomorrow");
    expect(parsed.detectedRange).not.toBeNull();
    expect(parsed.remindAtUtcMs).not.toBeNull();

    // Tomorrow in Africa/Kampala is 2026-11-22 09:00 EAT === 2026-11-22 06:00 UTC
    const localFormatted = formatInTimeZone(
      parsed.remindAtUtcMs!,
      "Africa/Kampala",
      "yyyy-MM-dd HH:mm"
    );
    expect(localFormatted).toBe("2026-11-22 09:00");
    expect(new Date(parsed.remindAtUtcMs!).toISOString()).toBe(
      "2026-11-22T06:00:00.000Z"
    );
  });

  it("switches to note mode on n: prefix and extracts reminder date", () => {
    const parsed = parseQuickCapture(
      "n: Renewal code for fiber router tomorrow 10:30am",
      "America/New_York",
      { referenceNow }
    );

    expect(parsed.kind).toBe("note");
    expect(parsed.cleanTitle).toBe("Renewal code for fiber router");
    expect(parsed.remindAtUtcMs).not.toBeNull();

    const localFormatted = formatInTimeZone(
      parsed.remindAtUtcMs!,
      "America/New_York",
      "yyyy-MM-dd HH:mm"
    );
    expect(localFormatted).toBe("2026-11-22 10:30");
  });

  it("keeps plain tasks and plain notes quiet when no temporal phrase is present", () => {
    const plainTask = parseQuickCapture("Draft Q1 roadmap outline", "UTC", {
      referenceNow,
    });
    expect(plainTask.kind).toBe("task");
    expect(plainTask.cleanTitle).toBe("Draft Q1 roadmap outline");
    expect(plainTask.detectedPhrase).toBeNull();
    expect(plainTask.remindAtUtcMs).toBeNull();

    const plainNote = parseQuickCapture("n: Meeting notes from design sync", "UTC", {
      referenceNow,
    });
    expect(plainNote.kind).toBe("note");
    expect(plainNote.cleanTitle).toBe("Meeting notes from design sync");
    expect(plainNote.remindAtUtcMs).toBeNull();
  });

  it("respects explicit defaultKind toggle override when no prefix is typed", () => {
    const parsed = parseQuickCapture("Architecture ideas", "UTC", {
      defaultKind: "note",
      referenceNow,
    });

    expect(parsed.kind).toBe("note");
    expect(parsed.cleanTitle).toBe("Architecture ideas");
  });
});
