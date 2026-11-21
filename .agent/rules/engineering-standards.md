# Workspace Engineering & Design Standards

## 1. Architecture & SOLID Principles
- **Single Responsibility (SRP):** Separate concerns strictly across layers:
  - `src/server/db/` -> Drizzle schemas, relations, and Turso client ONLY.
  - `src/server/dal/` -> Data Access Layer (authorized DB queries, explicit ACID transactions, never contains UI or HTTP formatting).
  - `src/server/services/` -> Pure business orchestration (e.g., `ReminderService`, `ProjectInviteService`, `TaskService`).
  - `src/server/providers/` -> External integrations behind thin TypeScript interfaces (`NotificationChannel`, `EventBus`, `RateLimiter`, `CacheStore`).
  - `src/actions/` -> Next.js Server Actions (Zod input validation -> Auth check -> Service call -> typed `ActionResult<T>` -> `revalidatePath`).
  - `src/components/` -> Pure presentation & optimistic client wrappers (no direct DB or provider imports).
- **Open/Closed (OCP):** Delivery channels (`WebPushChannel`, `EmailChannel`, `InAppChannel`) must implement a shared `NotificationChannel` interface so adding new channels requires zero edits to reminder orchestration.
- **Liskov Substitution (LSP) & Interface Segregation (ISP):** Keep repository/provider interfaces small and role-specific (e.g., separate `PermissionCache` from `RateLimiter` rather than one giant `RedisService`).
- **Dependency Inversion (DIP):** Services accept repositories, event emitters, and cache interfaces via constructor/factory injection with production defaults—enabling fast unit tests without live Turso, Redis, or Inngest connections.

## 2. Database & ACID Principles (Turso / libSQL + Drizzle)
- **Atomicity:** Every multi-table or dependent write (e.g., creating a task/note + reminder, accepting an invite + inserting `project_members` + marking invite consumed, snoozing + logging notification) MUST run inside `db.transaction(async (tx) => { ... })`.
- **Consistency:** Enforce `foreignKeys`, `unique` constraints, `notNull`, and explicit Drizzle enum checks at the schema level. Validate all inputs with Zod at the boundary before DB calls.
- **Isolation & Optimistic Concurrency:** Use an incrementing `version` integer column on `reminders` (and atomic `WHERE id = ? AND version = ?` updates) so concurrent edits, snoozes, and background Inngest deliveries can never race or double-send.
- **Durability & Idempotency:** Persist state to Turso BEFORE emitting asynchronous Inngest events. All Inngest steps and webhook/cron handlers must be safely re-runnable (idempotent).
- **IDs & Time:** Use sortable `ULID` or `UUIDv7` strings for primary keys. Store all timestamps as UTC Unix epoch milliseconds (`integer`) alongside explicit IANA `timezone` strings (`text`).

## 3. Security & Defense-in-Depth
- Never rely solely on Next.js middleware for authorization. Every Server Action, Route Handler, and RSC data loader MUST verify the session via Better Auth inside the DAL.
- Scope personal records strictly by `userId`. Scope project records via an explicit `assertProjectRole(projectId, userId, allowedRoles)` helper.
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