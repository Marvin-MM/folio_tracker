# Folio — System Architecture

> Visual-first architectural blueprint for **Folio**: a personal-first productivity workspace combining Tasks, Markdown Notes with optional timed Reminders, Durable Multi-Channel Notifications, and Shared Projects with Role-Based Access Control.

---

## 1. System Context & Edge Topology

Requests traverse a defense-in-depth boundary: optimistic edge redirects and cache isolation sit in front of server-validated App Router handlers, a strict SOLID core, and decoupled cloud/local infrastructure adapters.

```mermaid
flowchart TB
  subgraph Client["Client Runtime (Browser / Installed PWA)"]
    UI["Next.js React 19 UI — Warm Paper / Carbon Ink Mira + Quick Capture"]
    SW["Service Worker (/sw.js) — Web Push + Quick Actions"]
  end

  subgraph Edge["Vercel Edge & Next.js 16 Boundary"]
    HDR["next.config.ts Headers — CSP, DENY, nosniff, private no-store"]
    PRX["src/proxy.ts — Optimistic /app/* Guard + private no-store"]
  end

  subgraph App["Next.js App Router (force-dynamic)"]
    RSC["RSC Pages & Layouts (/app/*, /invite/[token], /(auth)/*)"]
    ACT["Server Actions (src/actions/*) — Zod -> Auth -> Service -> Revalidate"]
    API["Route Handlers (/api/auth, /api/inngest, /api/health, /api/reminders, /api/notifications)"]
  end

  subgraph Core["SOLID Domain Core (src/server/)"]
    SVC["Domain Services (Task, Note, Reminder, Project, Invite, Account, Notification)"]
    DAL["DAL & Direct-Turso Auth Guards (requireSession, assertProjectRole, canUserReadEntity, withDbRetry)"]
    PRV["Provider Interfaces (EventBus, NotificationChannel x3, RateLimiter, UnreadCounterCache)"]
  end

  subgraph Infra["Persistence & External Services"]
    DB[("Turso / libSQL (SQLite WAL) — 13 Tables, ULID PKs, Cascading FKs")]
    RDS[("Redis 3-Tier (Upstash -> ioredis -> Memory) — RateLimiter & UnreadCounter ONLY")]
    ING["Inngest v4 Durable Engine — 6 Functions, Concurrency & Chunked Crons"]
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

  SVC --> DAL --> DB
  SVC --> PRV
  PRV --> RDS
  PRV --> ING
  PRV --> EXT
  ING --> SVC
  ING --> DAL
  ING --> EXT
```

---

## 2. SOLID Clean Layering & Dependency Direction

Dependencies point strictly inward toward `src/server/db/`. Every service accepts repositories and providers via constructor injection (DIP), allowing the entire Vitest suite to run against ephemeral SQLite databases with zero live network dependencies.

```mermaid
flowchart LR
  subgraph Presentation["Presentation"]
    COMP["src/components/ (Pure Mira UI + useOptimistic — Zero DB/Provider imports)"]
  end

  subgraph Boundary["App Boundary"]
    APP["src/app/ (RSC Pages, Layouts, API Routes)"]
    ACTS["src/actions/ (Zod Validation -> ActionResult)"]
  end

  subgraph Domain["Domain Orchestration"]
    SVCS["src/server/services/ (Task, Note, Reminder, Project, ProjectInvite, Account, Notification, Preferences)"]
  end

  subgraph DataAndPorts["Data Access & Provider Ports"]
    DALS["src/server/dal/ (Scoped Repositories, assertProjectRole, canUserReadEntity)"]
    PORTS["src/server/providers/ (EventBus, NotificationChannel, AuthEmailDispatcher, RateLimiter, UnreadCounterCache)"]
  end

  subgraph Foundations["Schema & Concrete Adapters"]
    SCHEMA["src/server/db/ (Drizzle Schema, Relations, WAL Client, withDbRetry)"]
    ADAPT["External Adapters (Inngest, Resend, web-push, Upstash / ioredis / InMemory)"]
  end

  COMP --> ACTS
  APP --> DALS
  APP --> SVCS
  ACTS --> SVCS
  SVCS --> DALS
  SVCS --> PORTS
  DALS --> SCHEMA
  PORTS --> ADAPT
```

| Provider Interface | Concrete Implementations | Strict Responsibility |
| :--- | :--- | :--- |
| `EventBus` | `InngestEventBus`, `InMemoryEventBus` | Post-commit durable event emission with deterministic deduplication `id` |
| `NotificationChannel` (OCP) | `InAppNotificationChannel`, `WebPushNotificationChannel`, `EmailNotificationChannel` | Isolated per-channel delivery (`Promise.allSettled`, `404`/`410` auto-prune, email fallback) |
| `RateLimiter` (ISP) | `UpstashRateLimiter`, `IoRedisRateLimiter` (Lua), `InMemoryRateLimiter` | Sliding-window protection (`auth` 10/10m, `project_invite` 20/1h, `test_push` 5/5m) |
| `UnreadCounterCache` (ISP) | `UpstashUnreadCounterCache`, `IoRedisUnreadCounterCache`, `InMemoryUnreadCounterCache` | `300s` TTL unread badge cache only (**never** used for security or RBAC) |
| `AuthEmailDispatcher` | `InngestAuthEmailDispatcher`, `ResendAuthEmailDispatcher`, `ConsoleAuthEmailDispatcher` | Verification & password-reset emails without logging raw tokens |

---

## 3. Unified Entity-Relationship Model (13 Tables)

All primary keys are sortable ULIDs (`ulidx`), all timestamps are UTC Unix epoch milliseconds (`integer`) paired with explicit IANA timezone strings, and referential integrity is enforced at the SQLite/Turso engine level (`PRAGMA foreign_keys = ON`, `CHECK` constraints, and cascading deletes).

```mermaid
erDiagram
  users {
    text id PK "ULID"
    text email UK
    boolean email_verified
    text timezone "IANA default UTC"
    boolean email_reminders_enabled
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
    text status "CHECK pending, accepted, revoked, expired"
    integer expires_at
  }
  tasks {
    text id PK "ULID"
    text user_id FK "CASCADE"
    text project_id FK "nullable CASCADE"
    text assignee_id FK "nullable SET NULL"
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
    text status "CHECK pending_far, scheduled, sent, snoozed, cancelled"
    integer version "CHECK >= 1"
    integer dispatched_at "Outbox timestamp"
    integer sent_at
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
    text title
    text body
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
```

**Schema Guardrails:**
- **Zero Polymorphic FK Drift:** `reminders` enforces `CHECK ((task_id IS NOT NULL AND note_id IS NULL) OR (task_id IS NULL AND note_id IS NOT NULL))` so SQLite prevents orphan reminders and cascades deletes cleanly.
- **Hot-Path Composite Indexes:** `reminders(status, dispatched_at, updated_at)` (outbox), `reminders(status, remind_at)` (far-future sweeper), `reminders(user_id, status, remind_at)`, `tasks(project_id, status, position)`, `tasks(user_id, status, due_at)`, `project_members(project_id, user_id)` PK.

---

## 4. Request Lifecycle, Auth & Multi-Tenant Isolation

Every authenticated mutation enforces defense-in-depth directly against Turso—never trusting proxy cookie presence or cached Redis roles—and keeps external network I/O strictly outside SQLite transactions.

```mermaid
sequenceDiagram
  autonumber
  actor User as Browser / PWA
  participant Proxy as src/proxy.ts
  participant Action as Server Action / Route
  participant Guard as DAL Auth Guards
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

  Action->>Service: Invoke domain command
  Service->>Guard: assertProjectRole() or canUserReadEntity()
  Guard->>Turso: Direct PK lookup on project_members(project_id, user_id)
  alt Unauthorized or Cross-Tenant IDOR
    Guard-->>User: 403 ForbiddenError
  end

  Note over Service,Turso: Zero external network I/O inside db.transaction()
  Service->>Turso: withDbRetry() -> BEGIN ACID transaction
  Service->>Turso: Tenant-scoped INSERT/UPDATE/DELETE + project_activities
  Turso-->>Service: COMMIT

  Service->>Ext: Post-commit side-effects (EventBus / UnreadCounterCache)
  Action-->>User: ActionResult + revalidatePath()
```

**Authentication Security Controls:**
- **Credential + Google OAuth Only:** Better Auth enforces `requireEmailVerification: true`, `revokeSessionsOnPasswordReset: true`, `HttpOnly` / `SameSite=Lax` / `Secure` (prod) cookies, and open-redirect sanitization (`sanitizeCallbackUrl`).
- **Account Takeover Prevention:** `databaseHooks.account.create.before` ([auth-policy.ts](../src/server/auth-policy.ts)) rejects OAuth auto-linking into any pre-existing unverified credential account (`emailVerified === false`).
- **Zero Stale-Cookie Loops:** `/login` and `/register` validate sessions server-side via `getOptionalSession()` instead of bouncing blindly on cookie presence in `src/proxy.ts`.

---

## 5. Durable Hybrid Reminder Engine & Outbox Reconciliation

Reminders combine a **14-day scheduling horizon** (preventing unbounded sleeping workflows), **Outbox Reconciliation** (guaranteeing at-least-once dispatch across transient outages), **optimistic version locking** (preventing stale/duplicate delivery), and **delivery-time access re-verification** (preventing post-revocation data leaks).

### Reminder State Machine

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

### End-to-End Scheduling, Reconciliation & Multi-Channel Delivery

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Svc as ReminderService
  participant Turso as Turso / libSQL
  participant Cron as Inngest Crons (LIMIT 200)
  participant Sched as scheduleReminderFn (concurrency 25, retries 4)
  participant Ch as In-App / Web Push / Email

  User->>Svc: Create or Snooze reminder (<= 14d)
  Svc->>Turso: ACID tx: canUserReadEntity() -> persist status=scheduled, dispatched_at=NULL, version=V
  Turso-->>Svc: COMMIT

  Svc->>Sched: Post-commit inngest.send(id = reminder-sched-{id}-v{V})
  alt Emit succeeds
    Svc->>Turso: markDispatched(id, V, now) -> stamp dispatched_at
  else Transient Inngest outage
    Note over Turso,Cron: Row stays committed with dispatched_at = NULL
    Cron->>Turso: Every 5m: SELECT scheduled rows where dispatched_at IS NULL LIMIT 200
    Cron->>Sched: Batched deterministic inngest.send()
    Cron->>Turso: Stamp dispatched_at
  end

  Note over Sched: cancelOn app/reminder.cancelled or app/reminder.rescheduled
  Sched->>Sched: step.sleepUntil(remindAt)
  Sched->>Turso: Step 1: canUserReadEntity(userId, taskId or noteId)

  alt Access revoked while sleeping
    Sched->>Turso: cancelIfRevoked(id, V) -> status = cancelled
    Note over Sched,Ch: ZERO notifications dispatched
  else Still authorized
    Sched->>Turso: Step 2: Atomic UPDATE SET status=sent WHERE id=? AND status=scheduled AND version=V RETURNING *
    alt 0 rows returned (stale or concurrent claim)
      Note over Sched: Abort silently (zero double-send)
    else Claimed atomically
      Sched->>Turso: Step 3: Load scoped title, snippet, deepLink
      Sched->>Ch: Step 4: InAppChannel -> insert notification + incr UnreadCounterCache
      Sched->>Ch: Step 5: WebPushChannel -> Promise.allSettled (auto-delete 404/410)
      Sched->>Ch: Step 6: EmailChannel -> Resend (if emailRemindersEnabled OR 0 push subs)
    end
  end
```

**Cascade Cancellation on Delete:** Before deleting any task, note, project, or user account, services collect all active `scheduled` reminders across **all** affected members inside the transaction, commit the cascading SQLite delete, and emit batched `app/reminder.cancelled` events afterward.

---

## 6. Shared Projects, RBAC & Cryptographic Invitations

Personal Inbox tasks and unlinked notes (`project_id IS NULL`) remain strictly private. Projects start personal (`memberCount === 1`) and transition seamlessly to shared workspaces when collaborators accept a single-use cryptographic invitation.

```mermaid
sequenceDiagram
  autonumber
  actor Owner
  actor Invitee
  participant RL as RateLimiter (20/hr)
  participant InvSvc as ProjectInviteService
  participant Turso as Turso / libSQL
  participant Mail as sendProjectInviteFn -> Resend

  Owner->>InvSvc: Invite email as editor or viewer
  InvSvc->>Turso: assertProjectRole(projectId, ownerId, owner)
  InvSvc->>RL: limit(project_invite, ownerId)
  InvSvc->>InvSvc: CSPRNG 32B base64url token -> SHA-256 token_hash
  InvSvc->>Turso: ACID tx: reject duplicates -> INSERT token_hash (7d TTL) + activity
  InvSvc->>Mail: Post-commit app/project.invited (concurrency 25, retries 4)
  InvSvc-->>Owner: Return one-time copyable /invite/[rawToken]

  Invitee->>InvSvc: GET /invite/[rawToken] (Cache-Control private, no-store)
  InvSvc->>Turso: Lookup SHA-256(rawToken) -> non-sensitive preview
  Note over Invitee: Signed out -> /login?callbackURL=/invite/[token] ; Wrong email -> EmailMismatchError

  Invitee->>InvSvc: Accept invitation (verified matching email)
  InvSvc->>Turso: withDbRetry() -> ACID tx: UPDATE SET status=accepted WHERE status=pending AND expires_at > now RETURNING *
  alt 0 rows returned (replayed or concurrent race)
    Turso-->>Invitee: 409 ConflictError (strictly 1 winner)
  else Claimed atomically
    InvSvc->>Turso: INSERT project_members + INSERT project_activities
    Turso-->>Invitee: Redirect /app/projects/[projectId]
  end
```

### Direct-Turso RBAC Matrix

| Capability | `owner` | `editor` | `viewer` | Non-Member |
| :--- | :---: | :---: | :---: | :---: |
| View tasks, notes & activity feed | Yes | Yes | Yes | `403` |
| Attach, snooze & cancel **own private reminders** on project items | Yes | Yes | **Yes** | `403` |
| CRUD project tasks, notes & member task assignments | Yes | Yes | `403` | `403` |
| Project settings, archive/delete, invites & member role management | Yes | `403` | `403` | `403` |
| Access another user's personal Inbox tasks or unlinked notes | `403` | `403` | `403` | `403` |

---

## 7. Shared-Device Push Hygiene, Rebalancing & Safe Offboarding

```mermaid
flowchart TB
  subgraph Push["Shared-Device Web Push Hygiene"]
    SO["performSecureSignOut()"] --> SWCheck["navigator.serviceWorker.ready -> pushManager.getSubscription()"]
    SWCheck --> DelServer["removePushSubscriptionAction() — DELETE WHERE user_id=? AND endpoint=?"]
    DelServer --> Unsub["subscription.unsubscribe()"]
    Unsub --> BASignOut["authClient.signOut()"]

    SubB["User B subscribes on same device"] --> Upsert["Atomic SQLite UPSERT — ON CONFLICT(endpoint) DO UPDATE SET user_id = User B"]
  end

  subgraph Order["Fractional Task Ordering"]
    Reord["TaskService createTask / reorderTask — ORDER BY position ASC, id ASC"] --> Len{"key.length > 32?"}
    Len -->|No| SaveKey["Persist O(1) fractional position key"]
    Len -->|Yes| Rebal["Transactional rebalancePositions() — compact base-36 keys in rank order"]
  end

  subgraph Offboard["Safe Account Offboarding"]
    DelAcc["AccountService.deleteAccount(userId)"] --> Sole{"Sole owner of shared project with members?"}
    Sole -->|Yes| Block["400 ValidationError (transfer or delete shared project first)"]
    Sole -->|No| Sweep["ACID tx: collect scheduled reminders -> DELETE user (FK cascades) -> reset UnreadCounterCache -> emit cancellations"]
  end
```

---

## 8. Core Production Invariants

| Domain | Enforced Invariant |
| :--- | :--- |
| **ACID & Locking** | Multi-table mutations run in `db.transaction()`; zero external network I/O inside `tx`; `withDbRetry()` handles transient `SQLITE_BUSY` without blocking Node's event loop (`WAL` + `busy_timeout = 0` on local libSQL). |
| **Zero TOCTOU** | Invite consumption and reminder delivery claims execute single atomic conditional `UPDATE ... WHERE ... RETURNING *` statements. |
| **Outbox Durability** | Scheduled reminders persist `dispatched_at = NULL`, emit deterministic `reminder-sched-{id}-v{version}` IDs post-commit, and reconcile every 5 minutes in `LIMIT 200` chunks. |
| **Zero-Leak Auth** | `assertProjectRole()` and `canUserReadEntity()` always hit Turso directly; `scheduleReminderFn` re-verifies read access immediately before loading titles or firing Push/Email. |
| **Vercel Scale** | Sweeper/reconciler crons loop `LIMIT 200` batches inside isolated `step.run()` steps; bursty Inngest functions enforce `concurrency: { limit: 25 }` and `retries: 4`. |
| **Edge Cache Isolation** | Every `/app/*`, `/invite/*`, and `/api/*` endpoint uses `force-dynamic`, zero unscoped `unstable_cache`, and `Cache-Control: private, no-store` alongside strict CSP & `X-Frame-Options: DENY`. |
| **Design System** | `shadcn/ui` **Mira** in Warm Paper (Light) and Carbon Ink (Dark), WCAG AA contrast, `Geist` + `Geist Mono tabular-nums`, zero glassmorphism, `>= 36px` mobile / `28px` desktop touch targets. |
