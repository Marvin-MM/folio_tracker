import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { OfflineRetryButton } from "@/components/pwa/offline-retry-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Offline",
  robots: {
    index: false,
    follow: false,
  },
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center border-b border-border px-4 md:px-6">
        <span className="inline-flex items-center gap-2 text-sm font-medium tracking-tight text-foreground">
          <BrandMark />
          <span>{APP_NAME}</span>
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="w-full max-w-sm border-border bg-card shadow-none">
          <CardHeader className="space-y-1.5">
            <div className="flex items-center gap-2 text-reminder">
              <WifiOff className="size-4 shrink-0" aria-hidden="true" />
              <h1 className="text-base font-semibold leading-none text-foreground">
                You&rsquo;re offline
              </h1>
            </div>
            <CardDescription className="text-xs leading-relaxed text-muted-foreground">
              {APP_NAME} needs an active network connection to load fresh
              workspace data securely from your private ledger.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Once your connection returns, tap retry to pick up right where you
            left off.
          </CardContent>
          <CardFooter className="border-t border-border pt-4">
            <OfflineRetryButton />
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
