"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { createHabitGroupAction } from "@/actions/habit-groups";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { GroupSummary } from "@/server/dal/habit-groups";

interface GroupsOverviewViewProps {
  groups: GroupSummary[];
}

export function GroupsOverviewView({ groups }: GroupsOverviewViewProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emails, setEmails] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const memberEmails = emails
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    startTransition(async () => {
      const result = await createHabitGroupAction({
        name,
        description: description.trim() || null,
        memberEmails,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success("Group created. Share a habit to get started.");
      setOpen(false);
      setName("");
      setDescription("");
      setEmails("");
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Accountability groups of 3 or more people. Members see only habits
          that their owners explicitly share.
        </p>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          New group
        </Button>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No groups yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create one with at least two partner email addresses.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={`/app/habits/groups/${group.id}`}
              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{group.name}</CardTitle>
                    <Badge variant="outline" className="capitalize">
                      {group.myRole}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {group.description || "Weekly reviews and streak nudges"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {group.memberCount} members · {group.sharedHabitCount} shared
                  habits
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create an accountability group</DialogTitle>
            <DialogDescription>
              Add at least two verified FOLIO users by email. Everyone can post
              weekly reviews and send streak nudges.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Group name</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Monday Momentum"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-description">Description (optional)</Label>
              <Textarea
                id="group-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                maxLength={280}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-emails">Partner emails</Label>
              <Textarea
                id="group-emails"
                value={emails}
                onChange={(event) => setEmails(event.target.value)}
                rows={3}
                placeholder={"partner@example.com\nsecond@example.com"}
              />
              <p className="text-[11px] text-muted-foreground">
                Separate with commas, semicolons, or new lines.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Create group
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
