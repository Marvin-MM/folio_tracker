import { getConfiguredAdminEmails } from "@/server/admin-policy";
import { isEmailPasswordAuthEnabled, isGoogleOAuthConfigured } from "@/server/auth";
import {
  adminRepository,
  type AdminRepository,
  type AdminUserDirectoryFilter,
  type AdminUsersDirectoryPage,
  type DailyPlatformMetricPoint,
  type PlatformKpis,
  type PlatformTimelineCategory,
  type PlatformTimelineEvent,
  type SweepExpiredSummary,
} from "@/server/dal/admin-repository";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import { db, libsqlClient, withDbRetry, type AppDatabase } from "@/server/db";
import {
  DEFAULT_INNGEST_CONCURRENCY,
  INNGEST_CRON_CONCURRENCY,
} from "@/server/inngest/client";
import { inngestFunctions } from "@/server/inngest/registry";
import { getRedisBackend } from "@/server/providers/redis/client";
import {
  syncAdminRolesFromEnv,
  type AdminRoleSyncResult,
} from "@/server/services/admin-role-sync";
import {
  DEFAULT_OUTBOX_MIN_AGE_MS,
  DEFAULT_SWEEPER_BATCH_SIZE,
  reminderService,
  type ReminderService,
} from "@/server/services/reminder-service";

export type HealthProbeStatus = "healthy" | "fallback" | "degraded";

export interface HealthSubsystemCheck {
  key: "database" | "redis" | "inngest" | "auth" | "channels";
  label: string;
  status: HealthProbeStatus;
  summary: string;
  latencyMs: number | null;
  details: Array<{ label: string; value: string }>;
}

export interface PlatformHealthReport {
  overallStatus: HealthProbeStatus;
  checkedAtMs: number;
  subsystems: HealthSubsystemCheck[];
}

export interface AdminOverviewSummaryPayload {
  generatedAtMs: number;
  kpis: PlatformKpis;
  dailySeries: DailyPlatformMetricPoint[];
  health: PlatformHealthReport;
  configuredAdminCount: number;
}

export interface AdminUsersSectionPayload {
  generatedAtMs: number;
  usersPage: AdminUsersDirectoryPage;
}

export interface AdminTimelineSectionPayload {
  generatedAtMs: number;
  timeline: PlatformTimelineEvent[];
}

export interface AdminOverviewPayload extends AdminOverviewSummaryPayload {
  usersPage: AdminUsersDirectoryPage;
  timeline: PlatformTimelineEvent[];
}

export interface AdminOverviewQueryOptions extends AdminUserDirectoryFilter {
  timelineCategory?: PlatformTimelineCategory;
  days?: number;
}

const PROBE_TIMEOUT_MS = 1_500;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Probe timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface LiveSubsystemProbes {
  dbStatus: HealthProbeStatus;
  dbLatencyMs: number | null;
  redisStatus: HealthProbeStatus;
  redisLatencyMs: number | null;
  redisLabel: string;
  redisTier: string;
}

export class AdminService {
  constructor(
    private readonly repo: AdminRepository = adminRepository,
    private readonly database: AppDatabase = db,
    private readonly reminders: Pick<
      ReminderService,
      "reconcileUndispatchedBatch"
    > = reminderService
  ) {}

  private async probeLiveSubsystems(): Promise<LiveSubsystemProbes> {
    const redisBackend = getRedisBackend();

    const [dbProbe, redisProbe] = await Promise.all([
      (async (): Promise<{
        status: HealthProbeStatus;
        latencyMs: number | null;
      }> => {
        try {
          const t0 = performance.now();
          await withTimeout(libsqlClient.execute("SELECT 1"), PROBE_TIMEOUT_MS);
          return {
            status: "healthy",
            latencyMs: Math.max(0, Math.round(performance.now() - t0)),
          };
        } catch {
          return { status: "degraded", latencyMs: null };
        }
      })(),
      (async (): Promise<{
        status: HealthProbeStatus;
        latencyMs: number | null;
        label: string;
      }> => {
        if (redisBackend.kind === "upstash") {
          try {
            const t0 = performance.now();
            await withTimeout(redisBackend.client.ping(), PROBE_TIMEOUT_MS);
            return {
              status: "healthy",
              latencyMs: Math.max(0, Math.round(performance.now() - t0)),
              label: "Upstash Redis REST",
            };
          } catch {
            return {
              status: "degraded",
              latencyMs: null,
              label: "Upstash Redis REST (unreachable / timed out)",
            };
          }
        }
        if (redisBackend.kind === "local_redis") {
          try {
            const t0 = performance.now();
            await withTimeout(redisBackend.client.ping(), PROBE_TIMEOUT_MS);
            return {
              status: "healthy",
              latencyMs: Math.max(0, Math.round(performance.now() - t0)),
              label: "Local Redis (ioredis)",
            };
          } catch {
            return {
              status: "fallback",
              latencyMs: null,
              label: "Local Redis unreachable (Memory fallback active)",
            };
          }
        }
        return {
          status: "fallback",
          latencyMs: null,
          label: "In-Memory Fallback",
        };
      })(),
    ]);

    return {
      dbStatus: dbProbe.status,
      dbLatencyMs: dbProbe.latencyMs,
      redisStatus: redisProbe.status,
      redisLatencyMs: redisProbe.latencyMs,
      redisLabel: redisProbe.label,
      redisTier: redisBackend.kind,
    };
  }

  private buildHealthReport(
    outboxBacklogCount: number,
    pushSubscriptionsCount: number,
    probes: LiveSubsystemProbes
  ): PlatformHealthReport {
    const checkedAtMs = Date.now();

    const dbUrl = process.env.TURSO_DATABASE_URL?.trim() || "file:local.db";
    const dbMode =
      dbUrl.startsWith("libsql://") || dbUrl.startsWith("https://")
        ? "Turso Remote"
        : "Local SQLite (WAL)";

    const inngestDev = process.env.INNGEST_DEV === "1";
    const inngestCloudConfigured = Boolean(
      process.env.INNGEST_EVENT_KEY?.trim() &&
        process.env.INNGEST_SIGNING_KEY?.trim()
    );
    const inngestMode = inngestDev
      ? "Local Dev Server"
      : inngestCloudConfigured
        ? "Inngest Cloud"
        : "Unconfigured (Outbox queued)";
    const inngestStatus: HealthProbeStatus =
      outboxBacklogCount > 25
        ? "degraded"
        : inngestDev || inngestCloudConfigured
          ? "healthy"
          : "fallback";

    const googleConfigured = isGoogleOAuthConfigured();
    const emailPasswordEnabled = isEmailPasswordAuthEnabled();
    const configuredAdmins = getConfiguredAdminEmails();
    const authMode = emailPasswordEnabled
      ? "Dual (Google + Email/Password)"
      : "Google OAuth Only (Prod)";
    const authStatus: HealthProbeStatus =
      !emailPasswordEnabled && !googleConfigured ? "degraded" : "healthy";

    const vapidReady = Boolean(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() &&
        process.env.VAPID_PRIVATE_KEY?.trim()
    );
    const resendReady = Boolean(process.env.RESEND_API_KEY?.trim());
    const channelsStatus: HealthProbeStatus =
      vapidReady && resendReady ? "healthy" : "fallback";

    const subsystems: HealthSubsystemCheck[] = [
      {
        key: "database",
        label: "Turso / libSQL",
        status: probes.dbStatus,
        summary:
          probes.dbStatus === "healthy"
            ? `${dbMode} connected`
            : "Database unreachable",
        latencyMs: probes.dbLatencyMs,
        details: [
          { label: "Mode", value: dbMode },
          { label: "Schema", value: "35 tables · ULID · FKs ON" },
        ],
      },
      {
        key: "redis",
        label: "Rate Limit & Counter Cache",
        status: probes.redisStatus,
        summary: probes.redisLabel,
        latencyMs: probes.redisLatencyMs,
        details: [
          { label: "Tier", value: probes.redisTier },
          { label: "Security", value: "RBAC bypasses Redis (Turso direct)" },
        ],
      },
      {
        key: "inngest",
        label: "Inngest v4 Engine",
        status: inngestStatus,
        summary: `${inngestFunctions.length} functions · ${inngestMode}`,
        latencyMs: null,
        details: [
          {
            label: "Concurrency",
            value: `Workers ${DEFAULT_INNGEST_CONCURRENCY} · Crons ${INNGEST_CRON_CONCURRENCY}`,
          },
          {
            label: "Outbox Backlog (>60s)",
            value: `${outboxBacklogCount}`,
          },
        ],
      },
      {
        key: "auth",
        label: "Auth & Admin Policy",
        status: authStatus,
        summary: authMode,
        latencyMs: null,
        details: [
          {
            label: "Google OAuth",
            value: googleConfigured ? "Configured" : "Not set",
          },
          {
            label: "ADMIN_EMAILS",
            value: `${configuredAdmins.length} allowlisted`,
          },
        ],
      },
      {
        key: "channels",
        label: "Delivery Channels",
        status: channelsStatus,
        summary: `${vapidReady ? "VAPID Push Ready" : "Push Inactive"} · ${resendReady ? "Resend Active" : "Console Email"}`,
        latencyMs: null,
        details: [
          { label: "Push Devices", value: `${pushSubscriptionsCount}` },
          {
            label: "Email Transport",
            value: resendReady ? "Resend API" : "Dev Console",
          },
        ],
      },
    ];

    const hasDegraded = subsystems.some((s) => s.status === "degraded");
    const hasFallback = subsystems.some((s) => s.status === "fallback");
    const overallStatus: HealthProbeStatus = hasDegraded
      ? "degraded"
      : hasFallback
        ? "fallback"
        : "healthy";

    return {
      overallStatus,
      checkedAtMs,
      subsystems,
    };
  }

  async runHealthDiagnostics(
    outboxBacklogCount: number,
    pushSubscriptionsCount: number
  ): Promise<PlatformHealthReport> {
    const probes = await this.probeLiveSubsystems();
    return this.buildHealthReport(
      outboxBacklogCount,
      pushSubscriptionsCount,
      probes
    );
  }

  async getOverviewSummary(days = 14): Promise<AdminOverviewSummaryPayload> {
    const nowMs = Date.now();
    const [kpis, dailySeries, probes] = await Promise.all([
      this.repo.getPlatformKpis(nowMs),
      this.repo.getDailyPlatformSeries(days, nowMs),
      this.probeLiveSubsystems(),
    ]);

    const health = this.buildHealthReport(
      kpis.delivery.undispatchedOutboxBacklog,
      kpis.delivery.pushSubscriptions,
      probes
    );

    return {
      generatedAtMs: nowMs,
      kpis,
      dailySeries,
      health,
      configuredAdminCount: getConfiguredAdminEmails().length,
    };
  }

  async getUsersDirectorySection(
    options: AdminUserDirectoryFilter = {}
  ): Promise<AdminUsersSectionPayload> {
    const nowMs = Date.now();
    const usersPage = await this.repo.listUsersDirectory(options, nowMs);
    return {
      generatedAtMs: nowMs,
      usersPage,
    };
  }

  async getTimelineSection(
    category: PlatformTimelineCategory = "all",
    limit = 60
  ): Promise<AdminTimelineSectionPayload> {
    const nowMs = Date.now();
    const timeline = await this.repo.listPlatformTimeline(category, limit);
    return {
      generatedAtMs: nowMs,
      timeline,
    };
  }

  async getOverview(
    options: AdminOverviewQueryOptions = {}
  ): Promise<AdminOverviewPayload> {
    const nowMs = Date.now();
    const [kpis, dailySeries, usersPage, timeline, probes] = await Promise.all([
      this.repo.getPlatformKpis(nowMs),
      this.repo.getDailyPlatformSeries(options.days ?? 14, nowMs),
      this.repo.listUsersDirectory(options, nowMs),
      this.repo.listPlatformTimeline(options.timelineCategory ?? "all", 60),
      this.probeLiveSubsystems(),
    ]);

    const health = this.buildHealthReport(
      kpis.delivery.undispatchedOutboxBacklog,
      kpis.delivery.pushSubscriptions,
      probes
    );

    return {
      generatedAtMs: nowMs,
      kpis,
      dailySeries,
      health,
      usersPage,
      timeline,
      configuredAdminCount: getConfiguredAdminEmails().length,
    };
  }

  async reconcileOutboxNow(actorUserId: string): Promise<{
    reconciledCount: number;
  }> {
    const reconciledCount = await this.reminders.reconcileUndispatchedBatch(
      DEFAULT_SWEEPER_BATCH_SIZE,
      DEFAULT_OUTBOX_MIN_AGE_MS
    );

    await withDbRetry(() =>
      this.repo.recordAuditLog({
        actorUserId,
        action: "admin.outbox_reconciled",
        targetType: "reminder",
        metadata: { reconciledCount },
      })
    );

    return { reconciledCount };
  }

  async sweepExpiredRecordsNow(
    actorUserId: string
  ): Promise<SweepExpiredSummary> {
    const nowMs = Date.now();
    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const summary = await this.repo.sweepExpiredRecords(nowMs, tx);
        await this.repo.recordAuditLog(
          {
            actorUserId,
            action: "admin.expired_swept",
            targetType: "system",
            metadata: { ...summary },
          },
          tx
        );
        return summary;
      })
    );
  }

  async syncAdminRolesNow(
    actorUserId: string,
    rawEnv: string | undefined = process.env.ADMIN_EMAILS
  ): Promise<AdminRoleSyncResult> {
    const result = await syncAdminRolesFromEnv(
      this.database,
      rawEnv,
      actorUserId
    );
    // If sync made zero changes, still record the explicit operator audit action
    if (result.promotedEmails.length === 0 && result.demotedEmails.length === 0) {
      await withDbRetry(() =>
        this.repo.recordAuditLog({
          actorUserId,
          action: "admin.roles_synced",
          targetType: "system",
          metadata: {
            configuredCount: result.configuredEmails.length,
            promotedCount: 0,
            demotedCount: 0,
            activeAdminCount: result.activeAdminCount,
          },
        })
      );
    }
    return result;
  }

  async revokeUserSessions(
    actorUserId: string,
    targetUserId: string
  ): Promise<{ revokedSessions: number; targetEmail: string }> {
    if (!targetUserId.trim()) {
      throw new ValidationError("Target user ID is required.");
    }
    if (actorUserId === targetUserId) {
      throw new ValidationError(
        "Use normal Sign out in the sidebar to end your own session."
      );
    }

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const target = await this.repo.getUserForAdminAction(targetUserId, tx);
        if (!target) {
          throw new NotFoundError("Target user not found.");
        }

        const revokedSessions = await this.repo.revokeUserSessions(
          targetUserId,
          tx
        );

        await this.repo.recordAuditLog(
          {
            actorUserId,
            action: "admin.user_sessions_revoked",
            targetType: "user",
            targetId: target.id,
            metadata: {
              targetEmail: target.email,
              revokedSessions,
            },
          },
          tx
        );

        return { revokedSessions, targetEmail: target.email };
      })
    );
  }

  async setUserSuspension(
    actorUserId: string,
    targetUserId: string,
    suspended: boolean
  ): Promise<{
    userId: string;
    email: string;
    isSuspended: boolean;
    revokedSessions: number;
  }> {
    if (!targetUserId.trim()) {
      throw new ValidationError("Target user ID is required.");
    }
    if (actorUserId === targetUserId) {
      throw new ForbiddenError("You cannot suspend your own administrator account.");
    }

    return withDbRetry(() =>
      this.database.transaction(async (tx) => {
        const target = await this.repo.getUserForAdminAction(targetUserId, tx);
        if (!target) {
          throw new NotFoundError("Target user not found.");
        }

        if (suspended && target.role === "admin") {
          throw new ForbiddenError(
            "Active administrators cannot be suspended. Remove their email from ADMIN_EMAILS first."
          );
        }

        await this.repo.setUserSuspended(target.id, suspended, tx);
        const revokedSessions = suspended
          ? await this.repo.revokeUserSessions(target.id, tx)
          : 0;

        await this.repo.recordAuditLog(
          {
            actorUserId,
            action: suspended
              ? "admin.user_suspended"
              : "admin.user_unsuspended",
            targetType: "user",
            targetId: target.id,
            metadata: {
              targetEmail: target.email,
              revokedSessions,
            },
          },
          tx
        );

        return {
          userId: target.id,
          email: target.email,
          isSuspended: suspended,
          revokedSessions,
        };
      })
    );
  }
}

export const adminService = new AdminService();
