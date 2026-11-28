"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Clock,
  Compass,
  GitFork,
  Search,
  ShieldCheck,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OPERATION_DOMAINS, type OperationDomain } from "@/server/db/schema";
import {
  getOperationDomainPreset,
  type PublicOperationCardDto,
} from "@/server/domain/operations";
import type { ExploreSortOption } from "@/server/dal/operations-social";

interface ExploreDirectoryViewProps {
  operations: PublicOperationCardDto[];
  embedded?: boolean;
  initialDomain?: OperationDomain | "all";
  initialQuery?: string;
}

export function ExploreDirectoryView({
  operations,
  embedded = false,
  initialDomain = "all",
  initialQuery = "",
}: ExploreDirectoryViewProps) {
  const [selectedDomain, setSelectedDomain] = useState<OperationDomain | "all">(
    initialDomain
  );
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [sortBy, setSortBy] = useState<ExploreSortOption>("recent");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = operations.filter((op) => {
      if (selectedDomain !== "all" && op.domain !== selectedDomain) {
        return false;
      }
      if (!q) return true;
      return (
        op.title.toLowerCase().includes(q) ||
        op.summary.toLowerCase().includes(q) ||
        op.tags.some((t) => t.toLowerCase().includes(q)) ||
        op.creator.name.toLowerCase().includes(q) ||
        (op.creator.handle ? op.creator.handle.toLowerCase().includes(q) : false)
      );
    });

    const sorted = [...matches];
    if (sortBy === "most_forked") {
      sorted.sort((a, b) => b.forkCount - a.forkCount || b.updatedAt - a.updatedAt);
    } else if (sortBy === "recently_verified") {
      sorted.sort(
        (a, b) =>
          (b.lastVerifiedAt ?? 0) - (a.lastVerifiedAt ?? 0) ||
          b.updatedAt - a.updatedAt
      );
    } else {
      sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return sorted;
  }, [operations, selectedDomain, searchQuery, sortBy]);

  return (
    <div
      className={cn(
        "space-y-4",
        !embedded && "mx-auto w-full max-w-5xl px-4 py-6 md:px-6"
      )}
    >
      {!embedded ? (
        <div className="space-y-1.5 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Compass className="size-4 text-reminder" />
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Explore Public Operations
            </h1>
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Browse verified recipes, fitness drills, DIY guides, business SOPs,
            and engineering runbooks shared by the community. Run any blueprint
            directly in your browser or fork it into your workspace.
          </p>
        </div>
      ) : null}

      {/* Search, Sort & Domain Filter Bar */}
      <div className="space-y-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="explore-search"
              name="q"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search blueprints by title, #tag, or @creator…"
              aria-label="Search public operations"
              className="h-9 bg-card pl-8 text-xs md:h-8"
            />
          </div>

          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as ExploreSortOption)}
          >
            <SelectTrigger
              aria-label="Sort public operations"
              className="h-9 w-full bg-card text-xs sm:w-[180px] md:h-8"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent" className="text-xs">
                Recently updated
              </SelectItem>
              <SelectItem value="most_forked" className="text-xs">
                Most forked
              </SelectItem>
              <SelectItem value="recently_verified" className="text-xs">
                Recently verified
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedDomain("all")}
            className={cn(
              "h-8 rounded-md border px-2.5 text-xs transition-colors md:h-7",
              selectedDomain === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            All domains
          </button>
          {OPERATION_DOMAINS.map((domain) => {
            const preset = getOperationDomainPreset(domain);
            const selected = selectedDomain === domain;
            return (
              <button
                key={domain}
                type="button"
                onClick={() => setSelectedDomain(domain)}
                className={cn(
                  "h-8 rounded-md border px-2.5 text-xs transition-colors md:h-7",
                  selected
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {preset.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 px-5 py-10 text-center">
          <Compass className="mx-auto size-7 text-muted-foreground/70" />
          <h2 className="mt-3 text-sm font-medium text-foreground">
            {operations.length === 0
              ? "No public operations published yet"
              : "No matching public operations"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            {operations.length === 0
              ? "Publish any blueprint as Public from your Operations Hub to share it with the community."
              : "Try broadening your search terms or switching domain filters."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((op) => {
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
                          "h-5 px-1.5 text-[10px] font-medium",
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
                          Verified{" "}
                          {op.staleness.daysSinceVerified === 0
                            ? "today"
                            : `${op.staleness.daysSinceVerified}d ago`}
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
                      className="text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-reminder"
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

                  {op.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {op.tags.slice(0, 6).map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
                  {op.creator.handle ? (
                    <Link
                      href={`/u/${op.creator.handle}`}
                      className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <User className="size-3 shrink-0" />
                      <span className="truncate font-medium text-foreground">
                        {op.creator.name}
                      </span>
                      <span className="truncate font-mono text-[11px]">
                        @{op.creator.handle}
                      </span>
                    </Link>
                  ) : (
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="size-3 shrink-0" />
                      <span className="truncate">{op.creator.name}</span>
                    </span>
                  )}

                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-9 shrink-0 gap-1 px-2.5 text-xs md:h-7"
                  >
                    <Link href={`/ops/${op.slug}`}>
                      Open
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
