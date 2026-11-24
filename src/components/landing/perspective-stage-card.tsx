"use client";

import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PerspectiveStageCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Tactile 3D paper-sheet tilt stage for Folio's interactive workspace showcase.
 *
 * Uses strictly GPU-composited `transform` (no layout reflows, no blur/glow),
 * caps desktop tilt to a calm ±3° so text stays razor-sharp, and stays completely
 * flat on touch pointers and under `prefers-reduced-motion: reduce`.
 */
export function PerspectiveStageCard({
  children,
  className,
}: PerspectiveStageCardProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse") return;
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      const node = surfaceRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const normX = (event.clientX - rect.left) / rect.width - 0.5;
      const normY = (event.clientY - rect.top) / rect.height - 0.5;

      const rotateY = normX * 5.2;
      const rotateX = normY * -4.2;

      node.style.transform = `perspective(1400px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(0)`;
    },
    []
  );

  const handlePointerLeave = useCallback(() => {
    const node = surfaceRef.current;
    if (!node) return;
    node.style.transform =
      "perspective(1400px) rotateX(0deg) rotateY(0deg) translateZ(0)";
  }, []);

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={cn("relative", className)}
    >
      {/* Crisp layered Warm Paper / Carbon Ink architectural sheet stack (zero blur/glassmorphism) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 -bottom-2.5 h-4 rounded-b-lg border border-t-0 border-border bg-card/70"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 -bottom-5 h-3.5 rounded-b-lg border border-t-0 border-border/75 bg-background"
      />

      <div
        ref={surfaceRef}
        className="relative overflow-hidden rounded-lg border border-border bg-card transition-transform duration-300 ease-out will-change-transform"
        style={{
          transform:
            "perspective(1400px) rotateX(0deg) rotateY(0deg) translateZ(0)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
