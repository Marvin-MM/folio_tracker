import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DayPageClient } from "@/components/habits/day-page-client";
import { isFeatureEnabled } from "@/config/features";
import { requireSession } from "@/server/dal/auth-guard";
import {
  getLocalDateKey,
  isValidDateKey,
} from "@/server/domain/habit-analytics";
import { habitService } from "@/server/services/habit-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Day",
};

interface DayPageProps {
  params: Promise<{ date: string }>;
}

export default async function DayPage({ params }: DayPageProps) {
  const { date } = await params;
  if (!isFeatureEnabled("dayPage") || !isValidDateKey(date)) {
    notFound();
  }

  const { user } = await requireSession();
  const timezone = user.timezone || "UTC";
  if (date > getLocalDateKey(Date.now(), timezone)) {
    notFound();
  }

  const workspace = await habitService.getDayWorkspace(user.id, timezone, date);
  return <DayPageClient key={workspace.dateKey} initialWorkspace={workspace} />;
}
