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
import type {
  DailyPlatformMetricPoint,
  PlatformKpis,
} from "@/server/dal/admin-repository";

interface AdminAnalyticsChartsProps {
  dailySeries: DailyPlatformMetricPoint[];
  delivery: PlatformKpis["delivery"];
}

const DAILY_ACTIVITY_CONFIG = {
  tasksCompleted: {
    label: "Tasks completed",
    color: "var(--accent-done)",
  },
  habitLogs: {
    label: "Habit logs",
    color: "var(--accent-collab)",
  },
  newUsers: {
    label: "New users",
    color: "var(--accent-reminder)",
  },
} satisfies ChartConfig;

const DELIVERY_PIPELINE_CONFIG = {
  value: {
    label: "Reminders",
    color: "var(--accent-reminder)",
  },
} satisfies ChartConfig;

function DailyActivityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DailyPlatformMetricPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="min-w-[178px] space-y-1 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground">
      <div className="border-b border-border pb-1">
        <span className="mono-tabular font-medium text-foreground">
          {point.dateKey}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-[2px] bg-done" />
          Tasks done
        </span>
        <span className="mono-tabular font-semibold text-foreground">
          {point.tasksCompleted}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-[2px] bg-collab" />
          Habit check-ins
        </span>
        <span className="mono-tabular font-semibold text-foreground">
          {point.habitLogs}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-[2px] bg-reminder" />
          New signups
        </span>
        <span className="mono-tabular font-semibold text-foreground">
          {point.newUsers}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border pt-1">
        <span className="text-muted-foreground">Reminders sent</span>
        <span className="mono-tabular text-muted-foreground">
          {point.remindersSent}
        </span>
      </div>
    </div>
  );
}

interface PipelineBarRow {
  stage: string;
  value: number;
}

function DeliveryPipelineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: PipelineBarRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="min-w-[144px] space-y-1 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{row.stage}</span>
        <span className="mono-tabular font-semibold text-foreground">
          {row.value}
        </span>
      </div>
    </div>
  );
}

export function AdminAnalyticsCharts({
  dailySeries,
  delivery,
}: AdminAnalyticsChartsProps) {
  const { resolvedTheme } = useTheme();
  const themeKey = resolvedTheme ?? "light";

  const pipelineData: PipelineBarRow[] = [
    { stage: "Scheduled", value: delivery.remindersScheduled },
    { stage: "Horizon", value: delivery.remindersPendingFar },
    { stage: "Sent", value: delivery.remindersSent },
    { stage: "Snoozed", value: delivery.remindersSnoozed },
    { stage: "Cancelled", value: delivery.remindersCancelled },
  ];

  return (
    <section
      aria-label="Platform analytics charts"
      className="grid grid-cols-1 gap-3 lg:grid-cols-12"
    >
      {/* 14-Day Platform Activity Trend */}
      <div className="rounded-md border border-border bg-card p-3.5 lg:col-span-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold tracking-tight text-foreground">
              14-day platform activity
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Daily completed tasks, habit check-ins, and new user registrations
              (UTC)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-done" />
              Tasks done
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-collab" />
              Habit logs
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 border-t border-dashed border-reminder" />
              Signups
            </span>
          </div>
        </div>

        <ChartContainer
          key={`admin-daily-${themeKey}`}
          config={DAILY_ACTIVITY_CONFIG}
          className="aspect-auto h-[220px] w-full"
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
              minTickGap={16}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={<DailyActivityTooltip />}
            />
            <Line
              type="monotone"
              dataKey="tasksCompleted"
              stroke="var(--accent-done)"
              strokeWidth={2}
              dot={{ r: 2, fill: "var(--accent-done)", strokeWidth: 0 }}
              activeDot={{ r: 4, fill: "var(--accent-done)" }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="habitLogs"
              stroke="var(--accent-collab)"
              strokeWidth={2}
              dot={{ r: 2, fill: "var(--accent-collab)", strokeWidth: 0 }}
              activeDot={{ r: 4, fill: "var(--accent-collab)" }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="newUsers"
              stroke="var(--accent-reminder)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </div>

      {/* Reminder Delivery Pipeline */}
      <div className="rounded-md border border-border bg-card p-3.5 lg:col-span-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold tracking-tight text-foreground">
              Reminder delivery pipeline
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Distribution across scheduling horizon and delivery states
            </p>
          </div>
        </div>

        <ChartContainer
          key={`admin-pipeline-${themeKey}`}
          config={DELIVERY_PIPELINE_CONFIG}
          className="aspect-auto h-[220px] w-full"
        >
          <BarChart
            data={pipelineData}
            margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="2 2"
            />
            <XAxis
              dataKey="stage"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
            <ChartTooltip
              cursor={{ fill: "var(--accent)", opacity: 0.45 }}
              content={<DeliveryPipelineTooltip />}
            />
            <Bar
              dataKey="value"
              fill="var(--accent-reminder)"
              radius={[3, 3, 0, 0]}
              maxBarSize={36}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </div>
    </section>
  );
}
