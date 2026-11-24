"use client";

import { useState, useTransition } from "react";
import { EyeOff, Layers3, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createHabitSavedViewAction,
  deleteHabitSavedViewAction,
  listHabitSavedViewsAction,
  updateHabitSavedViewAction,
} from "@/actions/habits";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ENERGY_NEEDS,
  PLACES,
  type EnergyNeed,
  type Place,
} from "@/server/domain/habit-metadata";
import type { HabitSavedView } from "@/server/domain/habit-views";

interface SavedViewsControlProps {
  views: HabitSavedView[];
  activeViewId: string;
  onSelect: (viewId: string) => void;
  onViewsChanged: (views: HabitSavedView[]) => void;
}

export function SavedViewsControl({
  views,
  activeViewId,
  onSelect,
  onViewsChanged,
}: SavedViewsControlProps) {
  const invalidate = useInvalidateWorkspace();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [energyNeed, setEnergyNeed] = useState<EnergyNeed | "any">("any");
  const [place, setPlace] = useState<Place | "any">("any");
  const [tags, setTags] = useState("");
  const [coreOnly, setCoreOnly] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const visibleViews = views.filter((view) => !view.hidden);
  const activeView = views.find((view) => view.id === activeViewId);

  const refreshViews = async () => {
    const result = await listHabitSavedViewsAction();
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    onViewsChanged(result.data);
    await invalidate(["habits", "today"]);
  };

  const handleToggleHidden = (view: HabitSavedView) => {
    startTransition(async () => {
      const result = await updateHabitSavedViewAction({
        viewId: view.id,
        hidden: !view.hidden,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (view.id === activeViewId && !view.hidden) {
        const nextVisible = views.find(
          (candidate) => candidate.id !== view.id && !candidate.hidden
        );
        if (nextVisible) onSelect(nextVisible.id);
      }
      await refreshViews();
      toast.success(view.hidden ? "View restored." : "View hidden.");
    });
  };

  const handleDelete = (view: HabitSavedView) => {
    startTransition(async () => {
      const result = await deleteHabitSavedViewAction({ viewId: view.id });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      if (view.id === activeViewId) {
        const nextVisible = views.find(
          (candidate) => candidate.id !== view.id && !candidate.hidden
        );
        if (nextVisible) onSelect(nextVisible.id);
      }
      await refreshViews();
      toast.success("View deleted.");
    });
  };

  const handleCreate = () => {
    const trimmedName = name.trim();
    if (!trimmedName || isPending) return;
    startTransition(async () => {
      const result = await createHabitSavedViewAction({
        name: trimmedName,
        filter: {
          ...(category.trim() ? { categories: [category.trim()] } : {}),
          ...(energyNeed !== "any" ? { energyNeeds: [energyNeed] } : {}),
          ...(place !== "any" ? { places: [place] } : {}),
          ...(tags.trim()
            ? { tags: tags.split(",").map((tag) => tag.trim()) }
            : {}),
          ...(coreOnly ? { isCore: true } : {}),
        },
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      setName("");
      setCategory("");
      setEnergyNeed("any");
      setPlace("any");
      setTags("");
      setCoreOnly(false);
      onSelect(result.data.id);
      await refreshViews();
      toast.success(`View "${result.data.name}" saved.`);
    });
  };

  if (views.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={activeView?.id ?? visibleViews[0]?.id} onValueChange={onSelect}>
        <SelectTrigger
          aria-label="Saved habit view"
          className="mira-row h-7 gap-1.5 border-border bg-background px-2 text-xs"
        >
          <Layers3 className="size-3.5 text-muted-foreground" />
          <SelectValue placeholder="Saved view" />
        </SelectTrigger>
        <SelectContent>
          {visibleViews.map((view) => (
            <SelectItem key={view.id} value={view.id} className="text-xs">
              {view.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={manageOpen} onOpenChange={setManageOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mira-row h-7 gap-1 px-2 text-xs"
          >
            Manage views
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 space-y-3 border-border bg-popover p-3"
        >
          <div className="space-y-1.5">
            {views.map((view) => (
              <div
                key={view.id}
                className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5"
              >
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs",
                    view.hidden && "text-muted-foreground line-through"
                  )}
                >
                  {view.name}
                  {view.builtIn ? " · built-in" : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isPending}
                  onClick={() => handleToggleHidden(view)}
                  className="h-6 px-1.5 text-[11px]"
                  title={view.hidden ? "Show view" : "Hide view"}
                >
                  {view.hidden ? "Show" : <EyeOff className="size-3" />}
                </Button>
                {!view.builtIn ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={isPending}
                    onClick={() => handleDelete(view)}
                    className="h-6 px-1.5 text-[11px] text-overdue"
                    title="Delete view"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="space-y-2 border-t border-border pt-2.5">
            <p className="text-[11px] font-medium text-foreground">New view</p>
            <div className="space-y-1">
              <Label htmlFor="saved-view-name" className="text-[11px]">
                Name
              </Label>
              <Input
                id="saved-view-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={48}
                placeholder="Quiet morning"
                className="mira-row bg-background text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="saved-view-energy" className="text-[11px]">
                  Energy
                </Label>
                <Select
                  value={energyNeed}
                  onValueChange={(value) =>
                    setEnergyNeed(value as EnergyNeed | "any")
                  }
                >
                  <SelectTrigger id="saved-view-energy" className="mira-row bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    {ENERGY_NEEDS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="saved-view-place" className="text-[11px]">
                  Place
                </Label>
                <Select
                  value={place}
                  onValueChange={(value) => setPlace(value as Place | "any")}
                >
                  <SelectTrigger id="saved-view-place" className="mira-row bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    {PLACES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="saved-view-category" className="text-[11px]">
                Category / tags (comma separated)
              </Label>
              <Input
                id="saved-view-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                maxLength={48}
                placeholder="Health"
                className="mira-row bg-background text-xs"
              />
              <Input
                aria-label="Saved view tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="core, morning"
                className="mira-row bg-background text-xs"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setCoreOnly((value) => !value)}
              className={cn(
                "h-6 px-2 text-[11px]",
                coreOnly && "bg-primary/10 text-primary"
              )}
            >
              Core anchors only
            </Button>
            <Button
              type="button"
              size="xs"
              disabled={!name.trim() || isPending}
              onClick={handleCreate}
              className="mira-row h-7 w-full text-xs"
            >
              <Plus className="mr-1 size-3" />
              Save view
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
