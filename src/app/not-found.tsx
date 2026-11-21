import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function GlobalNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md border-border bg-card shadow-none">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileQuestion className="size-4" />
            <CardTitle className="text-base font-semibold text-foreground">
              Page not found
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            The resource you requested does not exist or you do not have access
            to view it.
          </CardDescription>
        </CardHeader>
        <CardFooter className="border-t border-border pt-4">
          <Button asChild size="sm" className="mira-row w-full text-xs">
            <Link href="/app/inbox">Return to Inbox</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
