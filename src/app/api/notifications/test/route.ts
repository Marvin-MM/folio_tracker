import { handleTestNotificationPost } from "@/server/http/test-notification-handler";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  return handleTestNotificationPost();
}
