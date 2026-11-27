"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  acceptGroupInvitationAction,
  createHabitGroupAction,
  declineGroupInvitationAction,
} from "@/actions/habit-groups";
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
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import type {
  GroupInvitationSummary,
  GroupSummary,
} from "@/server/dal/habit-groups";

interface GroupsOverviewViewProps {
  groups: GroupSummary[];
  invitations: GroupInvitationSummary[];
}

type SimpleActionResult = {
  ok: boolean;
  error?: { message: string };
};

export function GroupsOverviewView({
  groups,
  invitations,
}: GroupsOverviewViewProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emails, setEmails] = useState("");
  const [isPending, startTransition] = useTransition();
  const invalidate = useInvalidateWorkspace();

  const refresh = async () => {
    await invalidate(["habits", "notifications"]);
  };

  const run = (
    action: () => Promise<SimpleActionResult>,
    successMessage: string,
    onSuccess?: () => void | Promise<void>
  ) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error?.message ?? "Something went wrong.");
        return;
      }
      toast.success(successMessage);
      await onSuccess?.();
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const memberEmails = emails
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    run(
      () =>
        createHabitGroupAction({
          name,
          description: description.trim() || null,
          memberEmails,
        }),
      "Group created. Invitations sent.",
      async () => {
        setOpen(false);
        setName("");
        setDescription("");
        setEmails("");
        await refresh();
      }
    );
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

      {invitations.length > 0 ? (
        <Card className="border-collab/35">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Group invitations</CardTitle>
            <CardDescription>
              Accepting adds you to the group; nothing is shared without your
              consent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{invitation.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    Invited by {invitation.inviterName}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () =>
                          acceptGroupInvitationAction({
                            groupId: invitation.id,
                          }),
                        "Invitation accepted.",
                        refresh
                      )
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () =>
                          declineGroupInvitationAction({
                            groupId: invitation.id,
                          }),
                        "Invitation declined.",
                        refresh
                      )
                    }
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

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
              Invite at least two FOLIO users by email. They must accept before
              they can see shared progress or post weekly reviews.
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
                Separate with commas, semicolons, or new lines. Unknown emails
                are ignored.
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
