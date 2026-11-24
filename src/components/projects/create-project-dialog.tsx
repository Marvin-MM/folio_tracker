"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createProjectAction } from "@/actions/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { cn } from "@/lib/utils";
import type { ProjectColorToken } from "@/server/services/project-service";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COLOR_OPTIONS: Array<{
  value: ProjectColorToken;
  label: string;
  swatchClass: string;
}> = [
  { value: "collab", label: "Slate Cobalt", swatchClass: "bg-collab" },
  { value: "reminder", label: "Muted Ochre", swatchClass: "bg-reminder" },
  { value: "done", label: "Forest", swatchClass: "bg-done" },
  { value: "overdue", label: "Rust", swatchClass: "bg-overdue" },
];

export function CreateProjectDialog({
  open,
  onOpenChange,
}: CreateProjectDialogProps) {
  const router = useRouter();
  const invalidate = useInvalidateWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [colorToken, setColorToken] = useState<ProjectColorToken>("collab");
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setName("");
      setDescription("");
      setColorToken("collab");
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || isPending) return;

    startTransition(async () => {
      const result = await createProjectAction({
        name: name.trim(),
        description: description.trim() || null,
        colorToken,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      await invalidate(["sidebar", "projects"]);
      toast.success(`Project "${result.data.name}" created.`);
      handleOpenChange(false);
      router.push(`/app/projects/${result.data.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            New project
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Projects start private to you and become shared whenever you invite
            collaborators.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-project-name" className="text-xs">
              Project name
            </Label>
            <Input
              id="new-project-name"
              name="projectName"
              autoFocus
              required
              maxLength={100}
              placeholder="Q4 Product Launch"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mira-row bg-background text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-project-desc" className="text-xs">
              Description (optional)
            </Label>
            <Textarea
              id="new-project-desc"
              name="projectDescription"
              rows={3}
              placeholder="Brief scope, milestones, or shared context…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-background text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              Accent marker
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {COLOR_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setColorToken(option.value)}
                  className={cn(
                    "mira-row flex items-center gap-2 rounded-md border px-2.5 text-left text-xs transition-colors",
                    colorToken === option.value
                      ? "border-foreground bg-accent font-medium text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("size-2.5 rounded-full", option.swatchClass)}
                  />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              className="mira-row text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!name.trim() || isPending}
              className="mira-row px-4 text-xs"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-3 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create project"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
