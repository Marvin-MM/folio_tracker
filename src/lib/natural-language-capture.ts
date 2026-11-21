import * as chrono from "chrono-node";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export type CaptureEntityKind = "task" | "note";

export interface ParsedQuickCapture {
  kind: CaptureEntityKind;
  rawText: string;
  bodyText: string;
  cleanTitle: string;
  detectedPhrase: string | null;
  /** Span indices inside `bodyText` (after optional `n:` / `t:` prefix) */
  detectedRange: { start: number; end: number } | null;
  remindAtUtcMs: number | null;
  hasExplicitTime: boolean;
}

const NOTE_PREFIX_RE = /^(?:n|note)\s*:\s*/i;
const TASK_PREFIX_RE = /^(?:t|task)\s*:\s*/i;

function safeTimezone(timezone: string): string {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

function stripDetectedPhrase(
  source: string,
  start: number,
  end: number
): string {
  const before = source.slice(0, start).replace(/\s+(?:at|on|by|for|in)$/i, "");
  const after = source.slice(end).replace(/^\s*[,;-]\s*/, " ");
  const joined = `${before} ${after}`.replace(/\s+/g, " ").trim();
  return joined || source.trim();
}

/**
 * Pure natural-language parser for Global Quick Capture (`⌘K`).
 *
 * - Supports `n:` / `note:` prefix to switch into Note capture mode (or caller-supplied override).
 * - Evaluates relative expressions (`tomorrow 9am`, `next friday 2:30pm`, `in 30 minutes`)
 *   strictly in the user's IANA timezone and returns an exact UTC epoch ms timestamp.
 */
export function parseQuickCapture(
  rawInput: string,
  timezone: string,
  options: {
    defaultKind?: CaptureEntityKind;
    referenceNow?: Date;
  } = {}
): ParsedQuickCapture {
  const tz = safeTimezone(timezone);
  const referenceNow = options.referenceNow ?? new Date();

  let kind: CaptureEntityKind = options.defaultKind ?? "task";
  let bodyText = rawInput;

  const noteMatch = NOTE_PREFIX_RE.exec(rawInput);
  if (noteMatch) {
    kind = "note";
    bodyText = rawInput.slice(noteMatch[0].length);
  } else {
    const taskMatch = TASK_PREFIX_RE.exec(rawInput);
    if (taskMatch) {
      kind = "task";
      bodyText = rawInput.slice(taskMatch[0].length);
    }
  }

  const trimmedBody = bodyText.trim();
  if (!trimmedBody) {
    return {
      kind,
      rawText: rawInput,
      bodyText,
      cleanTitle: "",
      detectedPhrase: null,
      detectedRange: null,
      remindAtUtcMs: null,
      hasExplicitTime: false,
    };
  }

  // Anchor chrono in the user's wall-clock local time so "today", "tomorrow", "9am", etc.
  // resolve in the user's IANA timezone regardless of server/browser offset differences.
  const zonedReference = toZonedTime(referenceNow, tz);
  const results = chrono.parse(bodyText, zonedReference, { forwardDate: true });

  if (results.length === 0) {
    return {
      kind,
      rawText: rawInput,
      bodyText,
      cleanTitle: trimmedBody,
      detectedPhrase: null,
      detectedRange: null,
      remindAtUtcMs: null,
      hasExplicitTime: false,
    };
  }

  const first = results[0]!;
  const hasExplicitTime =
    first.start.isCertain("hour") || first.start.isCertain("minute");

  // Default bare dates (e.g., "tomorrow" without time) to 9:00 AM local time
  const year = first.start.get("year") ?? zonedReference.getFullYear();
  const month = first.start.get("month") ?? zonedReference.getMonth() + 1;
  const day = first.start.get("day") ?? zonedReference.getDate();
  const hour = hasExplicitTime ? (first.start.get("hour") ?? 9) : 9;
  const minute = hasExplicitTime ? (first.start.get("minute") ?? 0) : 0;
  const second = first.start.isCertain("second")
    ? (first.start.get("second") ?? 0)
    : 0;

  let utcMs: number;
  if (first.start.isCertain("timezoneOffset")) {
    // Explicit timezone offset written in text (e.g., "9am UTC")
    utcMs = first.start.date().getTime();
  } else {
    const wallClock = new Date(year, month - 1, day, hour, minute, second, 0);
    utcMs = fromZonedTime(wallClock, tz).getTime();
  }

  const start = first.index;
  const end = first.index + first.text.length;
  const cleanTitle = stripDetectedPhrase(bodyText, start, end);

  return {
    kind,
    rawText: rawInput,
    bodyText,
    cleanTitle,
    detectedPhrase: first.text,
    detectedRange: { start, end },
    remindAtUtcMs: Number.isNaN(utcMs) ? null : utcMs,
    hasExplicitTime,
  };
}
