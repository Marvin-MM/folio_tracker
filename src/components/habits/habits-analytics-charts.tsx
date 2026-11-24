"use client";

import { useTheme } from "next-themes";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type {
  DailyCompletionPoint,
  WeeklyComparisonPoint,
} from "@/server/domain/habit-analytics";

interface HabitsAnalyticsChartsProps {
  monthLabel: string;
  dailySeries: DailyCompletionPoint[];
  weeklySeries: WeeklyComparisonPoint[];
}

const DAILY_CHART_CONFIG = {
  completionRate: {
    label: "Daily rate",
    color: "var(--accent-done)",
  },
  rolling7DayAvg: {
    label: "7-day avg",
    color: "var(--muted-foreground)",
  },
} satisfies ChartConfig;

const WEEKLY_CHART_CONFIG = {
  completionRate: {
    label: "Weekly rate",
    color: "var(--accent-done)",
  },
} satisfies ChartConfig;

function DailyTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DailyCompletionPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="min-w-[168px] space-y-1 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-1">
        <span className="mono-tabular font-medium text-foreground">
          {point.dateKey}
        </span>
        <span className="mono-tabular text-[11px] text-muted-foreground">
          {point.doneCount}/{point.scheduledCount}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-[2px] bg-done" />
          Daily
        </span>
        <span className="mono-tabular font-semibold text-foreground">
          {point.completionRate !== null ? `${point.completionRate}%` : "—"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="w-2 border-t border-dashed border-muted-foreground" />
          7-day avg
        </span>
        <span className="mono-tabular text-muted-foreground">
          {point.rolling7DayAvg !== null ? `${point.rolling7DayAvg}%` : "—"}
        </span>
      </div>
    </div>
  );
}

function WeeklyTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: WeeklyComparisonPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="min-w-[172px] space-y-1 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-1">
        <span className="font-medium text-foreground">
          {point.weekLabel} · {point.dateRangeLabel}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Completion</span>
        <span className="mono-tabular font-semibold text-foreground">
          {point.completionRate !== null ? `${point.completionRate}%` : "—"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Units</span>
        <span className="mono-tabular text-muted-foreground">
          {point.doneCount}/{point.targetCount}
        </span>
      </div>
      {point.deltaFromPrevPct !== null ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">vs prev week</span>
          <span
            className={cn(
              "mono-tabular font-medium",
              point.deltaFromPrevPct > 0
                ? "text-done"
                : point.deltaFromPrevPct < 0
                  ? "text-overdue"
                  : "text-muted-foreground"
            )}
          >
            {point.deltaFromPrevPct > 0
              ? `+${point.deltaFromPrevPct} pts`
              : `${point.deltaFromPrevPct} pts`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function HabitsAnalyticsCharts({
  monthLabel,
  dailySeries,
  weeklySeries,
}: HabitsAnalyticsChartsProps) {
  const { resolvedTheme } = useTheme();
  const themeKey = resolvedTheme ?? "light";

  return (
    <section
      aria-label="Habit analytics charts"
      className="grid grid-cols-1 gap-3 lg:grid-cols-12"
    >
      {/* Daily Completion Line Chart (ALL 28..31 days + 7-day rolling average) */}
      <div className="rounded-md border border-border bg-card p-3.5 lg:col-span-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold tracking-tight text-foreground">
              Daily completion · {monthLabel}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              All {dailySeries.length} calendar days with trailing 7-day rolling
              average
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-done" />
              Daily %
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 border-t border-dashed border-muted-foreground" />
              7d avg
            </span>
          </div>
        </div>

        <ChartContainer
          key={`daily-${themeKey}`}
          config={DAILY_CHART_CONFIG}
          className="aspect-auto h-[210px] w-full"
        >
          <LineChart
            data={dailySeries}
            margin={{ top: 8, right: 10, left: -18, bottom: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="2 2"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={14}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={<DailyTooltipContent />}
            />
            <Line
              type="monotone"
              dataKey="rolling7DayAvg"
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="completionRate"
              stroke="var(--accent-done)"
              strokeWidth={2}
              dot={{ r: 2, fill: "var(--accent-done)", strokeWidth: 0 }}
              activeDot={{ r: 4, fill: "var(--accent-done)" }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </div>

      {/* Weekly Comparison Bar Chart (W1..W5/W6 + WoW delta badges) */}
      <div className="rounded-md border border-border bg-card p-3.5 lg:col-span-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold tracking-tight text-foreground">
              Weekly comparison
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Real calendar weeks ({weeklySeries[0]?.weekLabel}–
              {weeklySeries[weeklySeries.length - 1]?.weekLabel}) with WoW
              deltas
            </p>
          </div>
        </div>

        <ChartContainer
          key={`weekly-${themeKey}`}
          config={WEEKLY_CHART_CONFIG}
          className="aspect-auto h-[170px] w-full"
        >
          <BarChart
            data={weeklySeries}
            margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="2 2"
            />
            <XAxis
              dataKey="weekLabel"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <ChartTooltip
              cursor={{ fill: "var(--accent)", opacity: 0.45 }}
              content={<WeeklyTooltipContent />}
            />
            <Bar
              dataKey="completionRate"
              fill="var(--accent-done)"
              radius={[3, 3, 0, 0]}
              maxBarSize={36}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>

        {/* Week-over-week tabular badges */}
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border pt-2.5">
          {weeklySeries.map((wk) => (
            <div
              key={wk.weekLabel}
              className="mono-tabular inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px]"
            >
              <span className="font-medium text-foreground">{wk.weekLabel}</span>
              <span className="text-muted-foreground">
                {wk.completionRate !== null ? `${wk.completionRate}%` : "—"}
              </span>
              {wk.deltaFromPrevPct !== null ? (
                <span
                  className={cn(
                    "font-medium",
                    wk.deltaFromPrevPct > 0
                      ? "text-done"
                      : wk.deltaFromPrevPct < 0
                        ? "text-overdue"
                        : "text-muted-foreground"
                  )}
                >
                  {wk.deltaFromPrevPct > 0
                    ? `+${wk.deltaFromPrevPct}`
                    : wk.deltaFromPrevPct}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
