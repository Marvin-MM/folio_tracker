"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled route error:", error.digest ?? error.name);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md border-border bg-card shadow-none">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2 text-overdue">
            <AlertTriangle className="size-4" />
            <CardTitle className="text-base font-semibold text-foreground">
              Something went wrong
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            An unexpected error interrupted this page. Your saved data remains
            intact.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error.digest ? (
            <p className="mono-tabular rounded border border-border bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">
              Reference · {error.digest}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex gap-2 border-t border-border pt-4">
          <Button
            type="button"
            size="sm"
            onClick={reset}
            className="mira-row flex-1 gap-1.5 text-xs"
          >
            <RotateCcw className="size-3.5" />
            Try again
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="mira-row flex-1 text-xs"
          >
            <Link href="/app/inbox">Go to Inbox</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
