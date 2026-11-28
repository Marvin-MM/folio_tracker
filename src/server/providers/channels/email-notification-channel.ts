import { formatInTimeZone } from "date-fns-tz";
import { Resend } from "resend";
import { APP_NAME } from "@/lib/constants";
import {
  notificationRepository,
  type NotificationRepository,
} from "@/server/dal/notification-repository";
import {
  userRepository,
  type UserRepository,
} from "@/server/dal/user-repository";
import type {
  NotificationChannel,
  NotificationDispatchResult,
  NotificationPayload,
} from "@/server/providers/notification-channel";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

function renderReminderEmailHtml(params: {
  recipientName: string;
  title: string;
  body: string;
  formattedTime: string | null;
  actionUrl: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background-color:#F9F8F6;color:#171614;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E6E4DF;border-radius:6px;">
      <tr>
        <td style="padding:24px 28px 10px 28px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#B4690E;">
          ${escapeHtml(APP_NAME)} · Reminder
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 8px 28px;font-size:17px;font-weight:600;line-height:1.35;color:#171614;">
          ${escapeHtml(params.title)}
        </td>
      </tr>
      ${
        params.formattedTime
          ? `<tr><td style="padding:0 28px 12px 28px;font-size:12px;font-family:ui-monospace,SFMono-Regular,monospace;color:#6E6B64;">${escapeHtml(params.formattedTime)}</td></tr>`
          : ""
      }
      <tr>
        <td style="padding:4px 28px 20px 28px;font-size:14px;line-height:1.6;color:#171614;">
          <p style="margin:0 0 10px 0;">Hi ${escapeHtml(params.recipientName)},</p>
          <p style="margin:0;color:#6E6B64;">${escapeHtml(params.body)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 24px 28px;">
          <a href="${escapeHtml(params.actionUrl)}" style="display:inline-block;padding:9px 16px;background:#171614;color:#F9F8F6;text-decoration:none;border-radius:5px;font-size:13px;font-weight:500;">
            Open in ${escapeHtml(APP_NAME)}
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px 20px 28px;border-top:1px solid #E6E4DF;font-size:11px;color:#6E6B64;">
          Manage email reminder settings anytime inside ${escapeHtml(APP_NAME)} Settings.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface EmailTransport {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
}

class DefaultReminderEmailTransport implements EmailTransport {
  async send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      console.info(
        JSON.stringify({
          event: "reminder.email.dispatched",
          transport: "dev-console",
          recipient: maskEmail(input.to),
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    const from =
      process.env.EMAIL_FROM?.trim() || `${APP_NAME} <onboarding@resend.dev>`;
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (error) {
      throw new Error(`Resend reminder email failed: ${error.message}`);
    }
  }
}

export class EmailNotificationChannel implements NotificationChannel {
  readonly name = "email";

  constructor(
    private readonly usersRepo: UserRepository = userRepository,
    private readonly notifRepo: NotificationRepository = notificationRepository,
    private readonly transport: EmailTransport = new DefaultReminderEmailTransport()
  ) {}

  async send(
    payload: NotificationPayload
  ): Promise<NotificationDispatchResult> {
    const [user, pushCount] = await Promise.all([
      this.usersRepo.getById(payload.userId),
      this.notifRepo.countPushSubscriptionsForUser(payload.userId),
    ]);

    if (!user || user.isSuspended) {
      return {
        channel: this.name,
        delivered: false,
        skipped: true,
        detail: !user ? "User not found." : "User account is suspended.",
      };
    }

    // Send email if user opted into email reminders OR has zero active push subscriptions
    if (!user.emailRemindersEnabled && pushCount > 0) {
      return {
        channel: this.name,
        delivered: false,
        skipped: true,
        detail: "Email reminders disabled and active push subscriptions exist.",
      };
    }

    const tz = payload.timezone || user.timezone || "UTC";
    let formattedTime: string | null = null;
    if (payload.remindAt) {
      try {
        formattedTime = `${formatInTimeZone(payload.remindAt, tz, "EEE, MMM d · HH:mm")} (${tz})`;
      } catch {
        formattedTime = `${formatInTimeZone(payload.remindAt, "UTC", "EEE, MMM d · HH:mm")} (UTC)`;
      }
    }

    const baseUrl =
      process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000";
    const actionUrl = `${baseUrl}${payload.deepLink.startsWith("/") ? payload.deepLink : "/app/inbox"}`;

    const html = renderReminderEmailHtml({
      recipientName: user.name,
      title: payload.title,
      body: payload.body,
      formattedTime,
      actionUrl,
    });

    await this.transport.send({
      to: user.email,
      subject: `Reminder: ${payload.title}`,
      html,
      text: `${payload.title}\n${formattedTime ? `${formattedTime}\n` : ""}\n${payload.body}\n\nOpen: ${actionUrl}`,
    });

    return {
      channel: this.name,
      delivered: true,
    };
  }
}
