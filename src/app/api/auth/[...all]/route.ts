import type { NextRequest } from "next/server";
import {
  handleAuthGet,
  handleRateLimitedAuthPost,
} from "@/server/http/auth-rate-limit-handler";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return handleAuthGet(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handleRateLimitedAuthPost(request);
}
