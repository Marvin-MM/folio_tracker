import { Resend } from "resend";
import { APP_NAME } from "@/lib/constants";
import { inngest } from "@/server/inngest/client";

export interface VerificationEmailPayload {
  to: string;
  recipientName: string;
  verificationUrl: string;
}

export interface PasswordResetEmailPayload {
  to: string;
  recipientName: string;
  resetUrl: string;
}

export interface AuthEmailDispatcher {
  sendVerificationEmail(payload: VerificationEmailPayload): Promise<void>;
  sendPasswordResetEmail(payload: PasswordResetEmailPayload): Promise<void>;
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  const prefix = localPart.slice(0, 2);
  return `${prefix}***@${domain}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPaperEmailHtml(params: {
  heading: string;
  greeting: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footnote: string;
}): string {
  const heading = escapeHtml(params.heading);
  const greeting = escapeHtml(params.greeting);
  const body = escapeHtml(params.body);
  const ctaLabel = escapeHtml(params.ctaLabel);
  const ctaUrl = escapeHtml(params.ctaUrl);
  const footnote = escapeHtml(params.footnote);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background-color:#F9F8F6;color:#171614;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E6E4DF;border-radius:6px;">
      <tr>
        <td style="padding:28px 28px 12px 28px;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#6E6B64;">
          ${escapeHtml(APP_NAME)}
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 8px 28px;font-size:18px;font-weight:600;line-height:1.35;color:#171614;">
          ${heading}
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 20px 28px;font-size:14px;line-height:1.6;color:#171614;">
          <p style="margin:0 0 12px 0;">${greeting}</p>
          <p style="margin:0;">${body}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 24px 28px;">
          <a href="${ctaUrl}" style="display:inline-block;padding:10px 18px;background:#171614;color:#F9F8F6;text-decoration:none;border-radius:5px;font-size:13px;font-weight:500;">
            ${ctaLabel}
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px 24px 28px;border-top:1px solid #E6E4DF;font-size:12px;line-height:1.5;color:#6E6B64;">
          ${footnote}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Local development email dispatcher used when `RESEND_API_KEY` is absent.
 * Intentionally logs structured, redacted metadata only (never secrets or raw tokens).
 */
export class ConsoleAuthEmailDispatcher implements AuthEmailDispatcher {
  async sendVerificationEmail(payload: VerificationEmailPayload): Promise<void> {
    console.info(
      JSON.stringify({
        event: "auth.email.verification.dispatched",
        transport: "dev-console",
        recipient: maskEmail(payload.to),
        timestamp: new Date().toISOString(),
      })
    );
  }

  async sendPasswordResetEmail(
    payload: PasswordResetEmailPayload
  ): Promise<void> {
    console.info(
      JSON.stringify({
        event: "auth.email.password_reset.dispatched",
        transport: "dev-console",
        recipient: maskEmail(payload.to),
        timestamp: new Date().toISOString(),
      })
    );
  }
}

export class ResendAuthEmailDispatcher implements AuthEmailDispatcher {
  private readonly resend: Resend;
  private readonly fromAddress: string;

  constructor(apiKey: string, fromAddress = `${APP_NAME} <onboarding@resend.dev>`) {
    this.resend = new Resend(apiKey);
    this.fromAddress = fromAddress;
  }

  async sendVerificationEmail(payload: VerificationEmailPayload): Promise<void> {
    const html = renderPaperEmailHtml({
      heading: "Verify your email address",
      greeting: `Hi ${payload.recipientName},`,
      body: `Confirm your email address to finish setting up your ${APP_NAME} account.`,
      ctaLabel: "Verify email",
      ctaUrl: payload.verificationUrl,
      footnote: "If you did not create this account, you can safely ignore this message.",
    });

    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to: payload.to,
      subject: `Verify your ${APP_NAME} email`,
      html,
      text: `Hi ${payload.recipientName},\n\nVerify your ${APP_NAME} email: ${payload.verificationUrl}\n\nIf you did not request this, ignore this email.`,
    });

    if (error) {
      throw new Error(`Resend verification email failed: ${error.message}`);
    }
  }

  async sendPasswordResetEmail(
    payload: PasswordResetEmailPayload
  ): Promise<void> {
    const html = renderPaperEmailHtml({
      heading: "Reset your password",
      greeting: `Hi ${payload.recipientName},`,
      body: `We received a request to reset your ${APP_NAME} password. Completing a reset signs out all active sessions.`,
      ctaLabel: "Reset password",
      ctaUrl: payload.resetUrl,
      footnote: "If you did not request a password reset, you can safely ignore this message.",
    });

    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to: payload.to,
      subject: `Reset your ${APP_NAME} password`,
      html,
      text: `Hi ${payload.recipientName},\n\nReset your ${APP_NAME} password: ${payload.resetUrl}\n\nAll active sessions will be revoked upon reset.`,
    });

    if (error) {
      throw new Error(`Resend password reset email failed: ${error.message}`);
    }
  }
}

export function createDirectAuthEmailDispatcher(): AuthEmailDispatcher {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromAddress =
    process.env.EMAIL_FROM?.trim() || `${APP_NAME} <onboarding@resend.dev>`;
  if (apiKey) {
    return new ResendAuthEmailDispatcher(apiKey, fromAddress);
  }
  return new ConsoleAuthEmailDispatcher();
}

/**
 * Durable Phase 2 auth email dispatcher routing verification & password reset
 * emails asynchronously through Inngest (`app/auth.email`) with automatic retries.
 * Falls back to direct delivery in local dev if the local Inngest Dev Server is offline.
 */
export class InngestAuthEmailDispatcher implements AuthEmailDispatcher {
  constructor(
    private readonly directFallback: AuthEmailDispatcher = createDirectAuthEmailDispatcher()
  ) {}

  async sendVerificationEmail(payload: VerificationEmailPayload): Promise<void> {
    try {
      await inngest.send({
        name: "app/auth.email",
        data: {
          kind: "verification",
          to: payload.to,
          recipientName: payload.recipientName,
          actionUrl: payload.verificationUrl,
        },
      });
    } catch {
      await this.directFallback.sendVerificationEmail(payload);
    }
  }

  async sendPasswordResetEmail(
    payload: PasswordResetEmailPayload
  ): Promise<void> {
    try {
      await inngest.send({
        name: "app/auth.email",
        data: {
          kind: "password_reset",
          to: payload.to,
          recipientName: payload.recipientName,
          actionUrl: payload.resetUrl,
        },
      });
    } catch {
      await this.directFallback.sendPasswordResetEmail(payload);
    }
  }
}

export function createAuthEmailDispatcher(): AuthEmailDispatcher {
  return new InngestAuthEmailDispatcher(createDirectAuthEmailDispatcher());
}
