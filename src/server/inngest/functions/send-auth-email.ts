import {
  INNGEST_CONCURRENCY_LIMIT,
  inngest,
} from "@/server/inngest/client";
import { authEmailEvent } from "@/server/inngest/events";
import { createDirectAuthEmailDispatcher } from "@/server/providers/auth-email-dispatcher";

const directDispatcher = createDirectAuthEmailDispatcher();

export const sendAuthEmailFn = inngest.createFunction(
  {
    id: "send-auth-email",
    concurrency: { limit: INNGEST_CONCURRENCY_LIMIT },
    retries: 4,
    triggers: [authEmailEvent],
  },
  async ({ event, step }) => {
    const { kind, to, recipientName, actionUrl } = event.data;

    await step.run("send-transactional-auth-email", async () => {
      if (kind === "verification") {
        await directDispatcher.sendVerificationEmail({
          to,
          recipientName,
          verificationUrl: actionUrl,
        });
      } else {
        await directDispatcher.sendPasswordResetEmail({
          to,
          recipientName,
          resetUrl: actionUrl,
        });
      }
    });

    return { dispatched: true, kind };
  }
);
