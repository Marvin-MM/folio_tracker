import { Resend } from "resend";
import { APP_NAME } from "@/lib/constants";
import { inngest } from "@/server/inngest/client";
import { projectInvitedEvent } from "@/server/inngest/events";

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

function renderInviteHtml(params: {
  projectName: string;
  inviterName: string;
  role: "editor" | "viewer";
  inviteUrl: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background-color:#F9F8F6;color:#171614;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E6E4DF;border-radius:6px;">
      <tr>
        <td style="padding:24px 28px 10px 28px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#3B5B8A;">
          ${escapeHtml(APP_NAME)} · Shared Project Invitation
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 8px 28px;font-size:18px;font-weight:600;line-height:1.35;color:#171614;">
          Join &ldquo;${escapeHtml(params.projectName)}&rdquo;
        </td>
      </tr>
      <tr>
        <td style="padding:4px 28px 20px 28px;font-size:14px;line-height:1.6;color:#171614;">
          <p style="margin:0;">${escapeHtml(params.inviterName)} invited you to collaborate on <strong>${escapeHtml(params.projectName)}</strong> as an <strong>${escapeHtml(params.role)}</strong>.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 24px 28px;">
          <a href="${escapeHtml(params.inviteUrl)}" style="display:inline-block;padding:10px 18px;background:#171614;color:#F9F8F6;text-decoration:none;border-radius:5px;font-size:13px;font-weight:500;">
            Review &amp; Accept Invitation
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px 20px 28px;border-top:1px solid #E6E4DF;font-size:11px;color:#6E6B64;">
          This single-use invitation expires in 7 days. If you weren&rsquo;t expecting it, you can ignore this email.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export const sendProjectInviteFn = inngest.createFunction(
  {
    id: "send-project-invite",
    concurrency: { limit: 25 },
    retries: 4,
    triggers: [projectInvitedEvent],
  },
  async ({ event, step }) => {
    const { projectName, inviterName, email, role, inviteUrl } = event.data;

    await step.run("send-invite-email", async () => {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      if (!apiKey) {
        console.info(
          JSON.stringify({
            event: "project.invite.email.dispatched",
            transport: "dev-console",
            recipient: maskEmail(email),
            role,
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
        to: email,
        subject: `${inviterName} invited you to "${projectName}" on ${APP_NAME}`,
        html: renderInviteHtml({ projectName, inviterName, role, inviteUrl }),
        text: `${inviterName} invited you to join "${projectName}" as ${role} on ${APP_NAME}.\n\nAccept invitation: ${inviteUrl}\n\nExpires in 7 days.`,
      });

      if (error) {
        throw new Error(`Resend project invite email failed: ${error.message}`);
      }
    });

    return { dispatched: true };
  }
);
