import { handleTestNotificationPost } from "@/server/http/test-notification-handler";


export async function POST(): Promise<Response> {
  return handleTestNotificationPost();
}
