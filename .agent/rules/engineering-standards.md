# Workspace Engineering & Design Standards

## 1. Architecture & SOLID Principles
- **Single Responsibility (SRP):** Separate concerns strictly across layers:
  - `src/server/db/` -> Drizzle schemas, relations, retry wrappers, and Turso client ONLY.
  - `src/server/dal/` -> Data Access Layer (authorized DB queries, explicit ACID transactions, never contains UI or HTTP formatting).
  - `src/server/services/` -> Pure business orchestration (e.g., `ReminderService`, `ProjectInviteService`, `TaskService`, `AccountService`).
  - `src/server/providers/` -> External integrations behind thin TypeScript interfaces (`NotificationChannel`, `EventBus`, `RateLimiter`, `UnreadCounterCache`).
  - `src/actions/` -> Next.js Server Actions (Zod input validation -> Auth check -> Service call -> typed `ActionResult<T>` -> `revalidatePath`).
  - `src/components/` -> Pure presentation & optimistic client wrappers (no direct DB or provider imports).
- **Open/Closed (OCP):** Delivery channels (`WebPushChannel`, `EmailChannel`, `InAppChannel`) must implement a shared `NotificationChannel` interface so adding new channels requires zero edits to reminder orchestration.
- **Liskov Substitution (LSP) & Interface Segregation (ISP):** Keep repository/provider interfaces small and role-specific (e.g., separate `UnreadCounterCache` from `RateLimiter` rather than one giant `RedisService`).
- **Dependency Inversion (DIP):** Services accept repositories, event emitters, and cache interfaces via constructor/factory injection with production defaults—enabling fast unit tests without live Turso, Redis, or Inngest connections.

## 2. Database & ACID Principles (Turso / libSQL + Drizzle)
- **Atomicity:** Every multi-table or dependent write (e.g., creating a task/note + reminder, accepting an invite + inserting `project_members` + marking invite consumed, snoozing + logging notification) MUST run inside `db.transaction(async (tx) => { ... })`.
- **Consistency:** Enforce `foreignKeys`, `unique` constraints, `notNull`, and explicit Drizzle enum checks at the schema level. Validate all inputs with Zod at the boundary before DB calls.
- **Isolation & Optimistic Concurrency:** Use an incrementing `version` integer column on `reminders` (and atomic `WHERE id = ? AND version = ?` updates) so concurrent edits, snoozes, and background Inngest deliveries can never race or double-send.
- **Durability & Idempotency:** Persist state to Turso BEFORE emitting asynchronous Inngest events. All Inngest steps and webhook/cron handlers must be safely re-runnable (idempotent).
- **IDs & Time:** Use sortable `ULID` or `UUIDv7` strings for primary keys. Store all timestamps as UTC Unix epoch milliseconds (`integer`) alongside explicit IANA `timezone` strings (`text`).

## 3. Security & Defense-in-Depth
- Never rely solely on Next.js middleware for authorization. Every Server Action, Route Handler, and RSC data loader MUST verify the session via Better Auth inside the DAL.
- Scope personal records strictly by `userId`. Scope project records via an explicit `assertProjectRole(projectId, userId, allowedRoles)` helper backed directly by Turso.
- Never log secrets, raw tokens, or passwords. Hash single-use invitation tokens (SHA-256) before persisting in Turso.

## 4. UI & Aesthetic Guardrails (Non-Negotiable)
- Style preset: `shadcn/ui` **Mira** (high-density compact UI).
- Palette: **Warm Paper (Light)** & **Carbon Ink (Dark)** ONLY. **Strictly ban** glassmorphism, neon glows, flashy gradients, or generic primary red/blue/green colors.
- Typography: `Geist` (UI) + `Geist Mono` with `tabular-nums` strictly for timestamps, countdowns, and shortcuts.
- Accessibility: Maintain WCAG AA contrast on all tokens. On touch/mobile viewports (`< 768px`), preserve a minimum `36px–40px` interactive hitbox height on rows and icon buttons.

## 5. Agent Execution Discipline
- Always start complex changes in `/plan` mode and wait for plan approval if destructive or schema-altering.
- Never leave `TODO` stubs, mock arrays, or placeholder handlers in production code.
- Before declaring a task complete, run `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, and verify rendered pages using the browser subagent.

## 6. Concurrency, Isolation & Vercel Scale Invariants
- **Strict Referential Integrity (No Loose Polymorphic FKs):** Reference target tables via explicit nullable foreign keys (`task_id` / `note_id` with `ON DELETE CASCADE`) guarded by SQLite `CHECK` constraints enforcing mutual exclusivity. Before any cascading delete of a task, note, project, or user account, collect all active `scheduled` reminders inside the transaction and emit batched `app/reminder.cancelled` events after commit.
- **Zero External Network I/O Inside DB Transactions:** Never call Inngest, Resend, Web Push, or Redis inside a `db.transaction()` callback. Always follow: Commit DB -> Execute external side-effect -> Update state if needed.
- **Transient SQLite Lock Resilience:** Wrap idempotent/transactional write entrypoints in `withDbRetry()` (max 3 attempts, exponential backoff + jitter) exclusively for transient `SQLITE_BUSY` / lock errors.
- **Outbox Reconciliation for Durable Events:** Persist scheduled reminders with `dispatched_at = NULL`, emit deterministic Inngest event IDs (`reminder-sched-${id}-v${version}`) post-commit, stamp `dispatched_at` on success, and reconcile any undispatched rows (`dispatched_at IS NULL AND updated_at <= now - 60s`) via a 5-minute chunked cron (`LIMIT 200`).
- **Atomic Conditional State Transitions (Zero TOCTOU):** Consume single-use invitations (`WHERE id = ? AND status = 'pending' AND expires_at > ? RETURNING *`) and claim reminder deliveries (`WHERE id = ? AND status = 'scheduled' AND version = ? RETURNING *`) in single atomic conditional `UPDATE` statements; abort cleanly when 0 rows return.
- **Direct-Turso Security Authorization (No Redis in Auth Gates):** `assertProjectRole()` and `canUserReadEntity()` MUST always query Turso directly via indexed primary keys—never trust cached Redis roles for security or write authorization. Retain Redis strictly for `RateLimiter` and `UnreadCounterCache`.
- **Delivery-Time Zero-Leak Re-Verification:** Re-verify `canUserReadEntity(userId, target)` both on reminder creation/reschedule AND inside Inngest `scheduleReminderFn` immediately before fetching entity titles or dispatching Push/Email; if access was revoked while sleeping, cancel the reminder and send zero notifications.
- **Shared-Device Push Hygiene:** On client sign-out, remove the active Service Worker push endpoint from `push_subscriptions` and unsubscribe locally before Better Auth sign-out. On push subscription save, execute an atomic `ON CONFLICT(endpoint) DO UPDATE` reassigning ownership to the authenticated `userId`.
- **Tenant & Cache Isolation on Vercel:** Export `export const dynamic = "force-dynamic"` on authenticated `/app/*` and `/invite/*` routes, forbid unscoped `unstable_cache`, and send `Cache-Control: private, no-store` on all `/api/*` and `/invite/*` responses. Every DAL `select`/`update`/`delete` on tenant tables MUST enforce an explicit `userId` or verified `projectId` predicate in `WHERE`.
- **Bounded Serverless Scale & Ordering Stability:** Process sweepers/reconcilers in bounded `LIMIT 200` chunks inside `step.run()` loops with batched `inngest.send()`; protect bursty functions (`scheduleReminderFn`, `sendProjectInviteFn`) with `concurrency: { limit: 25 }` and `retries: 4`; order fractional-indexed tasks deterministically with `ORDER BY position ASC, id ASC` and rebalance transactionally whenever a generated key exceeds 32 characters.
