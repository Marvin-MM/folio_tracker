import { describe, expect, it } from "vitest";
import { getJournalPromptForDate } from "@/server/domain/journal-prompts";
import { REVIEW_PROMPTS } from "@/server/domain/review-prompts";

describe("journal prompt rotation", () => {
  it("maps a date to a stable prompt from the seeded list", () => {
    const first = getJournalPromptForDate("2026-11-24", REVIEW_PROMPTS);
    const again = getJournalPromptForDate("2026-11-24", REVIEW_PROMPTS);
    expect(first).not.toBeNull();
    expect(again?.id).toBe(first?.id);
    expect(REVIEW_PROMPTS.some((prompt) => prompt.id === first?.id)).toBe(true);
  });

  it("rotates across consecutive days and wraps around", () => {
    const ids = Array.from({ length: REVIEW_PROMPTS.length + 1 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 10, 1 + index))
        .toISOString()
        .slice(0, 10);
      return getJournalPromptForDate(date, REVIEW_PROMPTS)?.id;
    });
    expect(new Set(ids.slice(0, REVIEW_PROMPTS.length)).size).toBe(
      REVIEW_PROMPTS.length
    );
    expect(ids[REVIEW_PROMPTS.length]).toBe(ids[0]);
  });

  it("handles empty lists and malformed dates", () => {
    expect(getJournalPromptForDate("2026-11-24", [])).toBeNull();
    expect(getJournalPromptForDate("not-a-date", REVIEW_PROMPTS)?.id).toBe(
      REVIEW_PROMPTS[0]?.id
    );
  });
});
