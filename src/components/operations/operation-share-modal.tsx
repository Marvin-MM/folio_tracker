"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Copy,
  FolderKanban,
  Globe,
  Link2,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  inviteOperationByEmailAction,
  inviteOperationQuickPickAction,
  revokeOperationInviteAction,
  revokeOperationMemberAction,
  rotateUnlistedOperationLinkAction,
  updateOperationMemberRoleAction,
  updateOperationProjectSharingAction,
  updateOperationVisibilityAction,
} from "@/actions/operations";
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
import { Switch } from "@/components/ui/switch";
import {
  useInvalidateWorkspace,
  useOperationShareQuery,
} from "@/hooks/use-workspace-queries";
import { cn } from "@/lib/utils";
import type {
  OperationMemberRole,
  OperationVisibility,
} from "@/server/db/schema";
import type { SecretScanFinding } from "@/server/domain/operations";

interface OperationShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  operationId: string;
  operationSlug: string;
  initialVisibility: OperationVisibility;
  initialAllowForking: boolean;
  initialShareWithProject: boolean;
}

const subscribeOrigin = () => () => {};
const getClientOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function OperationShareModal({
  open,
  onOpenChange,
  userId,
  operationId,
  operationSlug,
  initialVisibility,
  initialAllowForking,
  initialShareWithProject,
}: OperationShareModalProps) {
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();

  const { data: dashboard, isLoading } = useOperationShareQuery(
    userId,
    operationId,
    open
  );

  const [shareTab, setShareTab] = useState<"circle" | "project" | "email">(
    "circle"
  );
  const [quickPickRole, setQuickPickRole] =
    useState<OperationMemberRole>("viewer");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OperationMemberRole>("viewer");
  const [mintedUnlistedToken, setMintedUnlistedToken] = useState<string | null>(
    null
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const origin = useSyncExternalStore(
    subscribeOrigin,
    getClientOrigin,
    getServerOrigin
  );

  // Secret Scanner gate state when flipping to Unlisted or Public
  const [pendingTargetVisibility, setPendingTargetVisibility] =
    useState<OperationVisibility | null>(null);
  const [secretBlockers, setSecretBlockers] = useState<SecretScanFinding[]>([]);
  const [secretWarnings, setSecretWarnings] = useState<SecretScanFinding[]>([]);
  const [ackWarningsChecked, setAckWarningsChecked] = useState(false);

  const visibility = dashboard?.visibility ?? initialVisibility;
  const allowForking = dashboard?.allowForking ?? initialAllowForking;
  const shareWithProject =
    dashboard?.shareWithProject ?? initialShareWithProject;
  const slug = dashboard?.operationSlug ?? operationSlug;

  const publicUrl = `${origin}/ops/${slug}`;
  const unlistedShareUrl = mintedUnlistedToken
    ? `${origin}/ops/${slug}?token=${encodeURIComponent(mintedUnlistedToken)}`
    : null;

  const copyText = async (key: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(`${label} copied.`);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      toast.error("Unable to copy to clipboard.");
    }
  };

  const applyVisibility = (
    nextVisibility: OperationVisibility,
    options: { allowForking?: boolean; acknowledgeWarnings?: boolean } = {}
  ) => {
    setSecretBlockers([]);
    setSecretWarnings([]);
    setPendingTargetVisibility(nextVisibility);

    startTransition(async () => {
      const result = await updateOperationVisibilityAction({
        operationId,
        visibility: nextVisibility,
        allowForking: options.allowForking ?? allowForking,
        acknowledgeWarnings: options.acknowledgeWarnings,
      });

      if (!result.ok) {
        if (result.error.code === "SECRET_SCAN_BLOCKED") {
          setSecretBlockers(result.error.secretFindings ?? []);
        } else if (
          result.error.code === "SECRET_SCAN_WARNINGS_REQUIRE_ACK"
        ) {
          setSecretWarnings(result.error.secretWarnings ?? []);
          setAckWarningsChecked(false);
        }
        toast.error(result.error.message);
        return;
      }

      setPendingTargetVisibility(null);
      setAckWarningsChecked(false);
      if (result.data.mintedUnlistedToken) {
        setMintedUnlistedToken(result.data.mintedUnlistedToken);
      } else if (nextVisibility !== "unlisted") {
        setMintedUnlistedToken(null);
      }

      await invalidate(["operations"]);
      toast.success(`Visibility updated to ${nextVisibility}.`);
    });
  };

  const handleToggleAllowForking = (next: boolean) => {
    startTransition(async () => {
      const result = await updateOperationVisibilityAction({
        operationId,
        visibility,
        allowForking: next,
        acknowledgeWarnings: true,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations"]);
      toast.success(next ? "Forking enabled." : "Forking disabled.");
    });
  };

  const handleRotateUnlistedLink = () => {
    startTransition(async () => {
      const result = await rotateUnlistedOperationLinkAction({ operationId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setMintedUnlistedToken(result.data.mintedUnlistedToken);
      await invalidate(["operations"]);
      toast.success("New unlisted link generated. Previous links revoked.");
    });
  };

  const handleToggleProjectSharing = (next: boolean) => {
    if (!dashboard?.linkedProject) return;
    startTransition(async () => {
      const result = await updateOperationProjectSharingAction({
        operationId,
        projectId: dashboard.linkedProject!.id,
        shareWithProject: next,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations"]);
      toast.success(
        next
          ? "Shared with linked project team."
          : "Project team access turned off."
      );
    });
  };

  const handleQuickPickInvite = (targetUserId: string) => {
    startTransition(async () => {
      const result = await inviteOperationQuickPickAction({
        operationId,
        targetUserId,
        role: quickPickRole,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations"]);
      toast.success(result.data.message);
    });
  };

  const handleEmailInvite = () => {
    if (!inviteEmail.trim()) return;
    startTransition(async () => {
      const result = await inviteOperationByEmailAction({
        operationId,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setInviteEmail("");
      await invalidate(["operations"]);
      toast.success(result.data.message);
    });
  };

  const handleUpdateMemberRole = (
    targetUserId: string,
    role: OperationMemberRole
  ) => {
    startTransition(async () => {
      const result = await updateOperationMemberRoleAction({
        operationId,
        targetUserId,
        role,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations"]);
      toast.success(`Role updated to ${role}.`);
    });
  };

  const handleRevokeMember = (targetUserId: string) => {
    startTransition(async () => {
      const result = await revokeOperationMemberAction({
        operationId,
        targetUserId,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations"]);
      toast.success("Member access revoked immediately.");
    });
  };

  const handleRevokeInvite = (invitationId: string) => {
    startTransition(async () => {
      const result = await revokeOperationInviteAction({
        operationId,
        invitationId,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      await invalidate(["operations"]);
      toast.success("Pending invitation revoked.");
    });
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    setSecretBlockers([]);
    setSecretWarnings([]);
    setPendingTargetVisibility(null);
    setAckWarningsChecked(false);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Share &amp; Access Control
          </DialogTitle>
          <DialogDescription className="text-xs">
            Choose who can view, run, fork, or collaborate on this blueprint.
            Secret scanning is enforced before Unlisted or Public publishing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* 1. Visibility State */}
          <section className="space-y-3 rounded-lg border border-border bg-card p-3.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Visibility</Label>
              <span className="text-[11px] capitalize text-muted-foreground">
                Current: {visibility}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  {
                    value: "private",
                    label: "Private",
                    desc: "Owner & invited",
                    icon: Lock,
                  },
                  {
                    value: "unlisted",
                    label: "Unlisted",
                    desc: "Secret token URL",
                    icon: Link2,
                  },
                  {
                    value: "public",
                    label: "Public",
                    desc: "Explore & profile",
                    icon: Globe,
                  },
                ] as const
              ).map((opt) => {
                const Icon = opt.icon;
                const active = visibility === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      if (opt.value !== visibility) {
                        applyVisibility(opt.value);
                      }
                    }}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-md border p-2.5 text-left transition-colors",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground hover:border-foreground/40"
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                      <Icon className="size-3.5" />
                      {opt.label}
                    </span>
                    <span
                      className={cn(
                        "text-[10px]",
                        active
                          ? "text-background/80"
                          : "text-muted-foreground"
                      )}
                    >
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Secret Scanner Hard Blocker */}
            {secretBlockers.length > 0 ? (
              <div
                role="alert"
                data-testid="share-secret-blockers"
                className="space-y-2 rounded-md border border-overdue/55 bg-overdue/10 p-3 text-xs"
              >
                <div className="flex items-center gap-1.5 font-semibold text-overdue">
                  <ShieldAlert className="size-4 shrink-0" />
                  <span>
                    Publishing blocked: {secretBlockers.length} hardcoded
                    secret(s) found
                  </span>
                </div>
                <ul className="space-y-1 pl-5 text-foreground/90">
                  {secretBlockers.map((finding) => (
                    <li key={finding.id} className="list-disc">
                      <span className="font-medium">{finding.ruleLabel}</span> in{" "}
                      {finding.location}:{" "}
                      <code className="rounded bg-background px-1 font-mono text-[11px]">
                        {finding.redactedMatch}
                      </code>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  onClick={() => handleDialogOpenChange(false)}
                  className="h-7 text-[11px]"
                >
                  <Link href={`/app/operations/${operationId}/edit`}>
                    Edit blueprint to replace with Secret variables
                  </Link>
                </Button>
              </div>
            ) : null}

            {/* Secret Scanner Soft Warning Acknowledgement */}
            {secretWarnings.length > 0 && pendingTargetVisibility ? (
              <div
                role="alert"
                data-testid="share-secret-warnings"
                className="space-y-2 rounded-md border border-reminder/50 bg-reminder/10 p-3 text-xs"
              >
                <div className="flex items-center gap-1.5 font-semibold text-reminder">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>
                    Confirm {secretWarnings.length} scanner advisory warning(s)
                    before publishing
                  </span>
                </div>
                <ul className="space-y-1 pl-5 text-foreground/90">
                  {secretWarnings.map((w) => (
                    <li key={w.id} className="list-disc">
                      {w.ruleLabel} in {w.location} (
                      <code className="font-mono text-[11px]">
                        {w.redactedMatch}
                      </code>
                      )
                    </li>
                  ))}
                </ul>
                <label className="flex cursor-pointer items-center gap-2 pt-1 text-foreground">
                  <input
                    type="checkbox"
                    checked={ackWarningsChecked}
                    onChange={(e) => setAckWarningsChecked(e.target.checked)}
                    className="size-4 rounded border-border accent-primary"
                  />
                  <span>
                    I reviewed these warnings and confirm no sensitive data is
                    exposed.
                  </span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  disabled={!ackWarningsChecked || isPending}
                  onClick={() =>
                    applyVisibility(pendingTargetVisibility, {
                      acknowledgeWarnings: true,
                    })
                  }
                  className="h-8 text-xs"
                >
                  Confirm &amp; Publish as {pendingTargetVisibility}
                </Button>
              </div>
            ) : null}

            {/* Public URL Bar */}
            {visibility === "public" ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
                <Globe className="size-3.5 shrink-0 text-done" />
                <code className="flex-1 truncate font-mono text-[11px] text-foreground">
                  {publicUrl}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => copyText("public", publicUrl, "Public link")}
                  className="h-7 gap-1 px-2 text-[11px]"
                >
                  {copiedKey === "public" ? (
                    <Check className="size-3 text-done" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  Copy
                </Button>
              </div>
            ) : null}

            {/* Unlisted URL & Rotation Bar */}
            {visibility === "unlisted" ? (
              <div className="space-y-2 rounded-md border border-collab/35 bg-collab/5 p-2.5 text-xs">
                {unlistedShareUrl ? (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-foreground">
                      One-time secret link (raw token is never stored in plain
                      text):
                    </p>
                    <div className="flex items-center gap-1.5">
                      <code className="flex-1 truncate rounded border border-border bg-background px-2 py-1 font-mono text-[11px]">
                        {unlistedShareUrl}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          copyText(
                            "unlisted",
                            unlistedShareUrl,
                            "Unlisted link"
                          )
                        }
                        className="h-7 gap-1 px-2 text-[11px]"
                      >
                        {copiedKey === "unlisted" ? (
                          <Check className="size-3 text-done" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                        Copy
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    An active unlisted secret link exists. Rotate below if you
                    need to mint a fresh link and revoke previous URLs.
                  </p>
                )}

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={handleRotateUnlistedLink}
                  className="h-7 gap-1.5 text-[11px]"
                >
                  <RefreshCw className="size-3" />
                  Rotate Secret Link
                </Button>
              </div>
            ) : null}

            {/* Allow Forking Toggle */}
            <div className="flex items-center justify-between border-t border-border/70 pt-2.5">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-foreground">
                  Allow forking
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Let viewers or public readers clone a copy with attribution.
                </p>
              </div>
              <Switch
                checked={allowForking}
                disabled={isPending}
                onCheckedChange={handleToggleAllowForking}
                aria-label="Allow forking"
              />
            </div>
          </section>

          {/* 2. Private Collaboration 3-Tab Sharing */}
          <section className="space-y-3 rounded-lg border border-border bg-card p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-foreground">
                Private Collaboration
              </h3>
              <div
                role="tablist"
                aria-label="Private sharing methods"
                className="inline-flex rounded-md border border-border bg-muted/60 p-0.5"
              >
                {(
                  [
                    { id: "circle", label: "Followers & Circle", icon: Users },
                    { id: "project", label: "Project Team", icon: FolderKanban },
                    { id: "email", label: "Email", icon: Mail },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={shareTab === tab.id}
                      onClick={() => setShareTab(tab.id)}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
                        shareTab === tab.id
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="size-3" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Loading sharing settings…
              </div>
            ) : shareTab === "circle" ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    1-click invite from your follows, Accountability Circle, or
                    project teammates.
                  </p>
                  <Select
                    value={quickPickRole}
                    onValueChange={(v) =>
                      setQuickPickRole(v as OperationMemberRole)
                    }
                  >
                    <SelectTrigger
                      aria-label="Quick-pick invite role"
                      className="h-7 w-[124px] bg-background text-[11px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer" className="text-xs">
                        Viewer
                      </SelectItem>
                      <SelectItem value="collaborator" className="text-xs">
                        Collaborator
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {!dashboard || dashboard.quickPickContacts.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-center text-xs text-muted-foreground">
                    No additional contacts in your follows, Circle, or projects
                    yet. Use the Email tab to invite anyone directly.
                  </p>
                ) : (
                  <div className="max-h-44 space-y-1.5 overflow-y-auto">
                    {dashboard.quickPickContacts.map((contact) => (
                      <div
                        key={contact.userId}
                        className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-foreground">
                              {contact.name}
                            </span>
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] font-normal"
                            >
                              {contact.sourceLabel}
                            </Badge>
                          </div>
                          {contact.handle ? (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              @{contact.handle}
                            </span>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => handleQuickPickInvite(contact.userId)}
                          className="h-7 gap-1 px-2 text-[11px]"
                        >
                          <UserPlus className="size-3" />
                          Invite
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : shareTab === "project" ? (
              <div className="space-y-2.5">
                {dashboard?.linkedProject ? (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3">
                    <div className="space-y-0.5">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <FolderKanban className="size-3.5 text-collab" />
                        {dashboard.linkedProject.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Opt in to let Project Owners/Editors collaborate and
                        Project Viewers run this blueprint.
                      </p>
                    </div>
                    <Switch
                      checked={shareWithProject}
                      disabled={isPending}
                      onCheckedChange={handleToggleProjectSharing}
                      aria-label="Share with linked project team"
                    />
                  </div>
                ) : (
                  <div className="space-y-2 rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                    <p>
                      This operation is not linked to a Shared Project yet. Link
                      a project in the Blueprint Builder first, then opt into
                      team sharing here.
                    </p>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                    >
                      <Link href={`/app/operations/${operationId}/edit`}>
                        Link a Project
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Existing Folio users receive an immediate in-app invite;
                  external recipients receive a secure 7-day email link.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    aria-label="Invite email address"
                    className="h-9 flex-1 bg-background text-xs md:h-8"
                  />
                  <Select
                    value={inviteRole}
                    onValueChange={(v) =>
                      setInviteRole(v as OperationMemberRole)
                    }
                  >
                    <SelectTrigger
                      aria-label="Email invite role"
                      className="h-9 w-full bg-background text-xs sm:w-[130px] md:h-8"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer" className="text-xs">
                        Viewer
                      </SelectItem>
                      <SelectItem value="collaborator" className="text-xs">
                        Collaborator
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending || !inviteEmail.trim()}
                    onClick={handleEmailInvite}
                    className="h-9 gap-1.5 px-3 text-xs md:h-8"
                  >
                    {isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="size-3.5" />
                    )}
                    Invite
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* 3. Active Members & Pending Invitations */}
          {dashboard &&
          (dashboard.members.length > 0 ||
            dashboard.pendingInvitations.length > 0) ? (
            <section className="space-y-3 rounded-lg border border-border bg-card p-3.5">
              {dashboard.members.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Members with Direct Access ({dashboard.members.length})
                  </h3>
                  <div className="space-y-1.5">
                    {dashboard.members.map((member) => (
                      <div
                        key={member.userId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {member.name}
                          </p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {member.handle ? `@${member.handle}` : member.email}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Select
                            value={member.role}
                            disabled={isPending}
                            onValueChange={(val) =>
                              handleUpdateMemberRole(
                                member.userId,
                                val as OperationMemberRole
                              )
                            }
                          >
                            <SelectTrigger
                              aria-label={`Role for ${member.name}`}
                              className="h-7 w-[122px] text-[11px]"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="viewer" className="text-xs">
                                Viewer
                              </SelectItem>
                              <SelectItem
                                value="collaborator"
                                className="text-xs"
                              >
                                Collaborator
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={isPending}
                            onClick={() => handleRevokeMember(member.userId)}
                            aria-label={`Revoke ${member.name}`}
                            className="h-7 px-2 text-muted-foreground hover:text-overdue"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {dashboard.pendingInvitations.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Pending Invitations ({dashboard.pendingInvitations.length})
                  </h3>
                  <div className="space-y-1.5">
                    {dashboard.pendingInvitations.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[11px] text-foreground">
                            {inv.targetEmail}
                          </p>
                          <p className="text-[10px] capitalize text-muted-foreground">
                            {inv.role} · Pending
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => handleRevokeInvite(inv.id)}
                          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-overdue"
                        >
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
