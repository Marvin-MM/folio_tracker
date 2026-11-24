/**
 * Phase C seed prompts for the day-page journal.
 * Review templates (Phase E) can later override this list without changing
 * the stored prompt id/text shape.
 */
export interface ReviewPrompt {
  id: string;
  text: string;
}

export const REVIEW_PROMPTS: readonly ReviewPrompt[] = [
  { id: "seed:win", text: "What went well today, even if it was small?" },
  { id: "seed:friction", text: "What created the most friction today?" },
  { id: "seed:energy", text: "Where did your energy rise or fall today?" },
  { id: "seed:tomorrow", text: "What is one thing you would do differently tomorrow?" },
  { id: "seed:gratitude", text: "What are you grateful for from today?" },
] as const;
