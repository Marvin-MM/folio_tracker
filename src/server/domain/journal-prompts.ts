import type { ReviewPrompt } from "@/server/domain/review-prompts";

/** Pure date-based rotation: every calendar day maps to one stable prompt. */
export function getJournalPromptForDate(
  dateKey: string,
  prompts: readonly ReviewPrompt[]
): ReviewPrompt | null {
  if (prompts.length === 0) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return prompts[0] ?? null;

  const utcDay = Date.UTC(year, month - 1, day) / 86_400_000;
  const index = ((utcDay % prompts.length) + prompts.length) % prompts.length;
  return prompts[index] ?? prompts[0] ?? null;
}
