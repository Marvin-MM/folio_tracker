"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OfflineRetryButton() {
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => window.location.reload()}
      className="mira-row w-full gap-1.5 text-xs"
    >
      <RotateCcw className="size-3.5" />
      Retry connection
    </Button>
  );
}
