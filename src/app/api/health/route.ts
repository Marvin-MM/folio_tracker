import { NextResponse } from "next/server";
import { libsqlClient } from "@/server/db";


export async function GET() {
  try {
    await libsqlClient.execute("SELECT 1");
    return NextResponse.json(
      {
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );
  }
}
