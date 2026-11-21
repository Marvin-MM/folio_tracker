import type { NextRequest } from "next/server";
import {
  authHandler,
  handleRateLimitedAuthPost,
} from "@/server/http/auth-rate-limit-handler";

export const GET = authHandler.GET;

export async function POST(request: NextRequest): Promise<Response> {
  return handleRateLimitedAuthPost(request);
}
