# Folio — System Architecture

> Visual-first architectural blueprint for **Folio**: a personal-first productivity workspace unifying **Tasks**, **Markdown Notes**, **Durable Timed Reminders**, **Shared Projects (RBAC)**, **Real-Calendar Habit Tracking with Bidirectional Task Sync**, an **Accountability Circle** with dynamic per-monitor review windows, **Unified Chronological Activity Timelines**, and an **Env-Synced Operations Admin Portal**.

---

## 1. System Context & Edge Topology

Every request passes through a defense-in-depth edge boundary (`next.config.ts` security headers + `src/proxy.ts` cache isolation) before hitting `force-dynamic` App Router handlers, a strict SOLID domain core, pure zero-I/O domain engines, and decoupled persistence/workflow adapters.

```mermaid
flowchart TB
  subgraph Client["Client Runtime (Browser / Installed PWA)"]
    UI["Next.js React 19 UI — Warm Paper / Carbon Ink Mira, TanStack Query v5 + Zustand v5, Lazy Quick Capture & Recharts"]
    PWA["PWA Runtime — PwaLaunchSplash, StandaloneRootGuard (/ -> /login), ServiceWorkerRegistrar"]
    SW["Service Worker (/sw.js) — Public Shell Precache + /offline Fallback + Web Push Quick Actions (Zero Private Caching)"]
  end

  subgraph Edge["Vercel Edge & Next.js 16 Boundary"]
    HDR["next.config.ts Headers — CSP, DENY, nosniff, Referrer-Policy, staleTimes (dynamic 60s / static 180s)"]
    PRX["src/proxy.ts — Optimistic /app/* Guard + private, no-store on /app/* & /invite/*"]
  end

  subgraph App["Next.js App Router (force-dynamic)"]
    RSC["RSC Pages & Layouts (/, /login, /offline, /app/*, /app/admin, /app/habits*, /invite/*)"]
    ACT["Server Actions (src/actions/*) — Zod -> Auth -> Service -> Targeted Query Invalidation"]
    API["Route Handlers (/api/workspace/* x8, /api/admin/overview, /api/auth, /api/inngest, /api/health, /api/reminders, /api/notifications)"]
  end

  subgraph Core["SOLID Domain Core (src/server/)"]
    DOM["Pure Domain Engines (src/server/domain/) — Habit Analytics & Comment-Window Policy"]
    SVC["12 Domain Services — Task, Note, Reminder, Project, Invite, Habit, Monitor, Comment, Account, Notification, Preferences, Admin"]
    DAL["Scoped DAL & Direct-Turso Guards (requireSession, requireAdmin, assertProjectRole, canUserReadEntity, HabitMonitorReadDal, withDbRetry)"]
    PRV["Provider Ports (EventBus, NotificationChannel x3, RateLimiter x4, UnreadCounterCache, AuthEmailDispatcher)"]
  end

  subgraph Infra["Persistence & External Services"]
    DB[("Turso / libSQL (SQLite WAL) — 25 Tables, ULID PKs, Cascading FKs, CHECK & Partial Unique Indexes")]
    RDS[("Redis 3-Tier (Upstash -> ioredis -> Memory) — RateLimiter & UnreadCounter ONLY")]
    ING["Inngest v4 Durable Engine — 13 Functions, Plan-Safe Concurrency (default 5, crons 1) & LIMIT 200 Crons"]
    EXT["External Delivery & Identity (Resend, VAPID Web Push, Google OAuth)"]
  end

  UI --> HDR --> PRX --> RSC
  UI --> ACT
  UI --> API
  SW -->|"POST /api/reminders/quick-action"| API

  RSC --> DAL
  RSC --> SVC
  ACT --> SVC
  ACT --> PRV
  API --> SVC
  API --> PRV
  API <-->|"POST/PUT /api/inngest"| ING

  SVC --> DOM
  SVC --> DAL --> DB
  SVC --> PRV
  PRV --> RDS
  PRV --> ING
  PRV --> EXT
  ING --> DOM
  ING --> SVC
  ING --> DAL
  ING --> EXT
```

---

## 2. SOLID Clean Layering & Dependency Direction

Dependencies point strictly inward toward `src/server/db/` and `src/server/domain/`. Pure domain calculations (`habit-analytics.ts`, `comment-window-policy.ts`, `habit-import.ts`, `habit-evolution.ts`) have zero DB or network imports, while every service accepts repositories and providers via constructor injection (DIP) so all 26 Vitest suites (112 tests) execute offline against ephemeral SQLite databases.

```mermaid
flowchart LR
  subgraph Presentation["Presentation & Client State"]
    COMP["src/components/ (Pure Mira UI + useOptimistic + Lazy Dynamic Chunks — Zero DB/Provider imports)"]
    STATE["Client State Split: TanStack Query v5 (User-Scoped Server Cache) + Zustand v5 (Non-PII UI Chrome)"]
  end

  subgraph Boundary["App Boundary"]
    APP["src/app/ (RSC Pages, Layouts, API Routes)"]
    ACTS["src/actions/ (Zod Validation -> ActionResult)"]
  end

  subgraph Domain["Pure Domain & Service Orchestration"]
    PURE["src/server/domain/ (habit-analytics, comment-window-policy — Zero I/O)"]
    SVCS["src/server/services/ (12 ACID Services + Env Admin Role Sync — Zero Network I/O inside tx)"]
  end

  subgraph DataAndPorts["Data Access & Provider Ports"]
    DALS["src/server/dal/ (Scoped Repos, Auth/Admin Guards, Zero-Leak HabitMonitorReadDal)"]
    PORTS["src/server/providers/ (EventBus, NotificationChannel, RateLimiter, UnreadCounterCache, AuthEmail)"]
  end

  subgraph Foundations["Schema & Concrete Adapters"]
    SCHEMA["src/server/db/ (25 Drizzle Tables, Relations, WAL Client, withDbRetry)"]
    ADAPT["External Adapters (Inngest v4, Resend, web-push, Upstash / ioredis / InMemory)"]
  end

  COMP --> STATE
  STATE -->|"GET /api/workspace/* (private, no-store)"| APP
  COMP --> ACTS
  COMP -.->|"Pure types/formatters"| PURE
  APP --> DALS
  APP --> SVCS
  ACTS --> SVCS
  SVCS --> PURE
  SVCS --> DALS
  SVCS --> PORTS
  DALS --> SCHEMA
  PORTS --> ADAPT
```

| Provider Interface | Concrete Implementations | Strict Responsibility |
| :--- | :--- | :--- |
| `EventBus` | `InngestEventBus`, `InMemoryEventBus` | Post-commit durable event emission with deterministic deduplication `id` |
| `NotificationChannel` (OCP) | `InAppNotificationChannel`, `WebPushNotificationChannel`, `EmailNotificationChannel` | Isolated per-channel delivery (`Promise.allSettled`, `404`/`410` auto-prune, email fallback) |
| `RateLimiter` (ISP) | `UpstashRateLimiter`, `IoRedisRateLimiter` (Lua), `InMemoryRateLimiter` | Sliding-window protection (`auth` 10/10m, `project_invite` 20/1h, `habit_monitor_invite` 20/1h, `test_push` 5/5m) |
| `UnreadCounterCache` (ISP) | `UpstashUnreadCounterCache`, `IoRedisUnreadCounterCache`, `InMemoryUnreadCounterCache` | `300s` TTL unread badge cache only (**never** used for security, RBAC, or monitor access) |
| `AuthEmailDispatcher` | `InngestAuthEmailDispatcher`, `ResendAuthEmailDispatcher`, `ConsoleAuthEmailDispatcher` | Verification & password-reset emails without logging raw tokens |

---

## 3. Unified Entity-Relationship Model (25 Tables)

All primary keys are sortable ULIDs (`ulidx`), all timestamps are UTC Unix epoch milliseconds (`integer`) paired with explicit IANA timezone strings and calendar date keys (`YYYY-MM-DD`), and referential integrity is enforced by SQLite/Turso (`PRAGMA foreign_keys = ON`, `CHECK` constraints, partial unique indexes, and cascading deletes).

### 3A. Auth, Admin Audits, Projects, Tasks, Notes & Reminders (14 Tables)

```mermaid
erDiagram
  users {
    text id PK "ULID"
    text email UK
    boolean email_verified
    text role "user | admin (ADMIN_EMAILS synced)"
    boolean is_suspended "blocks sessions & access"
    text timezone "IANA default UTC"
    boolean email_reminders_enabled
  }
  admin_audit_logs {
    text id PK "ULID"
    text actor_user_id FK "nullable SET NULL -> users"
    text action "admin.roles_synced..user_suspended"
    text target_type "system | user | reminder | session"
    text target_id "nullable"
    text metadata_json
    integer created_at
  }
  sessions {
    text id PK
    text user_id FK "CASCADE"
    text token UK
    integer expires_at
  }
  accounts {
    text id PK
    text user_id FK "CASCADE"
    text provider_id
    text account_id
  }
  verifications {
    text id PK
    text identifier
    text value
    integer expires_at
  }
  projects {
    text id PK "ULID"
    text owner_id FK "CASCADE"
    text name
    text color_token
    boolean is_archived
  }
  project_members {
    text project_id PK "FK CASCADE"
    text user_id PK "FK CASCADE"
    text role "CHECK owner, editor, viewer"
    integer joined_at
  }
  project_invitations {
    text id PK "ULID"
    text project_id FK "CASCADE"
    text invited_by_id FK "CASCADE"
    text email
    text role "CHECK editor, viewer"
    text token_hash UK "SHA-256 hex"
    text status "CHECK pending..expired"
    integer expires_at
  }
  tasks {
    text id PK "ULID"
    text user_id FK "CASCADE"
    text project_id FK "nullable CASCADE"
    text assignee_id FK "nullable SET NULL"
    text habit_id FK "nullable SET NULL -> habits"
    text habit_date_key "nullable YYYY-MM-DD"
    text status "CHECK todo, in_progress, done, archived"
    text priority "CHECK none, low, medium, high"
    integer due_at
    text position "Fractional key <= 32 chars"
  }
  notes {
    text id PK "ULID"
    text user_id FK "CASCADE"
    text project_id FK "nullable CASCADE"
    text title
    text content
    text tags_json
    boolean is_pinned
  }
  project_activities {
    text id PK "ULID"
    text project_id FK "CASCADE"
    text actor_id FK "nullable SET NULL"
    text action
    text entity_type
    text entity_id
  }
  reminders {
    text id PK "ULID"
    text user_id FK "CASCADE"
    text task_id FK "nullable CASCADE"
    text note_id FK "nullable CASCADE"
    integer remind_at "UTC ms"
    text timezone "IANA"
    text status "CHECK pending_far..cancelled"
    integer version "CHECK >= 1"
    integer dispatched_at "Outbox timestamp"
  }
  push_subscriptions {
    text id PK "ULID"
    text user_id FK "CASCADE"
    text endpoint UK "Atomic UPSERT owner"
    text p256dh
    text auth
  }
  notifications {
    text id PK "ULID"
    text user_id FK "CASCADE"
    text type
    text entity_type
    text entity_id
    boolean is_read
  }

  users ||--o{ sessions : "holds"
  users ||--o{ accounts : "links"
  users ||--o{ projects : "owns"
  users ||--o{ project_members : "joins"
  projects ||--o{ project_members : "has"
  projects ||--o{ project_invitations : "issues"
  users ||--o{ project_invitations : "sends"
  users ||--o{ tasks : "creates"
  users ||--o{ tasks : "assigned"
  projects ||--o{ tasks : "contains"
  users ||--o{ notes : "authors"
  projects ||--o{ notes : "contains"
  projects ||--o{ project_activities : "audits"
  users ||--o{ project_activities : "triggers"
  users ||--o{ reminders : "owns"
  tasks ||--o{ reminders : "task_id CASCADE"
  notes ||--o{ reminders : "note_id CASCADE"
  users ||--o{ push_subscriptions : "registers"
  users ||--o{ notifications : "receives"
  users ||--o{ admin_audit_logs : "records"
```

### 3B. Habits Ledger, Per-Month Rosters & Accountability Circle (11 Tables)

Anchored to `users`, `projects`, and `tasks(habit_id)` via strict cascading and `SET NULL` foreign keys.

```mermaid
erDiagram
  users {
    text id PK "ULID"
    text timezone "Owner policy IANA TZ"
  }
  projects {
    text id PK "ULID"
  }
  tasks {
    text id PK "ULID"
    text habit_id FK "nullable SET NULL"
    text habit_date_key "nullable YYYY-MM-DD"
  }
  habit_tracker_settings {
    text user_id PK "FK CASCADE -> users"
    integer week_starts_on "CHECK 0 or 1"
    text default_comment_mode "weekly_window, interval_days, anytime"
    integer default_window_start_day "0..6"
    text default_window_start_time "HH:mm"
    integer default_window_end_day "0..6"
    text default_window_end_time "HH:mm"
    integer default_interval_days "nullable >= 1"
    text default_interval_anchor_date "nullable YYYY-MM-DD"
    integer default_interval_open_hours "default 24"
    boolean allow_reactions_when_locked
    text evening_checkin_time "nullable HH:mm"
  }
  habits {
    text id PK "ULID"
    text user_id FK "CASCADE"
    text title
    text cadence_type "daily, specific_days, weekly_target"
    text scheduled_days_json "JSON int[0..6]"
    integer weekly_target_count "nullable 1..7"
    text start_date "YYYY-MM-DD"
    text preferred_time "nullable HH:mm"
    text linked_project_id FK "nullable SET NULL -> projects"
    boolean auto_sync_daily_task
    text position "Fractional key"
    boolean is_archived
  }
  habit_logs {
    text id PK "ULID"
    text habit_id FK "CASCADE"
    text user_id FK "CASCADE"
    text date_key "YYYY-MM-DD"
    text status "CHECK done, missed, skipped"
    text note
    boolean is_backfilled_late
  }
  habit_import_aliases {
    text id PK "ULID"
    text user_id FK "CASCADE"
    text habit_id FK "CASCADE"
    text source_title
    text normalized_title "UNIQUE(user_id, normalized_title)"
    text first_seen_date_key
    text last_seen_date_key
  }
  habit_month_rosters {
    text user_id PK "FK CASCADE -> users"
    text habit_id PK "FK CASCADE -> habits"
    text year_month PK "YYYY-MM"
    integer created_at
  }
  habit_monitors {
    text id PK "ULID"
    text owner_id FK "CASCADE"
    text monitor_user_id FK "CASCADE"
    text scope "CHECK all, selected"
    text status "CHECK active, revoked"
    boolean use_custom_policy
    text custom_comment_mode "nullable override"
    integer custom_interval_days "nullable 2..30"
    integer custom_interval_open_hours "nullable 1..168"
    boolean custom_allow_reactions_when_locked
    integer revoked_at
  }
  habit_monitor_items {
    text monitor_id PK "FK CASCADE -> habit_monitors"
    text habit_id PK "FK CASCADE -> habits"
  }
  habit_monitor_requests {
    text id PK "ULID"
    text owner_id FK "CASCADE"
    text target_user_id FK "nullable CASCADE"
    text target_email "normalized lowercase"
    text token_hash UK "nullable SHA-256 hex"
    text scope "all, selected"
    text selected_habit_ids_json
    text proposed_policy_json
    text status "pending, accepted, declined, revoked, expired"
    integer expires_at
  }
  habit_weekly_snapshots {
    text id PK "ULID"
    text owner_id FK "CASCADE"
    text cycle_key "YYYY-Www or INT-..."
    text period_start_date
    text period_end_date
    text metrics_json "Per-habit metrics for scoped projection"
  }
  habit_comments {
    text id PK "ULID"
    text owner_id FK "CASCADE"
    text author_id FK "CASCADE"
    text cycle_key
    text target_date_key "nullable YYYY-MM-DD"
    text target_habit_id FK "nullable SET NULL -> habits"
    text parent_comment_id FK "nullable CASCADE -> habit_comments"
    text body
  }
  habit_reactions {
    text id PK "ULID"
    text owner_id FK "CASCADE"
    text author_id FK "CASCADE"
    text cycle_key
    text target_date_key "nullable YYYY-MM-DD"
    text reaction_type "CHECK ack, solid, push"
  }

  users ||--o| habit_tracker_settings : "configures"
  users ||--o{ habits : "tracks"
  projects ||--o{ habits : "links"
  habits ||--o{ tasks : "syncs daily task"
  habits ||--o{ habit_logs : "records"
  users ||--o{ habit_logs : "logs"
  users ||--o{ habit_monitors : "shares as owner"
  users ||--o{ habit_monitors : "monitors as peer"
  habit_monitors ||--o{ habit_monitor_items : "scopes"
  habits ||--o{ habit_monitor_items : "included in"
  users ||--o{ habit_monitor_requests : "invites"
  users ||--o{ habit_monitor_requests : "receives"
  users ||--o{ habit_weekly_snapshots : "caches cycle"
  users ||--o{ habit_comments : "board owner"
  users ||--o{ habit_comments : "authors"
  habits ||--o{ habit_comments : "referenced"
  habit_comments ||--o{ habit_comments : "replies"
  users ||--o{ habit_reactions : "board owner"
  users ||--o{ habit_reactions : "reacts"
```

**Schema Guardrails:**
- **Zero Polymorphic FK Drift:** `reminders` enforces `CHECK ((task_id IS NOT NULL AND note_id IS NULL) OR (task_id IS NULL AND note_id IS NOT NULL))` for clean cascading deletes.
- **Self-Monitoring & Ledger Uniqueness:** `habit_monitors` enforces `CHECK (owner_id != monitor_user_id)` and `UNIQUE(owner_id, monitor_user_id)`; `habit_logs` enforces `UNIQUE(habit_id, date_key)`; `habit_weekly_snapshots` enforces `UNIQUE(owner_id, cycle_key)`.
- **Nullable-Safe Partial Unique Indexes:** Because SQLite treats `NULL != NULL` in standard unique indexes, `habit_reactions` uses two partial unique indexes: `(owner_id, author_id, cycle_key, target_date_key, reaction_type) WHERE target_date_key IS NOT NULL` and `(owner_id, author_id, cycle_key, reaction_type) WHERE target_date_key IS NULL`.
- **Hot-Path Composite Indexes:** `reminders(status, dispatched_at, updated_at)`, `reminders(status, remind_at)`, `tasks(habit_id, habit_date_key)`, `habits(is_archived, preferred_time)`, `habit_logs(user_id, date_key)`, `habit_monitors(monitor_user_id, status)`, `habit_comments(owner_id, cycle_key, created_at)`.

---

## 4. Request Lifecycle, Auth & Multi-Tenant Isolation

Every authenticated read and mutation enforces defense-in-depth directly against Turso—never trusting proxy cookies or cached Redis values for security—and keeps external network I/O strictly outside SQLite transactions.

```mermaid
sequenceDiagram
  autonumber
  actor User as Browser / PWA
  participant Proxy as src/proxy.ts
  participant Action as Server Action / RSC / Route
  participant Guard as Direct-Turso DAL Guards
  participant Service as Domain Service
  participant Turso as Turso / libSQL
  participant Ext as Inngest / Redis / Resend

  User->>Proxy: Request /app/* or /invite/*
  Proxy-->>User: Attach Cache-Control private, no-store (redirect /app/* if no cookie)
  Proxy->>Action: Forward to force-dynamic RSC / Action / Route

  Action->>Action: Zod schema validation
  Action->>Guard: requireSession() via Better Auth headers
  Guard->>Turso: Validate live session & user
  alt Unauthenticated
    Guard-->>User: 401 Unauthorized or Redirect /login
  end

  Action->>Service: Invoke domain query or command
  Service->>Guard: assertProjectRole() / canUserReadEntity() / assertActiveHabitMonitor()
  Guard->>Turso: Direct PK/unique lookup (project_members or habit_monitors WHERE status='active')
  alt Unauthorized, Revoked, or Cross-Tenant IDOR
    Guard-->>User: 403 ForbiddenError (or 403 CommentWindowClosedError)
  end

  Note over Service,Turso: Zero external network I/O inside db.transaction() ; SELECT-first reads avoid SQLite write locks
  Service->>Turso: withDbRetry() -> BEGIN ACID transaction
  Service->>Turso: Tenant-scoped or selective-scope query/mutation (HabitMonitorReadDal strips unshared habits)
  Turso-->>Service: COMMIT

  Service->>Ext: Post-commit side-effects (EventBus / UnreadCounterCache)
  Action-->>User: ActionResult + revalidatePath()
```

**Authentication & Tenant Security Controls:**
- **Environment-Gated Providers (Google-Only in Production):** Better Auth runs **Google OAuth exclusively in production** (`NODE_ENV === "production"`, hiding email/password UI, redirecting `/register`, `/forgot-password`, `/reset-password`, and `/verify-email` to `/login`, disabling `emailAndPassword`, and returning `403 AUTH_METHOD_DISABLED` on credential API endpoints) while keeping **both Email/Password and Google OAuth** active in local development. Better Auth enforces `requireEmailVerification: true`, `revokeSessionsOnPasswordReset: true`, `HttpOnly` / `SameSite=Lax` / `Secure` (prod) cookies, and open-redirect sanitization (`sanitizeCallbackUrl`).
- **Env-Driven Admin Role Sync & Zero-Discovery Portal (`/app/admin`):** `ADMIN_EMAILS` (comma-separated allowlist, fail-closed when unset/empty) is reconciled automatically across 3 layers: Next.js Node boot (`src/instrumentation.ts`), Better Auth `databaseHooks.user.create/update` (paired with `input: false` on `role` and `isSuspended` to block mass-assignment), and live runtime enforcement (`requireAdmin()` / `resolveLiveAdminStatus()`). Matching **verified** users are promoted to `role = "admin"` and any admin removed from `ADMIN_EMAILS` is immediately demoted back to `role = "user"` without re-login. Non-admins never see the sidebar link, receive HTTP `404` with `"Not Found"` metadata on `/app/admin`, and receive HTTP `403` (`private, no-store`) on `/api/admin/overview` and admin Server Actions. Suspended users (`isSuspended = true`) have all sessions revoked and are blocked in `requireSession()`. Every operational admin action appends an immutable record to `admin_audit_logs` while enforcing a privacy boundary (aggregated KPIs, 14-day Recharts trends, live subsystem probes, and user metadata only — never exposing private task/note/habit bodies).
- **Account Takeover Prevention:** `databaseHooks.account.create.before` ([auth-policy.ts](../src/server/auth-policy.ts)) rejects OAuth auto-linking into any pre-existing unverified credential account (`emailVerified === false`).
- **Zero-Leak Selective Scope:** `DrizzleHabitMonitorReadDal` resolves `habit_monitors` + `habit_monitor_items` in Turso first and filters habits, logs, analytics, snapshots, and `target_habit_id` comments to `allowedHabitIds` before returning a payload—unshared habits never cross the DAL boundary.

---

## 5. Durable Automation Engine: Reminders, Habit Nudges & Review Digests

All asynchronous scheduling and background sweeps run on **Inngest v4** (`13` registered functions in [route.ts](../src/app/api/inngest/route.ts)) with deterministic deduplication IDs, bounded `LIMIT 200` pagination inside `step.run()`, singleton cron concurrency (`1`), configurable worker concurrency (`INNGEST_CONCURRENCY_LIMIT`, default `5` for Inngest Free Plan), and `retries: 4`.

### 5A. Hybrid Reminder State Machine & Outbox Reconciliation

```mermaid
stateDiagram-v2
  [*] --> pending_far : remindAt > now + 14d
  [*] --> scheduled : remindAt <= now + 14d (dispatched_at = NULL)

  pending_far --> scheduled : Daily UTC Sweeper (LIMIT 200 batches)
  pending_far --> cancelled : User cancels or parent completed/deleted

  scheduled --> scheduled : Reschedule or Snooze <= 14d (version + 1, dispatched_at = NULL)
  scheduled --> pending_far : Reschedule > 14d (version + 1)
  scheduled --> sent : Atomic claimForDelivery (status = scheduled, version = N)
  scheduled --> cancelled : Cancelled, task done, deleted, or access revoked

  sent --> scheduled : Snooze from Notification Bell or Service Worker (version + 1)
```

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Svc as ReminderService
  participant Turso as Turso / libSQL
  participant Cron as Reconciler (*/5m) & Sweeper (0 0 * * *)
  participant Sched as scheduleReminderFn (concurrency 5, retries 4)
  participant Ch as In-App / Web Push / Email

  User->>Svc: Create or Snooze reminder (<= 14d)
  Svc->>Turso: ACID tx: canUserReadEntity() -> persist status=scheduled, dispatched_at=NULL, version=V
  Turso-->>Svc: COMMIT

  Svc->>Sched: Post-commit inngest.send(id = reminder-sched-{id}-v{V})
  alt Emit succeeds
    Svc->>Turso: markDispatched(id, V, now) -> stamp dispatched_at
  else Transient Inngest outage
    Cron->>Turso: Every 5m: SELECT scheduled rows WHERE dispatched_at IS NULL LIMIT 200
    Cron->>Sched: Batched deterministic inngest.send()
    Cron->>Turso: Stamp dispatched_at
  end

  Note over Sched: cancelOn app/reminder.cancelled or app/reminder.rescheduled
  Sched->>Sched: step.sleepUntil(remindAt)
  Sched->>Turso: Step 1: canUserReadEntity(userId, taskId or noteId)

  alt Access revoked while sleeping
    Sched->>Turso: cancelIfRevoked(id, V) -> status = cancelled (ZERO dispatch)
  else Still authorized
    Sched->>Turso: Step 2: Atomic UPDATE SET status=sent WHERE id=? AND status=scheduled AND version=V RETURNING *
    alt Claimed atomically (1 row)
      Sched->>Ch: Steps 3-6: Load scoped title -> InApp + WebPush (prune 404/410) + Email fallback
    end
  end
```

### 5B. Habit Nudges & Accountability Review Open Digests

```mermaid
flowchart TB
  subgraph Nudges["Habit Nudges (Every 15 Minutes — */15 * * * *)"]
    NCron["habitNudgeDispatcherFn — LIMIT 200 paginated step.run()"] --> NWin["Match user IANA TZ 15m bucket (habit.preferredTime or eveningCheckinTime)"]
    NWin --> NEmit["Emit app/habit.nudge (id = habit-nudge-{userId}-{dateKey}-{slot})"]
    NEmit --> NDel["deliverHabitNudgeFn (concurrency 5, retries 4)"]
    NDel --> NDedup["DB dedup check + live re-verify still active & unlogged today"]
    NDedup --> NCh["InApp + WebPush + Email -> /app/habits"]
  end

  subgraph Digests["Review Window Open Digests (Hourly — 0 * * * *)"]
    DCron["habitReviewDigestCronFn — LIMIT 200 active monitor pairs"] --> DEval["resolveEffectivePolicy() + evaluateCommentWindow(ownerTZ)"]
    DEval --> DLook{"Opened within 65m lookback?"}
    DLook -->|Yes| DEmit["Emit app/habit.review_digest (id = habit-review-open-{monitorId}-{cycleKey})"]
    DEmit --> DDel["deliverHabitReviewDigestFn (concurrency 5, retries 4)"]
    DDel --> DVerify["DB dedup + live Turso check status='active'"]
    DVerify --> DSnap["Upsert habit_weekly_snapshots -> compute % strictly over allowedHabitIds"]
    DSnap --> DCh["InApp + WebPush + Email -> /app/habits/circle/{ownerId}"]
  end

  subgraph AsyncMail["Event-Driven Circle & Auth Delivery (concurrency 5, retries 4)"]
    EV["sendAuthEmailFn · sendTestReminderFn · sendProjectInviteFn · sendHabitMonitorRequestFn · sendHabitMonitorInviteFn · sendHabitCommentNotificationFn"]
  end
```

**Cascade Cancellation on Delete:** Before deleting any task, note, project, or user account, services collect all active `scheduled` reminders across all affected members inside the transaction, commit the cascading SQLite delete, and emit batched `app/reminder.cancelled` events afterward.

---

## 6. Collaboration, Habits Sync & Accountability Circle

### 6A. Shared Projects RBAC & Cryptographic Invitations

```mermaid
sequenceDiagram
  autonumber
  actor Owner
  actor Invitee
  participant RL as RateLimiter (project_invite 20/hr)
  participant InvSvc as ProjectInviteService
  participant Turso as Turso / libSQL
  participant Mail as sendProjectInviteFn -> Resend

  Owner->>InvSvc: Invite email as editor or viewer
  InvSvc->>Turso: assertProjectRole(projectId, ownerId, owner)
  InvSvc->>RL: limit(project_invite, ownerId)
  InvSvc->>InvSvc: CSPRNG 32B base64url token -> SHA-256 token_hash
  InvSvc->>Turso: ACID tx: reject duplicates -> INSERT token_hash (7d TTL) + activity
  InvSvc->>Mail: Post-commit app/project.invited
  InvSvc-->>Owner: Return one-time copyable /invite/[rawToken]

  Invitee->>InvSvc: GET /invite/[rawToken] (private, no-store)
  InvSvc->>Turso: Lookup SHA-256(rawToken) -> non-sensitive preview
  Invitee->>InvSvc: Accept invitation (verified matching email)
  InvSvc->>Turso: withDbRetry() -> ACID UPDATE SET status=accepted WHERE status=pending AND expires_at > now RETURNING *
  alt 1 row claimed
    InvSvc->>Turso: INSERT project_members + INSERT project_activities
  else 0 rows (replayed or concurrent race)
    Turso-->>Invitee: 409 ConflictError (strictly 1 winner)
  end
```

| Capability | `owner` | `editor` | `viewer` | Non-Member |
| :--- | :---: | :---: | :---: | :---: |
| View tasks, notes & activity feed | Yes | Yes | Yes | `403` |
| Attach, snooze & cancel **own private reminders** on project items | Yes | Yes | **Yes** | `403` |
| CRUD project tasks, notes & member task assignments | Yes | Yes | `403` | `403` |
| Project settings, archive/delete, invites & member role management | Yes | `403` | `403` | `403` |
| Access another user's personal Inbox tasks or unlinked notes | `403` | `403` | `403` | `403` |

### 6B. Task ↔ Habit ACID Sync, Smart Dual Invites & Dynamic Comment Windows

```mermaid
flowchart TB
  subgraph Sync["Two-Way ACID Task <-> Habit Sync"]
    HLog["HabitService.logHabitDay(habitId, dateKey, done/missed/skipped)"] --> HTx["ACID tx: upsert habit_logs(habit_id, date_key) + sync linked tasks(habit_id, habit_date_key)"]
    TTog["TaskService.toggleTaskComplete(taskId)"] --> TCheck{"task.habitId && task.habitDateKey?"}
    TCheck -->|Yes| TTx["ACID tx: update task status + upsert/remove habit_logs row (never recurses)"]
    Auto["Habit with autoSyncDailyTask = true"] --> Lazy["Lazily materialize today's task on /app/today or /app/habits read"]
  end

  subgraph DualInvite["Smart Dual Monitor Invitations (Anti-Enumeration)"]
    InvReq["Owner invites via Quick-Pick Collaborator OR Email (rate limit 20/hr)"] --> Match{"Existing verified user?"}
    Match -->|Yes| PathA["In-App Request: target_user_id set, token_hash NULL -> app/habit.monitor_requested"]
    Match -->|No| PathB["External Token Invite: CSPRNG 32B -> SHA-256 token_hash (7d TTL) -> /invite/habit/[token]"]
    PathA --> Uniform["Return uniform non-enumerating status to Owner"]
    PathB --> Uniform
    PathA --> Acc["Atomic Conditional Accept: UPDATE status='accepted' WHERE status='pending' RETURNING *"]
    PathB --> Acc
    Acc --> Mon["Upsert habit_monitors(status='active') + habit_monitor_items + apply proposedPolicy"]
  end

  subgraph Policy["Dynamic Comment-Window Enforcement (Owner IANA TZ)"]
    Post["Monitor submits Comment / Reply / Reaction"] --> LiveCheck["Direct Turso check: habit_monitors.status = 'active'"]
    LiveCheck --> Res["resolveEffectivePolicy(habit_tracker_settings, monitor.useCustomPolicy)"]
    Res --> Eval["evaluateCommentWindow(weekly_window | interval_days | anytime, ownerTZ, now)"]
    Eval --> Open{"Window open?"}
    Open -->|Yes| SaveC["ACID tx: persist habit_comments (scoped target_habit_id) -> emit app/habit.comment_posted"]
    Open -->|No| RejectC["Comment/Reply -> 403 CommentWindowClosedError (returns nextOpensAt)"]
    Open -->|"No + Reaction"| ReactAllow{"allowReactionsWhenLocked?"}
    ReactAllow -->|Yes| SaveR["Toggle monochrome reaction (ack | solid | push)"]
    ReactAllow -->|No| RejectR["403 CommentWindowClosedError"]
  end
```

**Honest Analytics, Per-Month Rosters & History Import Invariants (`habit-analytics.ts`, `habit-import.ts`, `habit-evolution.ts`):**
- Real calendar lengths (28–31 days with leap-year Feb 29), **elapsed-to-date denominators** (future days excluded), mid-month `startDate` clamping, `'skipped'` rest passes excluded from denominators without breaking streaks, and `'weekly_target'` habits capped at `weeklyTargetCount` per calendar week.
- **Per-Month Curated Rosters (`habit_month_rosters`) & Future-Month Lock:** Each month (`YYYY-MM`) maintains its own enrolled habit roster so switching between months displays and scores ONLY that month's habits; entering a new month offers 1-click carry-over or customization from the previous month without altering prior months' history; and future months (`> currentMonth`) are strictly clamped/rejected across UI, API, and Service layers until they begin.
- **Excel/CSV History Migration (`habit_import_aliases`):** Strictly restricted to validated `.xlsx` (OOXML ZIP magic-byte checked, lazy-loaded `read-excel-file/browser`, CSP `worker-src 'self' blob:`), `.csv`, and `.txt` files (max 10 MB), supporting 1-sheet or multi-sheet workbooks up to 20,000 marks in chunked ACID transactions, rename/merge identity resolution, true first-appearance `startDate` backfill, and automatic per-month roster population.

---

## 7. Client State Architecture, SEO, PWA Lifecycle & Shared-Device Hygiene

Folio enforces a strict client-state split so navigating across Inbox, Today, Upcoming, Notes, Reminders, Projects, Habits, and Circle feels instantaneous (`0` redundant refetches inside the 60s stale window) without leaking tenant data across sessions:

- **Server State (TanStack React Query v5 — `src/hooks/use-workspace-queries.ts`):** Every workspace view hydrates on initial SSR (`initialData` + `initialDataUpdatedAt`) and reads through authenticated `GET /api/workspace/*` routes (`bootstrap`, `tasks`, `notes`, `reminders`, `projects/[projectId]`, `habits`, `habits/circle`, `habits/circle/[ownerId]`) plus admin-only `GET /api/admin/overview`, all guarded by `requireSession()` / `requireAdmin()` + `Cache-Control: private, no-store`. Keys are strictly user-scoped (`["workspace", userId, ...]`), hover/focus prefetching warms destination routes from `LeftRail` and `HabitsSubnav`, and mutations call targeted domain invalidation (`invalidateWorkspaceDomains()`) instead of shotgun `revalidatePath("/app", "layout")`. Switching Habits scoring modes (`Elapsed-to-Date` ↔ `Full Month`) recomputes purely on the client at `0ms` with `0` network calls.
- **Unified Chronological Activity Timelines (`src/components/workspace/activity-timeline.tsx`):** A shared Warm Paper / Carbon Ink vertical day-grouped timeline component (`Today` / `Yesterday` / date headers, semantic tone nodes, actor initials, tabular/relative timestamps, category filter pills, and optional deep-link `Inspect` buttons) powers Project Detail (`Activity` tab with click-to-open `440px` Detail Sheet), the Admin Portal (`Activity Timeline` tab aggregating audits, signups, project milestones, and reminder deliveries), Reminders (`Recently triggered` newest-first day-grouped timeline), Accountability Circle (`Cycle Review` threaded spine), and the Notification Bell popover rail.
- **Client UI State (Zustand v5 — `src/stores/workspace-ui-store.ts`):** Persists **only** harmless, non-PII layout preferences (`railCollapsed`, `habitsScoringMode`, `habitsShowArchived`) under `folio-ui-prefs` with `skipHydration: true` + post-mount rehydration. Ephemeral session state (`activeDetail`, `projectActiveTabs`, `quickCaptureOpen`, `mobileMenuOpen`, `isOnline`) stays in memory and resets on sign-out.
- **SEO, Procedural 3D Editorial Landing & Installed-PWA Isolation:** Public `/` serves a full-viewport Warm Paper / Carbon Ink editorial landing page backed by a zero-dependency procedural 3D dot-matrix `<canvas>` engine (`src/components/landing/dot-matrix-3d-engine.ts`, lazy-loaded via `next/dynamic` with `IntersectionObserver` + `visibilitychange` + `prefers-reduced-motion` guards and an elliptical copy quiet zone), a flush anchored bottom editorial sheet whose 3 interactive pillars morph the 3D sculpture (`Stacked Ledger Sheets`, `Curved 31-Day Matrix`, `Accountability Orbit`), a GPU-composited 3D perspective workspace stage (`PerspectiveStageCard`), `WebApplication` JSON-LD, dynamic `opengraph-image` / `twitter-image`, `robots.ts`, `sitemap.ts`, and canonical URL resolution (`NEXT_PUBLIC_SITE_URL ?? BETTER_AUTH_URL ?? "https://folio.renult.xyz"`). Private `/app/*` and `/invite/*` routes emit `noindex, nofollow, nocache`. When launched as an installed PWA (`display-mode: standalone` or iOS `navigator.standalone`), `manifest.ts` launches at `/app/inbox` (redirecting signed-out users directly to `/login`), CSS hides `[data-folio-landing="true"]`, `StandaloneRootGuard` immediately redirects `/` → `/login`, and `PwaLaunchSplash` displays a calm once-per-session launch curtain paired with 12 Light/Dark iOS startup images (`public/splash/`).

```mermaid
flowchart TB
  subgraph Push["Shared-Device Sign-Out, Cache Wipe & Web Push Hygiene"]
    SO["performSecureSignOut()"] --> CacheWipe["clearBrowserQueryClient() + useWorkspaceUIStore.resetSessionState()"]
    CacheWipe --> SWCheck["navigator.serviceWorker.ready -> pushManager.getSubscription()"]
    SWCheck --> DelServer["removePushSubscriptionAction() — DELETE WHERE user_id=? AND endpoint=?"]
    DelServer --> Unsub["subscription.unsubscribe()"]
    Unsub --> BASignOut["authClient.signOut() -> hardNavigateAfterSignOut('/login')"]

    SubB["User B subscribes on same device"] --> Upsert["Atomic SQLite UPSERT — ON CONFLICT(endpoint) DO UPDATE SET user_id = User B"]
  end

  subgraph Order["Fractional Ordering (Tasks & Habits)"]
    Reord["create / reorder — ORDER BY position ASC, id ASC"] --> Len{"key.length > 32?"}
    Len -->|No| SaveKey["Persist O(1) fractional position key"]
    Len -->|Yes| Rebal["Transactional rebalancePositions() — compact base-36 keys in rank order"]
  end

  subgraph Offboard["Safe Account Offboarding"]
    DelAcc["AccountService.deleteAccount(userId)"] --> Sole{"Sole owner of shared project with members?"}
    Sole -->|Yes| Block["400 ValidationError (transfer or delete shared project first)"]
    Sole -->|No| Sweep["ACID tx: collect scheduled reminders -> DELETE user (cascades all 25 tables) -> reset UnreadCounterCache -> emit cancellations"]
  end
```

---

## 8. Core Production Invariants

| Domain | Enforced Invariant |
| :--- | :--- |
| **ACID & SQLite Locking** | Multi-table mutations run in `db.transaction()`; zero external network I/O inside `tx`; `withDbRetry()` handles transient `SQLITE_BUSY` (`WAL` + `busy_timeout = 0`); settings reads (`getOrCreateSettings`) use a `SELECT`-first fast path to avoid write-lock escalation during parallel reads. |
| **Zero TOCTOU** | Project invites, habit monitor requests, and reminder delivery claims execute single atomic conditional `UPDATE ... WHERE ... RETURNING *` statements. |
| **Outbox & Deduplication** | Scheduled reminders persist `dispatched_at = NULL` and reconcile every 5m; reminders (`reminder-sched-{id}-v{v}`), habit nudges (`habit-nudge-{userId}-{dateKey}-{slot}`), and review digests (`habit-review-open-{monitorId}-{cycleKey}`) enforce deterministic event IDs + DB dedup checks. |
| **Zero-Leak Isolation** | `assertProjectRole()`, `canUserReadEntity()`, and `habit_monitors` checks always hit Turso directly (zero Redis security cache); `DrizzleHabitMonitorReadDal` and `deliverHabitReviewDigestFn` strictly project only `allowedHabitIds` when `scope = 'selected'`. |
| **Anti-Enumeration** | Email monitor invites return a uniform non-enumerating status regardless of whether the target email belongs to an existing account; token URLs use 32-byte CSPRNG values hashed with SHA-256 before persistence. |
| **Vercel Scale** | All periodic crons (`far-future`, `outbox`, `habit-nudge`, `habit-review-digest`) enforce singleton `concurrency: { limit: 1 }` and loop `LIMIT 200` pages inside isolated `step.run()` steps; event-driven Inngest workers enforce `concurrency: { limit: INNGEST_CONCURRENCY_LIMIT }` (default `5`, Free-Plan safe) and `retries: 4`. |
| **Edge & Client Cache Isolation** | Every `/app/*`, `/invite/*`, and `/api/*` endpoint uses `force-dynamic`, zero unscoped `unstable_cache`, and `Cache-Control: private, no-store` alongside strict CSP & `X-Frame-Options: DENY`. Service Worker (`public/sw.js`) caches **only** public static shell assets and `/offline` (never `/api/*`, `/app/*`, or `/invite/*`). TanStack Query keys are user-scoped (`["workspace", userId, ...]`), Zustand persists zero PII, and `performSecureSignOut()` clears QueryClient + Zustand + push subscription + hard-navigates to `/login`. |
| **Design System & Scope** | `shadcn/ui` **Mira** in Warm Paper (Light) and Carbon Ink (Dark) honoring OS `prefers-color-scheme` by default, WCAG AA contrast (including dark-mode Recharts ticks), `Geist` + `Geist Mono tabular-nums`, zero glassmorphism, `>= 36px` mobile / `28px` desktop targets, Skip-to-main-content landmark focus, reduced-motion compliance, and strictly in-app sharing (zero PNG/canvas/image-card exports). |
