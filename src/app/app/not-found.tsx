import Link from "next/link";
import { FolderX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppWorkspaceNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md space-y-3 rounded-md border border-border bg-card p-5 text-center">
        <FolderX className="mx-auto size-5 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">
          Workspace item not found
        </h2>
        <p className="text-xs text-muted-foreground">
          This project or item may have been removed, or your account does not
          have permission to view it.
        </p>
        <div className="pt-1">
          <Button asChild size="sm" className="mira-row text-xs">
            <Link href="/app/inbox">Return to Inbox</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
