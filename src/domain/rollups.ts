/**
 * Phase C — computed rollups.
 *
 * Every selector in this module is pure with respect to its arguments and is
 * memoized per partition (month/week) by a caller-supplied version counter.
 * Nothing here writes derived values back to the database.
 *
 * The current server schema has no numeric log values and no money module, so
 * `goalTotal`, hours and spending selectors accept adapter arrays. The habit
 * service passes empty arrays today; the selectors are ready for a future
 * module without changing the existing data shapes.
 */

export type RollupLogStatus = "done" | "missed" | "skipped";

export interface RollupHabitLog {
  habitId: string;
  dateKey: string;
  status: RollupLogStatus;
  loggedAt?: number;
}

export type RollupValueKind =
  | "goal"
  | "hours"
  | "expense"
  | "repayment"
  | "principal";

export interface RollupValueEvent {
  dateKey: string;
  kind: RollupValueKind;
  value: number;
  habitId?: string;
  loggedAt?: number;
}

export interface DateRange {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
}

interface PartitionedSelectorInput {
  partitionKey: string;
  version: number;
}

const MAX_CACHE_ENTRIES = 128;

interface CacheEntry<T> {
  version: number;
  value: T;
}

/**
 * Creates a small per-partition memoized selector. A changed version recomputes
 * only that partition; all other partitions keep their cached result.
 */
export function createPartitionedSelector<
  TInput extends PartitionedSelectorInput,
  TOutput,
>(
  compute: (input: TInput) => TOutput
): (input: TInput) => TOutput {
  const cache = new Map<string, CacheEntry<TOutput>>();

  return (input: TInput): TOutput => {
    const cached = cache.get(input.partitionKey);
    if (cached && cached.version === input.version) {
      return cached.value;
    }

    const value = compute(input);
    cache.delete(input.partitionKey);
    cache.set(input.partitionKey, { version: input.version, value });

    // Bounded LRU: drop the oldest partition when the cache grows.
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  };
}

export function createRollupPartitionKey(
  userId: string,
  scope: string,
  range: DateRange
): string {
  return `${userId}|${scope}|${range.start}..${range.end}`;
}

export function computeRollupVersion(
  records: ReadonlyArray<{ loggedAt?: number; updatedAt?: number }>
): number {
  let version = 0;
  for (const record of records) {
    const stamp = record.updatedAt ?? record.loggedAt ?? 0;
    if (Number.isFinite(stamp) && stamp > version) version = stamp;
  }
  return version;
}

export function getWeekRangeForDate(
  dateKey: string,
  weekStartsOn: 0 | 1 = 1
): DateRange {
  const [year, month, day] = dateKey.split("-").map(Number);
  const base = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const dayOfWeek = base.getUTCDay();
  const back = (dayOfWeek - weekStartsOn + 7) % 7;
  base.setUTCDate(base.getUTCDate() - back);
  const start = formatUtcDateKey(base);
  base.setUTCDate(base.getUTCDate() + 6);
  return { start, end: formatUtcDateKey(base) };
}

export function getMonthRangeForDate(dateKey: string): DateRange {
  const month = dateKey.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const start = formatUtcDateKey(
    new Date(Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1, 1))
  );
  const end = formatUtcDateKey(
    new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 0))
  );
  return { start, end };
}

function formatUtcDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isInRange(dateKey: string, range: DateRange): boolean {
  return dateKey >= range.start && dateKey <= range.end;
}

function sumValues(
  events: readonly RollupValueEvent[],
  kinds: readonly RollupValueKind[],
  filter: (event: RollupValueEvent) => boolean = () => true
): number {
  const allowed = new Set(kinds);
  let total = 0;
  for (const event of events) {
    if (!allowed.has(event.kind) || !Number.isFinite(event.value)) continue;
    if (!filter(event)) continue;
    total += event.value;
  }
  return Math.round(total * 100) / 100;
}

export interface HabitRateInput extends PartitionedSelectorInput {
  logs: readonly RollupHabitLog[];
  range: DateRange;
}

/** Completion = done / (done + missed); skipped is neutral; null when 0 denominator. */
export function computeHabitRate(
  logs: readonly RollupHabitLog[],
  range: DateRange
): number | null {
  let done = 0;
  let missed = 0;
  for (const log of logs) {
    if (!isInRange(log.dateKey, range)) continue;
    if (log.status === "done") done += 1;
    else if (log.status === "missed") missed += 1;
  }
  const denominator = done + missed;
  return denominator === 0 ? null : done / denominator;
}

const habitRateSelector = createPartitionedSelector<HabitRateInput, number | null>(
  (input) => computeHabitRate(input.logs, input.range)
);

export function selectHabitRate(input: HabitRateInput): number | null {
  return habitRateSelector(input);
}

export interface GoalTotalInput extends PartitionedSelectorInput {
  startingValue: number | null;
  habitId?: string;
  values: readonly RollupValueEvent[];
}

export function computeGoalTotal(input: {
  startingValue: number | null;
  habitId?: string;
  values: readonly RollupValueEvent[];
}): number | null {
  if (input.startingValue === null || !Number.isFinite(input.startingValue)) {
    return null;
  }
  const linked = input.values.filter(
    (event) =>
      event.kind === "goal" &&
      (input.habitId === undefined || event.habitId === input.habitId)
  );
  return Math.round((input.startingValue + sumValues(linked, ["goal"])) * 100) / 100;
}

const goalTotalSelector = createPartitionedSelector<
  GoalTotalInput,
  number | null
>((input) => computeGoalTotal(input));

export function selectGoalTotal(input: GoalTotalInput): number | null {
  return goalTotalSelector(input);
}

export interface HoursInput extends PartitionedSelectorInput {
  values: readonly RollupValueEvent[];
  range: DateRange;
  habitIds?: readonly string[];
}

export function computeHoursForRange(input: {
  values: readonly RollupValueEvent[];
  range: DateRange;
  habitIds?: readonly string[];
}): number {
  const allowedHabits = input.habitIds ? new Set(input.habitIds) : null;
  return sumValues(input.values, ["hours"], (event) => {
    if (!isInRange(event.dateKey, input.range)) return false;
    return allowedHabits === null || (event.habitId !== undefined && allowedHabits.has(event.habitId));
  });
}

const hoursSelector = createPartitionedSelector<HoursInput, number>((input) =>
  computeHoursForRange(input)
);

export function selectHoursForRange(input: HoursInput): number {
  return hoursSelector(input);
}

export interface RunsInput extends PartitionedSelectorInput {
  logs: readonly RollupHabitLog[];
  runHabitIds: readonly string[];
  range: DateRange;
  target: number | null;
}

export interface RunsRollup {
  done: number;
  target: number | null;
}

export function computeRunsThisWeek(input: {
  logs: readonly RollupHabitLog[];
  runHabitIds: readonly string[];
  range: DateRange;
  target: number | null;
}): RunsRollup {
  const runHabits = new Set(input.runHabitIds);
  const doneHabits = new Set<string>();
  for (const log of input.logs) {
    if (log.status !== "done") continue;
    if (!isInRange(log.dateKey, input.range)) continue;
    if (runHabits.has(log.habitId)) doneHabits.add(log.habitId);
  }
  return { done: doneHabits.size, target: input.target };
}

const runsSelector = createPartitionedSelector<RunsInput, RunsRollup>((input) =>
  computeRunsThisWeek(input)
);

export function selectRunsThisWeek(input: RunsInput): RunsRollup {
  return runsSelector(input);
}

export interface SpendingInput extends PartitionedSelectorInput {
  values: readonly RollupValueEvent[];
  range: DateRange;
}

export function computeSpending(input: {
  values: readonly RollupValueEvent[];
  range: DateRange;
}): number {
  return sumValues(input.values, ["expense"], (event) =>
    isInRange(event.dateKey, input.range)
  );
}

const spendingSelector = createPartitionedSelector<SpendingInput, number>(
  (input) => computeSpending(input)
);

export function selectSpending(input: SpendingInput): number {
  return spendingSelector(input);
}

export interface LoanBalanceInput extends PartitionedSelectorInput {
  values: readonly RollupValueEvent[];
}

export function computeLoanBalance(
  values: readonly RollupValueEvent[]
): number {
  const principal = sumValues(values, ["principal"]);
  const repayments = sumValues(values, ["repayment"]);
  return Math.round((principal - repayments) * 100) / 100;
}

const loanBalanceSelector = createPartitionedSelector<
  LoanBalanceInput,
  number
>((input) => computeLoanBalance(input.values));

export function selectLoanBalance(input: LoanBalanceInput): number {
  return loanBalanceSelector(input);
}
