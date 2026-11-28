# Folio Product Review

Review of three proposals: a downloadable monthly performance report, the “challenge as rules engine” design, and daily-use improvements. Recommendation: build the report from derived analytics, adopt the challenge model with a leaner MVP, and prioritize friction removal over gamification.

**Status note.** Written against current `main`. **Shipped:** hardened chunked Excel/CSV history import, per-month habit rosters, dynamic month locking & PIN, future-month lock, 15-minute habit nudges, Accountability Circle, Operations Blueprints (Phases 1 & 2 — Explore, Collaboration RBAC, Guest Runner, Staleness Audits), 5-phase security/performance hardening, and Phase A/B/C habit extensions (metadata, 6 built-in + custom saved views, `Low-energy day` Today filter, miss reasons, excuse-range foundation, `/app/day/[date]` Day Ledger with lazy-written energy/sleep/notes/journal & computed rollups, and local `db:backup`/`db:restore` scripts). **In review:** accountability groups (#2), group weekly reviews (#3), and partner streak nudges (#4). Do not treat in-review features as shipped dependencies.

---

## 1. Downloadable Monthly Performance Report

**Verdict: build it.** It should be an export of data FOLIO already derives, not a new reporting database. Start with a printable monthly summary page plus CSV; add PDF generation later if needed.

### What to include

| Section | Contents |
| :--- | :--- |
| **Header** | Month, timezone, generated-at timestamp, data source (`live` / `imported workbook`), per-month habit roster version, and alias/merge notes. |
| **Headline KPIs** | Completion %, done / missed / skipped / unlogged counts, comparison with previous month, days elapsed vs. calendar days, current and best streak. |
| **Habit table** | Per habit: cadence and target, done ÷ scheduled, completion %, missed, skipped, unlogged, current streak, best streak, month-over-month trend, and any alias/merge provenance. |
| **Weekly rhythm** | Week 1–5 completion, weekday heatmap, best/worst weekday, and explicit “Week 3 is weakest” callout when the data supports it. |
| **Recovery after a miss** | How often a missed day is followed by recovery vs. another miss; “never miss twice” rate; habits most likely to cause a second miss. |
| **Numeric & cumulative goals** | Push-up sets vs. daily total, study hours vs. the 1,000-hour target, pages vs. the pace line, projected finish date, and hours/day still required. |
| **Cost & outcome** | Planned vs. actual time and money where tracked; weekly milestone status for reading, body metrics, or roadmap items. |
| **Challenges, if enabled** | Attempt number, current day, best previous attempt, restart cause, and the goal causing the most restarts. |
| **Accountability** | Accountability Circle review participation (shipped); optional group weekly-review participation and partner-nudge counts only if PRs #2–#4 merge. No social leaderboard. |
| **Reflection** | Prompts for “what worked”, “what broke”, and one or two focus habits for next month. Feed answers into the journal habit. |
| **Data-integrity appendix** | Backfilled dates, late logs, excused ranges, imported row counts, and reconciliation decisions. |

### Design rules

- **Derive, don’t store.** Compute from `habit_logs`, the proposed challenge `day_result`/run records, and settings snapshots. Store only generated file metadata if downloads must be reproducible.
- **Two formats:** CSV for raw rows and spreadsheet analysis; print-friendly HTML/PDF for the human summary. Use browser print CSS for MVP instead of adding a PDF dependency.
- **Stable identity.** Always export the canonical habit ID plus aliases so renames/merges remain explainable.
- **Timezone explicit.** Month boundaries and week numbers are meaningless without the owner’s IANA timezone.
- **Private by default.** No automatic sharing; journal text and money entries are omitted from the default PDF and require an explicit “include private notes” toggle.
- **Prompt at the right time.** Show a “Your October report is ready” in-app notification on the first day of the month; keep it dismissible.

**Suggested build order:** (1) monthly summary page + CSV, (2) downloadable/printable PDF, (3) prior-month comparison and pace projections, (4) scheduled first-of-month delivery.

---

## 2. Challenge-as-Rules-Engine Review

**Verdict: the core idea is right and fits FOLIO.** Habit logging remains the source of truth; the challenge layer only watches logs and decides pass/fail/restart. Keep the template/run separation and idempotent day finalization. Trim the first version so it does not duplicate the habit ledger.

### Keep

- **Template vs. run.** “75-Day Core Six” is reusable; attempt #1, #2, #3 are separate runs. Never overwrite a failed run—close it with a reason and spawn the next attempt.
- **Run state machine.** `scheduled → active → completed`, plus `active → failed → new run`, with optional `paused` / `abandoned`.
- **Day finalization job, not real-time checks.** Run after a grace cutoff with a deterministic ID; idempotency removes race conditions.
- **Core vs. tracked goals.** Only core goals gate the streak; tracked goals still feed completion/failure-rate insight. This keeps the full habit list useful without making the challenge brittle.
- **Local date + pinned timezone + grace cutoff.** Late-night logging can count for the previous day; travel requires an explicit timezone-change action.
- **Windowed goals use server `loggedAt`.** Do not let users type the wake-up time.
- **Lifelines, strictness, and start choice.** Lock at run start; default to “start tomorrow” to avoid instant mid-day failure.
- **Attempt analytics.** Best streak, “you reached Day 41 last time”, and top restart cause are high-value motivators that fall out of run history for free.
- **Cost/outcome/pace.** Planned time/money, outcome milestones, and cumulative pace indicators (“12 pages behind schedule”) add meaning beyond pass/fail.

### Change before building

1. **Do not create a parallel `goal_log` table with raw values.** FOLIO already has `habit_logs`. Link each challenge goal to a habit and store only derived `day_result` + run/goal references. Dual-writing logs invites drift.
2. **Derive metrics.** Completion rate, failure rate, longest streak, and attempt count belong in queries/derived views, not persisted counters.
3. **Do not make consequences per-goal in MVP.** Start with one run-level consequence policy. Per-goal money penalties and partner actions can be optional overrides in v3.
4. **Allow audited edits.** Instead of permanently locking logs after finalization, allow edits with `editedAt`, `finalizedAt`, and a revision/audit note. A strict app that cannot correct a mistaken backfill loses trust.
5. **Use existing primitives.** Emit `challenge.day_finalized`, `challenge.run_failed`, and `challenge.run_completed` through the current event bus/Inngest registry with deterministic IDs. The Inngest cron and dedupe patterns are already proven by reminders and the shipped 15-minute habit nudges; partner streak nudges are still in review (PR #4).
6. **Respect existing semantics.** `skipped` is a rest pass and must not fail a core goal; `weekly_target` cadence must use the same rules as the rest of FOLIO; daily totals can be sums of multiple log entries.
7. **Reuse the nudge pattern, not an in-review feature.** A failed run should be able to request encouragement through the existing event bus/habit-nudge patterns; do not depend on partner-streak nudges (PR #4) until they merge.

### FOLIO build order

- **MVP:** template/run model, binary + count goals, day-finalization cron, restart-on-fail, Day X/N streak display.
- **v2:** windowed goals, cumulative goals with pace, completion/failure dashboard, attempt history.
- **v3:** run-level lifelines, consequence plugins (penalty ledger, forfeit task, cooldown), milestones with periodic entries.
- **v4:** shareable/duplicable templates and group challenges.

**Skip for now:** per-goal consequence graphs, photo/weigh-in milestone types, a money-settlement workflow, and challenge leaderboards.

---

## 3. Daily-Use Improvement Review

**Verdict: the proposed five are the right instinct—remove friction and surface insight from existing data before adding new modules.** Some are already shipped in FOLIO; the rest should be sequenced by daily impact.

### Priority

1. **History import, per-month habit rosters & future-month lock — shipped.** The hardened chunked Excel/CSV importer, `habit_month_rosters`, carry-over editing, and future-month lock are on `main`. Keep alias/merge provenance visible.
2. **Personal weekly review — not shipped; group version in review (#3).** Build the personal view next: every Sunday, show completion, best/worst habit, runs against target, hours logged, and one or two focus habits for the next week. Treat the group board only as a future pattern, not a shipped dependency.
3. **Low-energy day mode.** A single toggle collapses Today to the six anchor habits. Implement it as a saved **Minimum Day preset** that filters the view; do not create shadow habits or auto-write logs. The win is psychological: “I kept the minimum” instead of “I failed.”
4. **Range-based excusing.** Let the user pick a date range and mark affected days `skipped` with reason `excused` in one action, plus bulk undo. Respect weekly targets and never overwrite existing `done` logs.
5. **Weekly-target habits on Today.** Show “2 of 3, one to go” and do not count blank days as misses. The analytics layer already knows this; it needs better surfacing.
6. **Backfill + short undo.** Make yesterday easy to edit and add a 5–10 second undo after every tap. This pairs naturally with range excusing.
7. **Smarter, fewer reminders.** One conditional midday push-up nudge, one 5 PM workday planning prompt, and one ride-home expense prompt beat fifteen per-habit alarms.
8. **Numeric habits + 1,000-hour screen.** Add +50 push-up buttons, study-hour entries, and a cumulative goal view with pace, projected finish date, and required hours/day.
9. **Offline-first, home-screen widget, biometric/app lock.** High value but larger platform work. The scrypt-hashed Accountability PIN for month locking is shipped; device biometric lock is not. Do export/backup before adding more social surface area.

### Insight worth adding

- **Recovery after a miss:** “After a missed day, you recover the next day 62% of the time.” A “never miss twice” nudge is more useful than another streak counter.
- **Habit-to-habit patterns:** test short sleep → missed wake-up, planning tomorrow → next-day score, etc. Require a minimum sample (e.g., 30 paired days) and label results as *patterns, not proof*.
- **Weekday / week-of-month heatmap:** the Week 3 weakness is already visible in imported data; make it obvious in the UI.
- **Pace indicators on cumulative goals:** pass/fail alone hides slow drift.

### De-prioritize

Badges, points, leaderboards, an AI coach, a dozen chart types, and a budget module. They add work and noise before the core daily loop is effortless. Social features should stay limited to the shipped, explicit, zero-leak Accountability Circle; member-only groups and partner nudges remain in review (PRs #2–#4).

---

## Bottom line

- **Report:** derive from existing logs, export CSV + printable summary, include recovery and pace—not just percentages.
- **Challenges:** adopt the template/run rules-engine concept, but bind goals to existing habits and keep consequence plugins out of MVP.
- **Daily use:** finish the personal weekly review, Minimum Day mode, range excusing, and weekly-target surfacing; leave gamification and broad social features until retention is stable and PRs #2–#4 have merged.
