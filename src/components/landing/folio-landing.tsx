"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
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
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { BrandMark } from "@/components/brand-mark";
import type { HeroFormationId } from "@/components/landing/dot-matrix-3d-engine";
import { PerspectiveStageCard } from "@/components/landing/perspective-stage-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

const FolioDotMatrixCanvas = dynamic(
  () =>
    import("@/components/landing/folio-dot-matrix-canvas").then(
      (mod) => mod.FolioDotMatrixCanvas
    ),
  { ssr: false }
);

interface FolioLandingProps {
  googleEnabled: boolean;
  emailPasswordEnabled: boolean;
}

type PreviewTab = "today" | "habits" | "circle";
type DemoHabitCell = "done" | "skipped" | "missed" | null;
type DemoScoringMode = "elapsed" | "full_month";
type DemoReactionKey = "ack" | "solid" | "push";

const HERO_PILLARS: ReadonlyArray<{
  index: string;
  label: string;
  detail: string;
  formation: HeroFormationId;
  tab: PreviewTab;
  sculptureLabel: string;
}> = [
  {
    index: "01",
    label: "Capture & Remind",
    detail: "⌘K natural language + 14d durable outbox",
    formation: "capture",
    tab: "today",
    sculptureLabel: "01 / Stacked Ledger Sheets",
  },
  {
    index: "02",
    label: "Real-Calendar Habits",
    detail: "28–31d matrix + 0ms elapsed scoring",
    formation: "habits",
    tab: "habits",
    sculptureLabel: "02 / Curved 31-Day Matrix",
  },
  {
    index: "03",
    label: "Shared Circle",
    detail: "Direct-DB RBAC + scoped review windows",
    formation: "circle",
    tab: "circle",
    sculptureLabel: "03 / Accountability Orbit",
  },
] as const;

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
    title: "Pay studio utility invoice",
    meta: "Tomorrow · 09:00",
    project: "Inbox",
    done: false,
    hasReminder: true,
  },
  {
    id: "t3",
    title: "Review weekly architecture notes",
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
  const [activeFormation, setActiveFormation] =
    useState<HeroFormationId>("capture");
  const [isFormationPinned, setIsFormationPinned] = useState(false);
  const [activeTab, setActiveTab] = useState<PreviewTab>("today");
  const [demoTasks, setDemoTasks] = useState(INITIAL_DEMO_TASKS);
  const [demoHabits, setDemoHabits] = useState(INITIAL_DEMO_HABITS);
  const [demoScoringMode, setDemoScoringMode] =
    useState<DemoScoringMode>("elapsed");
  const [circleWindowOpen, setCircleWindowOpen] = useState(true);
  const [demoReactions, setDemoReactions] = useState<
    Record<DemoReactionKey, number>
  >({
    ack: 2,
    solid: 3,
    push: 1,
  });
  const [myReactions, setMyReactions] = useState<
    Record<DemoReactionKey, boolean>
  >({
    ack: false,
    solid: true,
    push: false,
  });

  const activePillar =
    HERO_PILLARS.find((pillar) => pillar.formation === activeFormation) ??
    HERO_PILLARS[0]!;

  const completedTasks = demoTasks.filter((t) => t.done).length;

  const habitStats = useMemo(() => {
    const dayLimit = demoScoringMode === "elapsed" ? 6 : 7;
    let done = 0;
    let scheduled = 0;
    for (const row of demoHabits) {
      for (const cell of row.cells.slice(0, dayLimit)) {
        if (cell === "skipped") continue;
        scheduled += 1;
        if (cell === "done") done += 1;
      }
    }
    const pct = scheduled > 0 ? Math.round((done / scheduled) * 100) : 0;
    return { done, scheduled, pct };
  }, [demoHabits, demoScoringMode]);

  const handleAutoAdvance = useCallback((nextFormation: HeroFormationId) => {
    setActiveFormation(nextFormation);
  }, []);

  const handlePreviewPillar = (formation: HeroFormationId) => {
    setIsFormationPinned(true);
    setActiveFormation(formation);
  };

  const handleActivatePillar = (
    formation: HeroFormationId,
    tab: PreviewTab
  ) => {
    setIsFormationPinned(true);
    setActiveFormation(formation);
    setActiveTab(tab);
    const stage = document.getElementById("workspace");
    if (stage) {
      stage.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleSelectWorkspaceTab = (tab: PreviewTab) => {
    setActiveTab(tab);
    const matching = HERO_PILLARS.find((p) => p.tab === tab);
    if (matching) {
      setIsFormationPinned(true);
      setActiveFormation(matching.formation);
    }
  };

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

  const toggleDemoReaction = (key: DemoReactionKey) => {
    const active = myReactions[key];
    setMyReactions((prev) => ({ ...prev, [key]: !active }));
    setDemoReactions((prev) => ({
      ...prev,
      [key]: Math.max(0, prev[key] + (active ? -1 : 1)),
    }));
  };

  return (
    <div
      data-folio-landing="true"
      className="flex min-h-screen flex-col overflow-x-clip bg-background text-foreground"
    >
      {/* 3-Zone Editorial Navigation */}
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex h-13 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold tracking-tight text-foreground md:min-h-7"
          >
            <BrandMark />
            <span>{APP_NAME}</span>
          </Link>

          <nav
            aria-label="Primary landing navigation"
            className="hidden items-center gap-7 text-xs font-medium text-muted-foreground md:flex"
          >
            <a
              href="#workspace"
              className="transition-colors duration-200 hover:text-foreground"
            >
              Workspace
            </a>
            <a
              href="#capabilities"
              className="transition-colors duration-200 hover:text-foreground"
            >
              Capabilities
            </a>
            <a
              href="#principles"
              className="transition-colors duration-200 hover:text-foreground"
            >
              Architecture
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <Button
              asChild
              size="sm"
              className="mira-row px-3.5 text-xs transition-transform duration-200 hover:-translate-y-px"
            >
              <Link href="/login">
                {emailPasswordEnabled ? "Sign in" : "Open Folio"}
                <ArrowRight className="ml-1.5 size-3" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* 01 — Full-Viewport 3D Dot-Matrix Hero + Anchored Editorial Info Sheet */}
        <section
          aria-labelledby="hero-heading"
          className="relative flex min-h-[calc(100svh-3.25rem)] flex-col justify-between overflow-hidden border-b border-border"
        >
          {/* Live Procedural 3D LED Dot-Matrix Canvas (Lazy-Loaded, Zero External Assets) */}
          <FolioDotMatrixCanvas
            activeFormation={activeFormation}
            isUserPinned={isFormationPinned}
            onAutoAdvance={handleAutoAdvance}
          />

          {/* Centered Monumental Copy Block (Sits inside Canvas Copy Quiet Zone) */}
          <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 py-12 text-center sm:px-6 md:py-16">
            <div className="folio-reveal inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full transition-colors duration-300",
                  activeFormation === "capture"
                    ? "bg-reminder"
                    : activeFormation === "habits"
                      ? "bg-done"
                      : "bg-collab"
                )}
              />
              <span className="mono-tabular font-medium text-foreground">
                {activePillar.sculptureLabel}
              </span>
            </div>

            <h1
              id="hero-heading"
              className="folio-reveal mt-5 max-w-3xl text-[clamp(2.25rem,5.2vw,4.5rem)] leading-[1.03] font-medium tracking-[-0.04em]"
            >
              <span className="block text-muted-foreground">
                One calm ledger for
              </span>
              <span className="block text-foreground">
                tasks, notes &amp; habits.
              </span>
            </h1>

            <p className="folio-reveal folio-reveal-delay-1 mt-5 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              Natural-language capture, durable multi-channel reminders,
              real-calendar habit tracking, and shared workspaces—engineered to
              stay instant and private.
            </p>

            {/* Primary CTA */}
            <div className="folio-reveal folio-reveal-delay-1 mt-7 flex w-full max-w-xs flex-col items-center gap-3 sm:max-w-sm">
              {!emailPasswordEnabled ? (
                <div className="w-full max-w-[260px]">
                  <GoogleAuthButton
                    callbackURL="/app/today"
                    googleEnabled={googleEnabled}
                    label="Continue with Google"
                    hideConfigHint
                  />
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <Button
                    asChild
                    className="mira-row px-5 text-xs transition-transform duration-200 hover:-translate-y-px"
                  >
                    <Link href="/login">
                      Sign in to Workspace
                      <ArrowRight className="ml-1.5 size-3.5" aria-hidden="true" />
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

              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="size-3 text-done" aria-hidden="true" />
                  Private by default
                </span>
                <span className="inline-flex items-center gap-1">
                  <Smartphone className="size-3 text-collab" aria-hidden="true" />
                  Installable PWA
                </span>
                <span className="inline-flex items-center gap-1">
                  <Zap className="size-3 text-reminder" aria-hidden="true" />
                  Zero-refetch cache
                </span>
              </div>
            </div>
          </div>

          {/* Anchored Bottom Editorial Sheet (Boomerang-inspired solid Mira flush ledger) */}
          <div className="relative z-10 mx-auto w-full max-w-5xl px-4 sm:px-6">
            <div className="rounded-t-lg border border-b-0 border-border bg-card px-5 pt-6 pb-4 sm:px-8 sm:pt-8 sm:pb-5 md:px-10">
              {/* Row 1 — Two-column editorial thesis */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-end md:gap-10">
                <div>
                  <p className="mono-tabular text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    What does Folio unify?
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                    Work that keeps its rhythm.
                  </h2>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
                  Personal Inbox and markdown notes stay strictly private while
                  timed reminders, 31-day habit matrices, and invited circles
                  run on one instant, zero-refetch workspace ledger.
                </p>
              </div>

              {/* Hairline divider */}
              <div className="my-5 h-px w-full bg-border" />

              {/* Row 2 — 3 Interactive Numbered Pillar Rows controlling the 3D Sculpture & Stage */}
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2.5"
                onMouseLeave={(event) => {
                  if (!event.currentTarget.contains(document.activeElement)) {
                    setIsFormationPinned(false);
                  }
                }}
                onBlur={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null
                    )
                  ) {
                    setIsFormationPinned(false);
                  }
                }}
              >
                {HERO_PILLARS.map((pillar) => {
                  const isActive = activeFormation === pillar.formation;
                  return (
                    <button
                      key={pillar.formation}
                      type="button"
                      onMouseEnter={() => handlePreviewPillar(pillar.formation)}
                      onFocus={() => handlePreviewPillar(pillar.formation)}
                      onClick={() =>
                        handleActivatePillar(pillar.formation, pillar.tab)
                      }
                      aria-pressed={isActive}
                      className={cn(
                        "group flex min-h-12 w-full items-center justify-between gap-2 rounded-md border px-3.5 py-2.5 text-left transition-colors duration-200",
                        isActive
                          ? "border-foreground/35 bg-accent text-foreground"
                          : "border-transparent bg-secondary text-foreground hover:border-border hover:bg-accent"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center text-xs font-medium">
                          <span className="mono-tabular text-muted-foreground">
                            {pillar.index}
                          </span>
                          <span
                            aria-hidden="true"
                            className="mx-1.5 text-muted-foreground/50"
                          >
                            /
                          </span>
                          <span className="truncate">{pillar.label}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {pillar.detail}
                        </p>
                      </div>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* 02 — Dedicated Interactive 3D Tactile Workspace Stage */}
        <section
          id="workspace"
          aria-labelledby="workspace-stage-heading"
          className="scroll-mt-14 border-b border-border bg-background"
        >
          <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-14 sm:px-6 md:py-18">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="mono-tabular text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  01 / Interactive Ledger Stage
                </p>
                <h2
                  id="workspace-stage-heading"
                  className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
                >
                  Inspect every surface before signing in.
                </h2>
              </div>

              <div
                role="tablist"
                aria-label="Preview workspace modules"
                className="inline-flex self-start rounded-md border border-border bg-card p-0.5 md:self-auto"
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
                      onClick={() => handleSelectWorkspaceTab(tab.id)}
                      className={cn(
                        "inline-flex min-h-9 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors md:min-h-7",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <PerspectiveStageCard className="pb-5">
              {/* Stage Window Chrome */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-sidebar px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <BrandMark />
                  <span className="text-xs font-medium text-foreground">
                    {activeTab === "today"
                      ? "Folio · Today & Quick Capture"
                      : activeTab === "habits"
                        ? "Folio · Real-Calendar Habits Matrix"
                        : "Folio · Accountability Circle"}
                  </span>
                </div>
                <span className="mono-tabular text-[11px] text-muted-foreground">
                  {activeTab === "today"
                    ? "Optimistic mutations · ⌘K NLP"
                    : activeTab === "habits"
                      ? "0ms client scoring · Rest passes"
                      : "Selected scope · Owner IANA TZ"}
                </span>
              </div>

              {/* Active Interactive Tab Panel */}
              <div
                role="tabpanel"
                id={`landing-tabpanel-${activeTab}`}
                aria-labelledby={`landing-tab-${activeTab}`}
                className="min-h-[300px] p-4 sm:p-6"
              >
                {activeTab === "today" ? (
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                    <div className="space-y-3 lg:col-span-8">
                      <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2.5 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <Command
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
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
                                <Check
                                  className="size-2.5 stroke-[2.5]"
                                  aria-hidden="true"
                                />
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
                                  <Bell className="size-2.5" aria-hidden="true" />
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

                    <div className="flex flex-col justify-between gap-3 rounded-md border border-border bg-background p-4 lg:col-span-4">
                      <div className="space-y-2">
                        <p className="mono-tabular text-[10px] uppercase tracking-wider text-muted-foreground">
                          Durable Outbox Flow
                        </p>
                        <p className="text-xs font-medium text-foreground">
                          One keystroke parses date, timezone, and reminder.
                        </p>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          Completing a task atomically cancels pending reminders
                          and syncs any linked daily habit inside a single
                          database transaction.
                        </p>
                      </div>
                      <div className="space-y-1.5 border-t border-border pt-3 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Quick actions
                          </span>
                          <span className="mono-tabular text-foreground">
                            +15m / Done
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Reconciler
                          </span>
                          <span className="mono-tabular text-foreground">
                            5m Outbox
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : activeTab === "habits" ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Click any matrix cell to cycle Done → Rest pass →
                          Missed
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Switch scoring denominator at 0ms—rest passes never
                          break your streak.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div
                          role="group"
                          aria-label="Demo habit scoring mode"
                          className="inline-flex rounded-md border border-border bg-background p-0.5"
                        >
                          <button
                            type="button"
                            aria-pressed={demoScoringMode === "elapsed"}
                            onClick={() => setDemoScoringMode("elapsed")}
                            className={cn(
                              "min-h-9 rounded px-2.5 text-[11px] font-medium transition-colors md:min-h-6",
                              demoScoringMode === "elapsed"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            Elapsed-to-Date
                          </button>
                          <button
                            type="button"
                            aria-pressed={demoScoringMode === "full_month"}
                            onClick={() => setDemoScoringMode("full_month")}
                            className={cn(
                              "min-h-9 rounded px-2.5 text-[11px] font-medium transition-colors md:min-h-6",
                              demoScoringMode === "full_month"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            Full Month
                          </button>
                        </div>

                        <div className="mono-tabular flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
                          <span className="font-semibold text-done">
                            {habitStats.pct}%
                          </span>
                          <span className="text-muted-foreground">
                            ({habitStats.done}/{habitStats.scheduled})
                          </span>
                        </div>
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
                                className="mono-tabular px-2 py-2 text-center font-medium"
                              >
                                {d}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {demoHabits.map((row) => (
                            <tr key={row.id}>
                              <td className="max-w-[180px] truncate px-3 py-2 font-medium text-foreground">
                                {row.title}
                              </td>
                              {row.cells.map((cell, idx) => (
                                <td
                                  key={`${row.id}-${idx}`}
                                  className="px-1.5 py-1.5 text-center"
                                >
                                  <button
                                    type="button"
                                    aria-label={`Cycle ${row.title} day ${idx + 1}`}
                                    onClick={() =>
                                      toggleDemoHabitCell(row.id, idx)
                                    }
                                    className={cn(
                                      "mx-auto flex size-9 items-center justify-center rounded border text-[11px] font-medium transition-colors md:size-7",
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
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            Accountability Circle
                          </span>
                          <Badge
                            variant="outline"
                            className="h-5 border-collab/40 bg-collab/10 px-1.5 text-[10px] font-normal text-collab"
                          >
                            Selected Scope · Zero Leak
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Server-enforced commenting windows evaluated in the
                          owner&rsquo;s IANA timezone.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setCircleWindowOpen((prev) => !prev)}
                        className={cn(
                          "mono-tabular inline-flex min-h-9 items-center gap-1.5 rounded border px-3 py-1 text-[11px] font-medium transition-colors md:min-h-7",
                          circleWindowOpen
                            ? "border-done/40 bg-done/10 text-done"
                            : "border-border bg-muted text-muted-foreground"
                        )}
                      >
                        {circleWindowOpen ? (
                          <Flame className="size-3" aria-hidden="true" />
                        ) : (
                          <Lock className="size-3" aria-hidden="true" />
                        )}
                        {circleWindowOpen
                          ? "Window Open (click to lock)"
                          : "Locked until Sat 00:00"}
                      </button>
                    </div>

                    <div className="space-y-3 rounded-md border border-border bg-background p-4 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          Cycle W47 Review · 86% consistency
                        </span>
                        <span className="mono-tabular text-[11px] text-muted-foreground">
                          2 shared habits · 3 private hidden
                        </span>
                      </div>

                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {circleWindowOpen
                          ? "Review window is open — invited monitors can leave threaded cycle reflections and check-in reactions strictly on the habits you chose to share."
                          : "Comments are server-enforced locked outside your scheduled review window (403 CommentWindowClosedError) while quiet monochrome reactions stay available."}
                      </p>

                      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                        {(
                          [
                            { key: "ack", label: "Seen", icon: Check },
                            { key: "solid", label: "Solid", icon: Sparkles },
                            { key: "push", label: "Keep going", icon: Flame },
                          ] as const
                        ).map((item) => {
                          const Icon = item.icon;
                          const active = myReactions[item.key];
                          return (
                            <button
                              key={item.key}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleDemoReaction(item.key)}
                              className={cn(
                                "mono-tabular inline-flex min-h-9 items-center gap-1.5 rounded border px-2.5 text-xs transition-colors md:min-h-7",
                                active
                                  ? "border-foreground bg-primary text-primary-foreground"
                                  : "border-border bg-card text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <Icon className="size-3" aria-hidden="true" />
                              <span>{item.label}</span>
                              <span className="text-[10px] opacity-80">
                                {demoReactions[item.key]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </PerspectiveStageCard>
          </div>
        </section>

        {/* 03 — Asymmetric 3-Column Editorial Capability Bento */}
        <section
          id="capabilities"
          aria-labelledby="capabilities-heading"
          className="scroll-mt-14 border-b border-border"
        >
          <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-14 sm:px-6 md:py-16">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="mono-tabular text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  02 / Core System
                </p>
                <h2
                  id="capabilities-heading"
                  className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
                >
                  Built for daily clarity without visual noise.
                </h2>
              </div>
              <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                Every workflow runs on one cohesive data ledger: instant cached
                navigation, ACID transactions, and strict tenant isolation.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Bento Card 1 (Span 2) */}
              <article className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30 md:col-span-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-reminder">
                      <Bell className="size-3.5" aria-hidden="true" />
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
                    Press{" "}
                    <kbd className="mono-tabular rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground">
                      ⌘K
                    </kbd>{" "}
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
              <article className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30">
                <div className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <FileText
                      className="size-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
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
              <article className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30">
                <div className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-collab">
                    <Users className="size-3.5" aria-hidden="true" />
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
                className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30 md:col-span-2"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-done">
                      <Repeat2 className="size-3.5" aria-hidden="true" />
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

        {/* 04 — Architectural Craft & Privacy Strip */}
        <section
          id="principles"
          aria-labelledby="principles-heading"
          className="scroll-mt-14"
        >
          <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-14 sm:px-6 md:py-16">
            <div>
              <p className="mono-tabular text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                03 / Engineering Guarantees
              </p>
              <h2
                id="principles-heading"
                className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
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

        {/* 05 — Closing CTA */}
        <section className="border-t border-border bg-card">
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-14 text-center sm:px-6 md:py-16">
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
                    <ArrowRight className="ml-1.5 size-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-5 text-xs text-muted-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 sm:px-2">
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
