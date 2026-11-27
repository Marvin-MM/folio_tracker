"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Clock,
  GitFork,
  Loader2,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { toggleFollowCreatorAction } from "@/actions/operations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getOperationDomainPreset,
  type PublicCreatorProfileDto,
} from "@/server/domain/operations";

interface CreatorProfileViewProps {
  profile: PublicCreatorProfileDto;
  viewerUserId: string | null;
  initialIsFollowing: boolean;
}

export function CreatorProfileView({
  profile,
  viewerUserId,
  initialIsFollowing,
}: CreatorProfileViewProps) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [followerCount, setFollowerCount] = useState(profile.followerCount);
  const [isPending, startTransition] = useTransition();

  const isOwnProfile = viewerUserId === profile.creator.id;
  const initials = profile.creator.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  const handleToggleFollow = () => {
    const nextFollow = !isFollowing;
    startTransition(async () => {
      const result = await toggleFollowCreatorAction({
        targetUserId: profile.creator.id,
        follow: nextFollow,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setIsFollowing(result.data.following);
      setFollowerCount(result.data.followerCount);
      toast.success(
        result.data.following
          ? `Following @${profile.creator.handle}.`
          : `Unfollowed @${profile.creator.handle}.`
      );
    });
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-6">
      <Link
        href="/explore"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to Explore
      </Link>

      {/* Creator Header Card */}
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3.5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted font-mono text-sm font-semibold text-foreground">
            {initials || "F"}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                {profile.creator.name}
              </h1>
              <span className="font-mono text-xs text-muted-foreground">
                @{profile.creator.handle}
              </span>
            </div>

            {profile.creator.bio ? (
              <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                {profile.creator.bio}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-muted-foreground">
              <span className="mono-tabular">
                <strong className="font-semibold text-foreground">
                  {followerCount}
                </strong>{" "}
                {followerCount === 1 ? "follower" : "followers"}
              </span>
              <span className="mono-tabular">
                <strong className="font-semibold text-foreground">
                  {profile.followingCount}
                </strong>{" "}
                following
              </span>
              <span className="mono-tabular">
                <strong className="font-semibold text-foreground">
                  {profile.publicOperationsCount}
                </strong>{" "}
                public {profile.publicOperationsCount === 1 ? "blueprint" : "blueprints"}
              </span>
            </div>
          </div>
        </div>

        <div className="shrink-0">
          {isOwnProfile ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 text-xs md:h-8"
            >
              <Link href="/app/settings">Edit profile</Link>
            </Button>
          ) : viewerUserId ? (
            <Button
              type="button"
              variant={isFollowing ? "outline" : "default"}
              size="sm"
              disabled={isPending}
              onClick={handleToggleFollow}
              className="h-9 gap-1.5 px-3 text-xs md:h-8"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isFollowing ? (
                <UserCheck className="size-3.5 text-done" />
              ) : (
                <UserPlus className="size-3.5" />
              )}
              {isFollowing ? "Following" : "Follow"}
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline" className="h-9 text-xs md:h-8">
              <Link
                href={`/login?callbackURL=${encodeURIComponent(`/u/${profile.creator.handle}`)}`}
              >
                <UserPlus className="mr-1.5 size-3.5" />
                Sign in to follow
              </Link>
            </Button>
          )}
        </div>
      </section>

      {/* Public Blueprints */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Public Operation Blueprints ({profile.operations.length})
        </h2>

        {profile.operations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/50 px-5 py-10 text-center text-xs text-muted-foreground">
            @{profile.creator.handle} hasn&apos;t published any public blueprints yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {profile.operations.map((op) => {
              const preset = getOperationDomainPreset(op.domain);
              return (
                <article
                  key={op.id}
                  className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/25"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-5 px-1.5 text-[10px]",
                            preset.badgeClassName
                          )}
                        >
                          {preset.shortLabel}
                        </Badge>
                        <span className="mono-tabular rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          v{op.currentVersion}
                        </span>
                        {op.lastVerifiedAt && !op.staleness.isStale ? (
                          <span className="inline-flex items-center gap-1 rounded border border-done/35 bg-done/10 px-1.5 py-0.5 text-[10px] text-done">
                            <ShieldCheck className="size-2.5" />
                            Verified
                          </span>
                        ) : null}
                      </div>

                      {op.forkCount > 0 ? (
                        <span className="mono-tabular inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <GitFork className="size-3" />
                          {op.forkCount}
                        </span>
                      ) : null}
                    </div>

                    <div>
                      <Link
                        href={`/ops/${op.slug}`}
                        className="text-sm font-semibold tracking-tight text-foreground hover:text-reminder"
                      >
                        {op.title}
                      </Link>
                      {op.summary ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {op.summary}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="mono-tabular">
                        {op.stepCount} {op.stepCount === 1 ? "step" : "steps"}
                      </span>
                      {op.estimatedMinutes ? (
                        <span className="mono-tabular inline-flex items-center gap-1">
                          <Clock className="size-3" />
                          {op.estimatedMinutes}m
                        </span>
                      ) : null}
                      {op.difficulty ? (
                        <span className="capitalize">{op.difficulty}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex justify-end border-t border-border/70 pt-2.5">
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1 px-2.5 text-xs md:h-7"
                    >
                      <Link href={`/ops/${op.slug}`}>
                        Run blueprint
                        <ArrowUpRight className="size-3" />
                      </Link>
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
