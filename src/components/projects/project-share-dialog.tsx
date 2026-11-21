"use client";

import { useState, useTransition, type FormEvent } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Check, Copy, Loader2, MailPlus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  createProjectInvitationAction,
  removeProjectMemberAction,
  revokeProjectInvitationAction,
  updateProjectMemberRoleAction,
} from "@/actions/projects";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { ProjectMemberWithUser } from "@/server/dal/project-repository";
import type {
  InvitationRole,
  ProjectInvitationRecord,
} from "@/server/db/schema";

interface ProjectShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  members: ProjectMemberWithUser[];
  pendingInvitations: ProjectInvitationRecord[];
  timezone: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
  );
}

export function ProjectShareDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  members,
  pendingInvitations,
  timezone,
}: ProjectShareDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("editor");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setEmail("");
      setLastInviteUrl(null);
      setCopied(false);
    }
    onOpenChange(nextOpen);
  };

  const handleSendInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || isPending) return;

    startTransition(async () => {
      const result = await createProjectInvitationAction({
        projectId,
        email: email.trim(),
        role,
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      const fullUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}${result.data.invitePath}`
          : result.data.invitePath;
      setLastInviteUrl(fullUrl);
      setEmail("");
      toast.success("Invitation created and dispatched.");
    });
  };

  const handleCopyLink = async () => {
    if (!lastInviteUrl) return;
    try {
      await navigator.clipboard.writeText(lastInviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Could not access clipboard.");
    }
  };

  const handleRevoke = (invitationId: string) => {
    startTransition(async () => {
      const res = await revokeProjectInvitationAction({
        projectId,
        invitationId,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success("Invitation revoked.");
    });
  };

  const handleRoleChange = (targetUserId: string, nextRole: InvitationRole) => {
    startTransition(async () => {
      const res = await updateProjectMemberRoleAction({
        projectId,
        targetUserId,
        role: nextRole,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Role updated to ${nextRole}.`);
    });
  };

  const handleRemoveMember = (targetUserId: string, memberName: string) => {
    startTransition(async () => {
      const res = await removeProjectMemberAction({
        projectId,
        targetUserId,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Removed ${memberName} from project.`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-card sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-collab" />
            Share &ldquo;{projectName}&rdquo;
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Invite collaborators via single-use 7-day cryptographic email links.
            Only SHA-256 token hashes are stored in the database.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSendInvite} className="space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-[1fr_116px]">
            <div className="space-y-1">
              <Label htmlFor="invite-email" className="text-[11px]">
                Collaborator email
              </Label>
              <Input
                id="invite-email"
                name="inviteEmail"
                type="email"
                required
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mira-row bg-background text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="invite-role" className="text-[11px]">
                Role
              </Label>
              <Select
                name="inviteRole"
                value={role}
                onValueChange={(val) => setRole(val as InvitationRole)}
              >
                <SelectTrigger
                  id="invite-role"
                  className="mira-row bg-background text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor" className="text-xs">
                    Editor
                  </SelectItem>
                  <SelectItem value="viewer" className="text-xs">
                    Viewer
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            type="submit"
            size="sm"
            disabled={!email.trim() || isPending}
            className="mira-row w-full gap-1.5 text-xs"
          >
            {isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Sending invite…
              </>
            ) : (
              <>
                <MailPlus className="size-3.5" />
                Send invitation
              </>
            )}
          </Button>
        </form>

        {lastInviteUrl ? (
          <div
            role="status"
            className="space-y-1.5 rounded-md border border-collab/35 bg-collab/10 p-2.5 text-xs"
          >
            <p className="font-medium text-foreground">
              One-time invite link generated
            </p>
            <p className="text-[11px] text-muted-foreground">
              Copy now if you want to share directly — the raw token is never
              shown again.
            </p>
            <div className="flex items-center gap-1.5">
              <Input
                readOnly
                name="generatedInviteLink"
                aria-label="Generated invite link"
                value={lastInviteUrl}
                className="mono-tabular h-7 flex-1 bg-background text-[11px]"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="h-7 gap-1 px-2 text-xs"
              >
                {copied ? (
                  <Check className="size-3 text-done" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : null}

        {pendingInvitations.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Pending invitations ({pendingInvitations.length})
              </p>
              <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
                {pendingInvitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="mira-row flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {inv.email}
                      </p>
                      <p className="mono-tabular text-[10px] text-muted-foreground">
                        {inv.role} · expires{" "}
                        {formatInTimeZone(inv.expiresAt, timezone, "MMM d")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={isPending}
                      onClick={() => handleRevoke(inv.id)}
                      className="h-6 px-2 text-[11px] text-overdue hover:text-overdue"
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <Separator />

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Members ({members.length})
          </p>
          <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background">
            {members.map((member) => (
              <div
                key={member.userId}
                className="mira-row flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar className="size-6 border border-border">
                    <AvatarFallback className="bg-muted text-[10px]">
                      {initials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {member.name}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                </div>

                {member.role === "owner" ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-normal capitalize"
                  >
                    Owner
                  </Badge>
                ) : (
                  <div className="flex items-center gap-1">
                    <Select
                      value={member.role}
                      disabled={isPending}
                      onValueChange={(val) =>
                        handleRoleChange(member.userId, val as InvitationRole)
                      }
                    >
                      <SelectTrigger
                        aria-label={`Role for ${member.name}`}
                        className="h-6 w-24 bg-card text-[11px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor" className="text-xs">
                          Editor
                        </SelectItem>
                        <SelectItem value="viewer" className="text-xs">
                          Viewer
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isPending}
                      onClick={() =>
                        handleRemoveMember(member.userId, member.name)
                      }
                      aria-label={`Remove ${member.name}`}
                      className="size-6 text-muted-foreground hover:text-overdue"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
