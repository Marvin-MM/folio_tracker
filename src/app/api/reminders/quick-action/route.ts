import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import { DalError } from "@/server/dal/errors";
import { reminderService } from "@/server/services/reminder-service";
import { taskService } from "@/server/services/task-service";


const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
};

const quickActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("snooze_15m"),
    reminderId: z.string().min(1),
  }),
  z.object({
    action: z.literal("mark_done"),
    taskId: z.string().min(1),
  }),
]);

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession();
    const rawBody: unknown = await request.json();
    const parsed = quickActionSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid notification action payload." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (parsed.data.action === "snooze_15m") {
      const updated = await reminderService.snoozeReminder(
        user.id,
        parsed.data.reminderId,
        "15m",
        user.timezone || "UTC"
      );
      return NextResponse.json(
        {
          ok: true,
          reminderId: updated.id,
          remindAt: updated.remindAt,
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    const result = await taskService.toggleTaskStatus(
      user.id,
      parsed.data.taskId,
      "done"
    );
    return NextResponse.json(
      {
        ok: true,
        taskId: result.task.id,
        status: result.task.status,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    if (error instanceof DalError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.statusCode, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      { ok: false, error: "Unable to process notification action." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
