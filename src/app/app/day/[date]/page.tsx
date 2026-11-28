import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DayPageClient } from "@/components/habits/day-page-client";
import { isFeatureEnabled } from "@/config/features";
import { requireSession } from "@/server/dal/auth-guard";
import { isValidDateKey } from "@/server/domain/habit-analytics";
import { habitService } from "@/server/services/habit-service";
import DayPageLoading from "./loading";

export const metadata: Metadata = {
  title: "Day",
  robots: {
    index: false,
    follow: false,
  },
};

interface DayPageProps {
  params: Promise<{ date: string }>;
}

async function DayPageContent({ params }: DayPageProps) {
  const [{ user }, { date }] = await Promise.all([requireSession(), params]);
  if (!isFeatureEnabled("dayPage") || !isValidDateKey(date)) {
    notFound();
  }

  const timezone = user.timezone || "UTC";
  if (date > habitService.getTodayDateKey(timezone)) {
    notFound();
  }

  const workspace = await habitService.getDayWorkspace(user.id, timezone, date);
  return <DayPageClient key={workspace.dateKey} initialWorkspace={workspace} />;
}

export default function DayPage({ params }: DayPageProps) {
  return (
    <Suspense fallback={<DayPageLoading />}>
      <DayPageContent params={params} />
    </Suspense>
  );
}
