"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  CalendarCheck2,
  Check,
  Command,
  FileText,
  Flame,
  Lock,
  Repeat2,
  ShieldCheck,
  Smartphone,
  Users,
  Zap,
} from "lucide-react";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface FolioLandingProps {
  googleEnabled: boolean;
  emailPasswordEnabled: boolean;
}

type PreviewTab = "today" | "habits" | "circle";
type DemoHabitCell = "done" | "skipped" | "missed" | null;

const INITIAL_DEMO_TASKS = [
  {
    id: "t1",
    title: "Finalize Q4 release checklist",
    meta: "Today · 14:00",
    project: "Launch",
    done: false,
    hasReminder: true,
  },
  {
    id: "t2",
    title: "Pay utility invoice",
    meta: "Tomorrow · 09:00",
    project: "Inbox",
    done: false,
    hasReminder: true,
  },
  {
    id: "t3",
    title: "Review weekly reading notes",
    meta: "Done",
    project: "Inbox",
    done: true,
    hasReminder: false,
  },
];

const DEMO_DAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

const INITIAL_DEMO_HABITS: Array<{
  id: string;
  title: string;
  cells: DemoHabitCell[];
}> = [
  {
    id: "h1",
    title: "Deep work · 60m",
    cells: ["done", "done", "done", "skipped", "done", "done", null],
  },
  {
    id: "h2",
    title: "Read 20 pages",
    cells: ["done", "done", "missed", "done", "done", "done", null],
  },
  {
    id: "h3",
    title: "Evening walk",
    cells: ["done", "skipped", "done", "done", "done", null, null],
  },
];

function cycleDemoCell(current: DemoHabitCell): DemoHabitCell {
  if (current === null) return "done";
  if (current === "done") return "skipped";
  if (current === "skipped") return "missed";
  return null;
}

export function FolioLanding({
  googleEnabled,
  emailPasswordEnabled,
}: FolioLandingProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("today");
  const [demoTasks, setDemoTasks] = useState(INITIAL_DEMO_TASKS);
  const [demoHabits, setDemoHabits] = useState(INITIAL_DEMO_HABITS);
  const [circleWindowOpen, setCircleWindowOpen] = useState(true);

  const completedTasks = demoTasks.filter((t) => t.done).length;

  const habitStats = useMemo(() => {
    let done = 0;
    let scheduled = 0;
    for (const row of demoHabits) {
      for (const cell of row.cells.slice(0, 6)) {
        if (cell === "skipped") continue;
        scheduled += 1;
        if (cell === "done") done += 1;
      }
    }
    const pct = scheduled > 0 ? Math.round((done / scheduled) * 100) : 0;
    return { done, scheduled, pct };
  }, [demoHabits]);

  const toggleDemoTask = (id: string) => {
    setDemoTasks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    );
  };

  const toggleDemoHabitCell = (habitId: string, dayIdx: number) => {
    setDemoHabits((prev) =>
      prev.map((row) => {
        if (row.id !== habitId) return row;
        const nextCells = [...row.cells];
        nextCells[dayIdx] = cycleDemoCell(nextCells[dayIdx] ?? null);
        return { ...row, cells: nextCells };
      })
    );
  };

  return (
    <div
      data-folio-landing="true"
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      {/* Editorial Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95">
        <div className="mx-auto flex h-12 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <Link
            href="/"
            className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold tracking-tight text-foreground md:min-h-7"
          >
            <BrandMark />
            <span>{APP_NAME}</span>
          </Link>

          <nav
            aria-label="Primary landing navigation"
            className="hidden items-center gap-6 text-xs text-muted-foreground md:flex"
          >
            <a
              href="#capabilities"
              className="transition-colors hover:text-foreground"
            >
              Capabilities
            </a>
            <a
              href="#habits-circle"
              className="transition-colors hover:text-foreground"
            >
              Habits &amp; Circle
            </a>
            <a
              href="#principles"
              className="transition-colors hover:text-foreground"
            >
              Architecture
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <Button asChild size="sm" className="mira-row px-3 text-xs">
              <Link href="/login">
                {emailPasswordEnabled ? "Sign in" : "Open Folio"}
                <ArrowRight className="ml-1.5 size-3" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* 01 — Editorial Split Hero + Interactive Mira Product Surface */}
        <section
          aria-labelledby="hero-heading"
          className="border-b border-border"
        >
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 py-12 md:px-6 md:py-16 lg:grid-cols-12 lg:items-center lg:gap-12">
            {/* Left Copy & Action Column */}
            <div className="folio-reveal space-y-6 lg:col-span-6">
              <div className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                <span className="mono-tabular font-medium text-foreground">
                  01
                </span>
                <span aria-hidden="true" className="text-border">
                  /
                </span>
                <span>Warm Paper · Carbon Ink Productivity Ledger</span>
              </div>

              <div className="space-y-3">
                <h1
                  id="hero-heading"
                  className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-[42px] lg:leading-[1.1]"
                >
                  Tasks, quiet notes, and honest habits—in one calm sheet.
                </h1>
                <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                  Folio unites personal inbox capture, timed multi-channel
                  reminders, shared projects with strict RBAC, and real-calendar
                  habit tracking—engineered to stay fast, private, and
                  distraction-free.
                </p>
              </div>

              {/* Primary Entry Controls */}
              <div className="flex flex-col gap-3 sm:max-w-sm">
                {!emailPasswordEnabled ? (
                  <GoogleAuthButton
                    callbackURL="/app/today"
                    googleEnabled={googleEnabled}
                    label="Continue with Google"
                    hideConfigHint
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Button asChild className="mira-row px-4 text-xs">
                      <Link href="/login">
                        Sign in to Workspace
                        <ArrowRight className="ml-1.5 size-3.5" />
                      </Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="mira-row border-border bg-card px-4 text-xs"
                    >
                      <Link href="/register">Create account</Link>
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="size-3 text-done" />
                    Private by default
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Smartphone className="size-3 text-collab" />
                    Installable PWA
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Zap className="size-3 text-reminder" />
                    Instant cached navigation
                  </span>
                </div>
              </div>
            </div>

            {/* Right Interactive Product Preview (MotionSites-inspired tactile bento surface) */}
            <div className="folio-reveal folio-reveal-delay-1 lg:col-span-6">
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                {/* Preview Window Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-sidebar px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <BrandMark />
                    <span className="text-xs font-medium text-foreground">
                      Interactive preview
                    </span>
                  </div>

                  <div
                    role="tablist"
                    aria-label="Preview workspace modules"
                    className="inline-flex rounded-md border border-border bg-background p-0.5"
                  >
                    {(
                      [
                        { id: "today", label: "Today", icon: CalendarCheck2 },
                        { id: "habits", label: "Habits", icon: Repeat2 },
                        { id: "circle", label: "Circle", icon: Users },
                      ] as const
                    ).map((tab) => {
                      const Icon = tab.icon;
                      const selected = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          id={`landing-tab-${tab.id}`}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          aria-controls={`landing-tabpanel-${tab.id}`}
                          onClick={() => setActiveTab(tab.id)}
                          className={cn(
                            "inline-flex min-h-9 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors md:min-h-7",
                            selected
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Icon className="size-3" />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Live Interactive Tab Body */}
                <div
                  role="tabpanel"
                  id={`landing-tabpanel-${activeTab}`}
                  aria-labelledby={`landing-tab-${activeTab}`}
                  className="min-h-[280px] p-4"
                >
                  {activeTab === "today" ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <Command className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-foreground">
                            Pay invoice{" "}
                            <span className="rounded border border-reminder/35 bg-reminder/15 px-1.5 py-0.5 text-[11px] font-medium text-reminder">
                              tomorrow 9am
                            </span>
                          </span>
                        </div>
                        <kbd className="mono-tabular shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          ⌘K
                        </kbd>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Click any task to test optimistic completion</span>
                        <span className="mono-tabular font-medium text-foreground">
                          {completedTasks}/{demoTasks.length} done
                        </span>
                      </div>

                      <div className="divide-y divide-border rounded-md border border-border bg-background">
                        {demoTasks.map((task) => (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => toggleDemoTask(task.id)}
                            className="mira-row flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/60"
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span
                                className={cn(
                                  "flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                                  task.done
                                    ? "border-done bg-done text-primary-foreground"
                                    : "border-border bg-card text-transparent"
                                )}
                              >
                                <Check className="size-2.5 stroke-[2.5]" />
                              </span>
                              <span
                                className={cn(
                                  "truncate text-foreground",
                                  task.done &&
                                    "text-muted-foreground line-through"
                                )}
                              >
                                {task.title}
                              </span>
                            </span>

                            <span className="flex shrink-0 items-center gap-1.5">
                              {task.hasReminder && !task.done ? (
                                <span className="mono-tabular inline-flex items-center gap-1 rounded border border-reminder/35 bg-reminder/10 px-1.5 py-0.5 text-[10px] text-reminder">
                                  <Bell className="size-2.5" />
                                  {task.meta}
                                </span>
                              ) : (
                                <span className="mono-tabular text-[10px] text-muted-foreground">
                                  {task.done ? "Done" : task.project}
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : activeTab === "habits" ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-foreground">
                            Real-calendar matrix · Elapsed-to-Date
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Click any cell to cycle Done → Rest pass → Missed
                          </p>
                        </div>
                        <div className="mono-tabular flex items-center gap-2 rounded border border-border bg-background px-2 py-1 text-xs">
                          <span className="font-semibold text-done">
                            {habitStats.pct}%
                          </span>
                          <span className="text-muted-foreground">
                            ({habitStats.done}/{habitStats.scheduled})
                          </span>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-md border border-border bg-background">
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-border text-[10px] text-muted-foreground">
                              <th className="px-3 py-2 text-left font-medium">
                                Habit
                              </th>
                              {DEMO_DAYS.map((d, i) => (
                                <th
                                  key={`${d}-${i}`}
                                  className="mono-tabular px-1.5 py-2 text-center font-medium"
                                >
                                  {d}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {demoHabits.map((row) => (
                              <tr key={row.id}>
                                <td className="max-w-[140px] truncate px-3 py-2 font-medium text-foreground">
                                  {row.title}
                                </td>
                                {row.cells.map((cell, idx) => (
                                  <td
                                    key={`${row.id}-${idx}`}
                                    className="px-1 py-1.5 text-center"
                                  >
                                    <button
                                      type="button"
                                      aria-label={`Cycle ${row.title} day ${idx + 1}`}
                                      onClick={() =>
                                        toggleDemoHabitCell(row.id, idx)
                                      }
                                      className={cn(
                                        "mx-auto flex size-6 items-center justify-center rounded border text-[10px] font-medium transition-colors",
                                        cell === "done"
                                          ? "border-done bg-done text-primary-foreground"
                                          : cell === "skipped"
                                            ? "border-border bg-muted text-muted-foreground"
                                            : cell === "missed"
                                              ? "border-overdue/40 bg-overdue/10 text-overdue"
                                              : "border-border bg-card text-transparent hover:border-foreground/40"
                                      )}
                                    >
                                      {cell === "done"
                                        ? "✓"
                                        : cell === "skipped"
                                          ? "–"
                                          : cell === "missed"
                                            ? "×"
                                            : "·"}
                                    </button>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground">
                              Accountability Circle
                            </span>
                            <Badge
                              variant="outline"
                              className="h-5 border-collab/40 bg-collab/10 px-1.5 text-[10px] font-normal text-collab"
                            >
                              Selected Scope
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Dynamic commenting window in owner&rsquo;s IANA TZ
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setCircleWindowOpen((prev) => !prev)}
                          className={cn(
                            "mono-tabular inline-flex min-h-8 items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors md:min-h-6",
                            circleWindowOpen
                              ? "border-done/40 bg-done/10 text-done"
                              : "border-border bg-muted text-muted-foreground"
                          )}
                        >
                          {circleWindowOpen ? (
                            <Flame className="size-3" />
                          ) : (
                            <Lock className="size-3" />
                          )}
                          {circleWindowOpen
                            ? "Window Open (click to lock)"
                            : "Locked until Sat 00:00"}
                        </button>
                      </div>

                      <div className="space-y-2 rounded-md border border-border bg-background p-3 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">
                            Cycle W47 Review · 86% consistency
                          </span>
                          <span className="mono-tabular text-[10px] text-muted-foreground">
                            3 shared habits
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {circleWindowOpen
                            ? "Review window is open — monitors can leave threaded reflections and monochrome check-in reactions."
                            : "Commenting is server-enforced locked outside the owner's scheduled review window while optional reactions stay quiet."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02 — Asymmetric 3-Column Editorial Bento Grid */}
        <section
          id="capabilities"
          aria-labelledby="capabilities-heading"
          className="border-b border-border"
        >
          <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-12 md:px-6 md:py-16">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="mono-tabular text-[11px] uppercase tracking-wider text-muted-foreground">
                  02 / Core System
                </p>
                <h2
                  id="capabilities-heading"
                  className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
                >
                  Built for daily clarity without visual noise.
                </h2>
              </div>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                Every workflow runs on one cohesive data ledger: instant
                navigation, ACID transactions, and strict tenant isolation.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Bento Card 1 (Span 2) */}
              <article className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5 md:col-span-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-reminder">
                      <Bell className="size-3.5" />
                      Natural-Language Capture &amp; Durable Reminders
                    </span>
                    <span className="mono-tabular text-[10px] text-muted-foreground">
                      14d Horizon · Outbox
                    </span>
                  </div>
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    Capture in one keystroke. Deliver reliably across every
                    channel.
                  </h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Press <kbd className="mono-tabular rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground">⌘K</kbd>{" "}
                    for timezone-anchored date parsing. Reminders fire across
                    in-app alerts, PWA Web Push quick actions (Snooze 15m / Mark
                    Done), and email fallback with optimistic version locking.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
                  <span className="mono-tabular rounded border border-border bg-background px-2 py-0.5 text-foreground">
                    Inbox · Today · Upcoming
                  </span>
                  <span className="mono-tabular rounded border border-border bg-background px-2 py-0.5 text-foreground">
                    Snooze 15m / 1h / Tom 9 AM
                  </span>
                  <span className="mono-tabular rounded border border-border bg-background px-2 py-0.5 text-foreground">
                    Zero double-delivery
                  </span>
                </div>
              </article>

              {/* Bento Card 2 (Span 1) */}
              <article className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5">
                <div className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <FileText className="size-3.5 text-muted-foreground" />
                    Quiet &amp; Timed Notes
                  </span>
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    Markdown notes that stay out of your way until needed.
                  </h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Pin reference docs, filter by tags, search instantly, and
                    optionally attach a timed reminder without converting a note
                    into a task.
                  </p>
                </div>
                <div className="mono-tabular border-t border-border pt-3 text-[11px] text-muted-foreground">
                  Prefix <code className="text-foreground">n:</code> in ⌘K for
                  instant note capture
                </div>
              </article>

              {/* Bento Card 3 (Span 1) */}
              <article className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5">
                <div className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-collab">
                    <Users className="size-3.5" />
                    Shared Projects &amp; RBAC
                  </span>
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    Personal first. Collaborative when invited.
                  </h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Keep Inbox strictly private while turning any project into a
                    shared workspace via 7-day single-use cryptographic invites.
                    Even read-only viewers can attach private reminders.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 border-t border-border pt-3 text-[10px]">
                  <Badge variant="outline" className="font-normal">
                    Owner
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    Editor
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    Viewer
                  </Badge>
                </div>
              </article>

              {/* Bento Card 4 (Span 2) */}
              <article
                id="habits-circle"
                className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5 md:col-span-2"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-done">
                      <Repeat2 className="size-3.5" />
                      Real-Calendar Habits &amp; Accountability Circle
                    </span>
                    <span className="mono-tabular text-[10px] text-muted-foreground">
                      28–31d Matrix · Task Sync
                    </span>
                  </div>
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    Honest analytics, rest passes, and structured peer reviews.
                  </h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Score against elapsed days (never distorted by mid-month
                    starts or future dates), protect streaks with rest passes,
                    sync daily tasks bidirectionally, and invite trusted
                    monitors with zero-leak selective habit sharing and
                    owner-defined review windows.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
                  <span className="mono-tabular rounded border border-border bg-background px-2 py-0.5 text-foreground">
                    Elapsed-to-Date &amp; Full Month
                  </span>
                  <span className="mono-tabular rounded border border-border bg-background px-2 py-0.5 text-foreground">
                    Weekly / Interval / Anytime Windows
                  </span>
                  <span className="mono-tabular rounded border border-border bg-background px-2 py-0.5 text-foreground">
                    Automated Review Digests
                  </span>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* 03 — Architectural Craft & Privacy Strip */}
        <section id="principles" aria-labelledby="principles-heading">
          <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-12 md:px-6 md:py-16">
            <div>
              <p className="mono-tabular text-[11px] uppercase tracking-wider text-muted-foreground">
                03 / Engineering Guarantees
              </p>
              <h2
                id="principles-heading"
                className="mt-1 text-xl font-semibold tracking-tight text-foreground"
              >
                Speed and privacy designed into every boundary.
              </h2>
            </div>

            <div className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-card md:grid-cols-3 md:divide-x md:divide-y-0">
              {[
                {
                  index: "01",
                  title: "Zero-Refetch Navigation",
                  body: "User-scoped client caching and hover prefetching make switching between Inbox, Today, Notes, Habits, and Projects feel instantaneous.",
                },
                {
                  index: "02",
                  title: "Direct-Database Isolation",
                  body: "Every project permission and monitor scope is verified directly at the database boundary, with full client cache clearing on sign-out.",
                },
                {
                  index: "03",
                  title: "Installable PWA Experience",
                  body: "Install on Android, iOS, or desktop for a dedicated app launch splash screen, home-screen shortcuts, push quick actions, and clean offline handling.",
                },
              ].map((item) => (
                <div key={item.index} className="space-y-2 p-5">
                  <span className="mono-tabular text-[11px] font-medium text-muted-foreground">
                    {item.index}
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-border bg-card/50">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-12 text-center md:px-6 md:py-14">
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Start with a clean sheet.
            </h2>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              Open Folio in your browser or install it directly to your home
              screen for a calm, focused daily workspace.
            </p>
            <div className="w-full max-w-[260px]">
              {!emailPasswordEnabled ? (
                <GoogleAuthButton
                  callbackURL="/app/today"
                  googleEnabled={googleEnabled}
                  label="Continue with Google"
                  hideConfigHint
                />
              ) : (
                <Button asChild className="mira-row w-full text-xs">
                  <Link href="/login">
                    Sign in to Folio
                    <ArrowRight className="ml-1.5 size-3.5" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-5 text-xs text-muted-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 md:px-2">
          <div className="inline-flex items-center gap-2 text-foreground">
            <BrandMark />
            <span className="font-medium">{APP_NAME}</span>
            <span className="text-muted-foreground">
              · Calm personal &amp; shared productivity
            </span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <Link
              href="/login"
              className="inline-flex min-h-9 items-center px-1.5 hover:text-foreground md:min-h-6"
            >
              Sign in
            </Link>
            <span className="mono-tabular">Warm Paper · Carbon Ink</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
