# Folio — Personal-First Productivity & Shared Projects

**Folio** is a full-stack productivity workspace combining **Tasks**, **Markdown Notes with optional timed Reminders**, **Natural-Language Quick Capture (`⌘K`)**, **Durable Hybrid Reminders (Inngest + PWA Web Push + Resend)**, and **Shared Projects with Cryptographic Email Invitations & RBAC**.

Built with Next.js 16 (App Router, TypeScript `strict`), Tailwind CSS v4, `shadcn/ui` **Mira** (`Warm Paper` / `Carbon Ink`), Drizzle ORM + Turso (`libSQL`), Better Auth, Inngest v4, and Upstash / local Redis.

---

## Architecture Overview

Strict SOLID layering enforced across `src/`:

- `src/server/db/` — Drizzle ORM schemas (`auth`, `workspace`, `reminders`, `notifications`), relations, and Turso/libSQL client.
- `src/server/dal/` — Defense-in-Depth Data Access Layer (`requireSession()`, `assertProjectRole()` with `PermissionCache`, explicit ACID transactions).
- `src/server/services/` — Pure domain orchestration (`TaskService`, `NoteService`, `ReminderService`, `ProjectService`, `ProjectInviteService`, `NotificationService`, `UserPreferencesService`).
- `src/server/providers/` — Decoupled interfaces (`EventBus`, `NotificationChannel` × 3, `AuthEmailDispatcher`, `RateLimiter`, `PermissionCache`, `UnreadCounterCache`).
- `src/server/inngest/` — Durable workflows (`scheduleReminderFn`, `farFutureReminderSweeperFn`, `sendAuthEmailFn`, `sendTestReminderFn`, `sendProjectInviteFn`).
- `src/actions/` — Next.js Server Actions (`Zod` → `requireSession()` → Service → typed `ActionResult<T>` → `revalidatePath()`).

---

## Local Development Setup

### 1. Install Dependencies & Environment Variables

```bash
pnpm install
cp .env.example .env.local
```

Generate local cryptographic secrets:

```bash
# Better Auth session secret (min 32 bytes)
openssl rand -base64 32

# Local Web Push VAPID keys (zero cloud provider required)
npx web-push generate-vapid-keys
```

Set `TURSO_DATABASE_URL="file:local.db"`, `INNGEST_DEV="1"`, and (if running local passwordless Redis) `REDIS_URL="redis://127.0.0.1:6379"` in `.env.local`.

### 2. Apply Drizzle Migrations

```bash
pnpm db:migrate
```

### 3. Run Dev Servers

```bash
# Terminal 1: Next.js App Router
pnpm dev

# Terminal 2 (optional): Local Inngest Dev Server for durable sleeping reminders
pnpm dlx inngest-cli@latest dev
```

Visit `http://localhost:3000` (Inngest dashboard: `http://localhost:8288`, readiness probe: `http://localhost:3000/api/health`).

### 4. Quality & Verification Commands

```bash
pnpm tsc --noEmit
pnpm lint
pnpm test
pnpm build
```

---

## Production Deployment Runbook (Vercel + Turso + Inngest + Upstash + Resend)

### Step 1: Provision Turso Database & Run Production Migrations

```bash
# Install Turso CLI and sign in
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login

# Create production database
turso db create folio-prod

# Retrieve connection URL & auth token
turso db show folio-prod --url
turso db tokens create folio-prod
```

Apply Drizzle migrations against Turso production:

```bash
TURSO_DATABASE_URL="libsql://folio-prod-<org>.turso.io" \
TURSO_AUTH_TOKEN="<your-turso-token>" \
pnpm db:migrate
```

### Step 2: Configure Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth 2.0 Client ID** (Web application).
2. Add **Authorized redirect URIs**:
   - Local dev: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://<your-domain>/api/auth/callback/google`
3. Copy `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Step 3: Generate Production VAPID Keys (Web Push)

```bash
npx web-push generate-vapid-keys
```

Set:
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (public key exposed to client `PushManager.subscribe`)
- `VAPID_PRIVATE_KEY` (server secret only — never prefix with `NEXT_PUBLIC_`)
- `VAPID_SUBJECT` (`mailto:notifications@yourdomain.com`)

### Step 4: Configure Resend Transactional Email

1. Verify your sending domain in [Resend](https://resend.com).
2. Create an API key (`RESEND_API_KEY`) and set `EMAIL_FROM="Folio <notifications@yourdomain.com>"`.

### Step 5: Provision Upstash Redis

1. Create a serverless Redis database in [Upstash Console](https://console.upstash.com).
2. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. When both are set in production, `RateLimiter`, `PermissionCache` (`300s` TTL), and `UnreadCounterCache` (`300s` TTL) automatically switch from local Redis / in-memory to Upstash REST.

### Step 6: Deploy to Vercel & Sync Inngest Cloud

1. Import the repository into [Vercel](https://vercel.com) and add all environment variables from `.env.example` (set `BETTER_AUTH_URL="https://<your-domain>"` and omit `INNGEST_DEV` in production).
2. In [Inngest Cloud](https://app.inngest.com), connect the official Vercel integration or manually sync your deployed endpoint `https://<your-domain>/api/inngest` using `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
3. Verify production readiness:
   - `GET https://<your-domain>/api/health` returns `200 { "status": "ok", "database": "connected" }`.
   - `GET https://<your-domain>/sw.js` returns `Cache-Control: no-cache, no-store, must-revalidate`.
   - Confirm security headers (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`) are present on responses.
