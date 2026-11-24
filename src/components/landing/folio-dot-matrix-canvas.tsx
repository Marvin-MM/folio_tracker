"use client";

import { useEffect, useRef } from "react";
import {
  clamp,
  createFormationBank,
  HERO_FORMATIONS,
  projectDotMatrixFrame,
  type DotAccentTone,
  type FormationBank,
  type HeroFormationId,
} from "@/components/landing/dot-matrix-3d-engine";

interface FolioDotMatrixCanvasProps {
  /** Currently active pillar/formation requested by user interaction (or auto-cycle when unlocked) */
  activeFormation: HeroFormationId;
  /** When true, holds the user-selected formation instead of auto-cycling */
  isUserPinned: boolean;
  /** Notifies parent when the auto-cycle advances so UI indicators stay in sync */
  onAutoAdvance?: (formation: HeroFormationId) => void;
}

interface ResolvedPalette {
  ink: string;
  done: string;
  reminder: string;
  collab: string;
}

function readMiraPalette(): ResolvedPalette {
  const styles = getComputedStyle(document.documentElement);
  return {
    ink: styles.getPropertyValue("--foreground").trim() || "#171614",
    done: styles.getPropertyValue("--accent-done").trim() || "#2E7D5B",
    reminder: styles.getPropertyValue("--accent-reminder").trim() || "#B4690E",
    collab: styles.getPropertyValue("--accent-collab").trim() || "#3B5B8A",
  };
}

const AUTO_CYCLE_SECONDS = 7.5;
const MORPH_DURATION_SECONDS = 1.5;

/**
 * High-performance HTML5 `<canvas>` renderer for Folio's 3D Dot-Matrix Hero.
 *
 * Performance & Accessibility Invariants:
 * - Zero external dependencies or media downloads (100% CSP safe, ~4KB total)
 * - Caps backing resolution to `devicePixelRatio <= 2`
 * - Auto-pauses `requestAnimationFrame` when offscreen (`IntersectionObserver`)
 *   or when the browser tab is hidden (`visibilitychange`)
 * - Respects `prefers-reduced-motion: reduce` by drawing a single static frame
 * - Dynamically syncs Warm Paper (Light) and Carbon Ink (Dark) CSS tokens
 */
export function FolioDotMatrixCanvas({
  activeFormation,
  isUserPinned,
  onAutoAdvance,
}: FolioDotMatrixCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const desiredFormationRef = useRef<HeroFormationId>(activeFormation);
  const isPinnedRef = useRef<boolean>(isUserPinned);
  const onAutoAdvanceRef = useRef(onAutoAdvance);

  useEffect(() => {
    desiredFormationRef.current = activeFormation;
  }, [activeFormation]);

  useEffect(() => {
    isPinnedRef.current = isUserPinned;
  }, [isUserPinned]);

  useEffect(() => {
    onAutoAdvanceRef.current = onAutoAdvance;
  }, [onAutoAdvance]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );
    let prefersReducedMotion = reducedMotionQuery.matches;

    let palette: ResolvedPalette = readMiraPalette();
    let width = container.clientWidth || window.innerWidth;
    let height = container.clientHeight || window.innerHeight;
    let isPortrait = height > width;
    let dpr = Math.min(2, window.devicePixelRatio || 1);

    let bank: FormationBank = createFormationBank(width < 768 ? 400 : 900);

    let currentFormation: HeroFormationId = desiredFormationRef.current;
    let targetFormation: HeroFormationId = desiredFormationRef.current;
    let morphProgress = 1;
    let lastAutoSwitchSec = 0;

    // Smooth damped pointer parallax
    let targetPointerX = 0;
    let targetPointerY = 0;
    let smoothPointerX = 0;
    let smoothPointerY = 0;

    let isVisible = true;
    let isTabVisible = document.visibilityState === "visible";
    let rafId: number | null = null;
    let lastFrameMs = performance.now();
    const startMs = lastFrameMs;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(320, Math.round(rect.width) || window.innerWidth);
      height = Math.max(480, Math.round(rect.height) || window.innerHeight);
      isPortrait = height > width;
      dpr = Math.min(2, window.devicePixelRatio || 1);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      const desiredCount = width < 768 ? 400 : 900;
      if (bank.pointCount !== desiredCount) {
        bank = createFormationBank(desiredCount);
      }
    };

    const drawFrame = (nowMs: number) => {
      const dt = Math.min(0.08, Math.max(0.001, (nowMs - lastFrameMs) / 1000));
      lastFrameMs = nowMs;
      const elapsedSec = (nowMs - startMs) / 1000;

      // Sync target formation when user hovers/clicks a bottom pillar
      if (desiredFormationRef.current !== targetFormation) {
        currentFormation =
          morphProgress >= 0.5 ? targetFormation : currentFormation;
        targetFormation = desiredFormationRef.current;
        morphProgress = 0;
        lastAutoSwitchSec = elapsedSec;
      } else if (
        !prefersReducedMotion &&
        !isPinnedRef.current &&
        morphProgress >= 1 &&
        elapsedSec - lastAutoSwitchSec >= AUTO_CYCLE_SECONDS
      ) {
        const idx = HERO_FORMATIONS.indexOf(targetFormation);
        const nextFormation =
          HERO_FORMATIONS[(idx + 1) % HERO_FORMATIONS.length]!;
        currentFormation = targetFormation;
        targetFormation = nextFormation;
        desiredFormationRef.current = nextFormation;
        morphProgress = 0;
        lastAutoSwitchSec = elapsedSec;
        onAutoAdvanceRef.current?.(nextFormation);
      }

      if (morphProgress < 1) {
        morphProgress = prefersReducedMotion
          ? 1
          : clamp(morphProgress + dt / MORPH_DURATION_SECONDS, 0, 1);
        if (morphProgress >= 1) {
          currentFormation = targetFormation;
        }
      }

      // Gently damp pointer tilt
      const damp = prefersReducedMotion ? 1 : 1 - Math.exp(-dt * 4.5);
      smoothPointerX += (targetPointerX - smoothPointerX) * damp;
      smoothPointerY += (targetPointerY - smoothPointerY) * damp;

      const dots = projectDotMatrixFrame(bank, {
        timeSec: elapsedSec,
        fromFormation: currentFormation,
        toFormation: targetFormation,
        morphProgress,
        pointerX: prefersReducedMotion ? 0 : smoothPointerX,
        pointerY: prefersReducedMotion ? 0 : smoothPointerY,
        viewport: { width, height, isPortrait },
        reducedMotion: prefersReducedMotion,
      });

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const toneColor = (tone: DotAccentTone): string => {
        if (tone === "done") return palette.done;
        if (tone === "reminder") return palette.reminder;
        if (tone === "collab") return palette.collab;
        return palette.ink;
      };

      let lastColor = "";
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i]!;
        const color = toneColor(dot.tone);
        if (color !== lastColor) {
          ctx.fillStyle = color;
          lastColor = color;
        }
        ctx.globalAlpha = dot.alpha;
        ctx.beginPath();
        ctx.arc(dot.screenX, dot.screenY, dot.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const tick = (nowMs: number) => {
      rafId = null;
      if (!isVisible || !isTabVisible) return;
      drawFrame(nowMs);
      if (!prefersReducedMotion) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const startLoop = () => {
      if (rafId !== null || !isVisible || !isTabVisible) return;
      lastFrameMs = performance.now();
      if (prefersReducedMotion) {
        drawFrame(lastFrameMs);
      } else {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const stopLoop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    resize();
    startLoop();

    const handleResizeAndRedraw = () => {
      resize();
      if (isVisible && isTabVisible) {
        drawFrame(performance.now());
      }
    };

    const resizeObserver = new ResizeObserver(handleResizeAndRedraw);
    resizeObserver.observe(container);
    window.addEventListener("resize", handleResizeAndRedraw, { passive: true });

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        isVisible = Boolean(entry?.isIntersecting);
        if (isVisible) {
          startLoop();
        } else {
          stopLoop();
        }
      },
      { threshold: 0.02 }
    );
    intersectionObserver.observe(container);

    // Sync Light/Dark theme token changes instantly when `html.dark` toggles
    const themeObserver = new MutationObserver(() => {
      palette = readMiraPalette();
      if (prefersReducedMotion || !rafId) {
        drawFrame(performance.now());
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const handleVisibility = () => {
      isTabVisible = document.visibilityState === "visible";
      if (isTabVisible && isVisible) {
        startLoop();
      } else {
        stopLoop();
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || prefersReducedMotion) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      targetPointerX = clamp(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -1,
        1
      );
      targetPointerY = clamp(
        ((event.clientY - rect.top) / rect.height) * 2 - 1,
        -1,
        1
      );
    };

    const handlePointerLeave = () => {
      targetPointerX = 0;
      targetPointerY = 0;
    };

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
      stopLoop();
      startLoop();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave);
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);

    return () => {
      stopLoop();
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResizeAndRedraw);
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      reducedMotionQuery.removeEventListener(
        "change",
        handleReducedMotionChange
      );
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      data-formation={activeFormation}
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
