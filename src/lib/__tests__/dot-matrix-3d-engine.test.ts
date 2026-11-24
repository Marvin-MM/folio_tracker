import { describe, expect, it } from "vitest";
import {
  computeCopyQuietZoneFactor,
  createFormationBank,
  HERO_FORMATIONS,
  projectDotMatrixFrame,
} from "@/components/landing/dot-matrix-3d-engine";

describe("Folio 3D Dot-Matrix Hero Engine", () => {
  it("generates deterministic, equal-length 3D point clouds for all 3 Folio formations", () => {
    const bank = createFormationBank(540);
    expect(bank.pointCount).toBe(540);
    expect(bank.dissolveSeeds.length).toBe(540);

    for (const formation of HERO_FORMATIONS) {
      const pts = bank.formations[formation];
      expect(pts.length).toBe(540);
      for (const p of pts) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.z)).toBe(true);
        expect(p.weight).toBeGreaterThan(0);
        expect(p.weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it("enforces a strict copy quiet zone behind the hero headline and trust badges while keeping peripheral flanks active", () => {
    // Center of hero headline, subline, CTA, and trust micro-badges should be completely attenuated (0)
    expect(computeCopyQuietZoneFactor(0.5, 0.28, false)).toBe(0);
    expect(computeCopyQuietZoneFactor(0.5, 0.41, false)).toBe(0);
    expect(computeCopyQuietZoneFactor(0.5, 0.62, false)).toBe(0);
    expect(computeCopyQuietZoneFactor(0.5, 0.34, true)).toBe(0);

    // Peripheral left and right flanks should be at full visual strength (1)
    expect(computeCopyQuietZoneFactor(0.08, 0.42, false)).toBe(1);
    expect(computeCopyQuietZoneFactor(0.92, 0.42, false)).toBe(1);
  });

  it("projects depth-sorted quantized dots cleanly across formations, morph states, and reducedMotion mode", () => {
    const bank = createFormationBank(420);
    const desktopViewport = { width: 1280, height: 800, isPortrait: false };

    for (const formation of HERO_FORMATIONS) {
      const dots = projectDotMatrixFrame(bank, {
        timeSec: 3.2,
        fromFormation: formation,
        toFormation: formation,
        morphProgress: 1,
        pointerX: 0.25,
        pointerY: -0.15,
        viewport: desktopViewport,
      });

      expect(dots.length).toBeGreaterThan(80);

      // Verify painter's depth sort (farthest depth first -> descending depth)
      for (let i = 1; i < dots.length; i++) {
        expect(dots[i - 1]!.depth).toBeGreaterThanOrEqual(dots[i]!.depth);
      }

      // Verify every dot respects quiet zone (no high-alpha dots directly on headline center)
      for (const dot of dots) {
        const dx = Math.abs(dot.screenX / desktopViewport.width - 0.5);
        const dy = Math.abs(dot.screenY / desktopViewport.height - 0.38);
        if (dx < 0.14 && dy < 0.1) {
          throw new Error(
            `Unexpected dot rendered inside headline quiet zone at (${dot.screenX}, ${dot.screenY})`
          );
        }
        expect(dot.level).toBeGreaterThanOrEqual(1);
        expect(dot.level).toBeLessThanOrEqual(4);
      }
    }

    // Mid-morph transition between capture -> habits produces valid finite points
    const midMorph = projectDotMatrixFrame(bank, {
      timeSec: 5.5,
      fromFormation: "capture",
      toFormation: "habits",
      morphProgress: 0.5,
      pointerX: 0,
      pointerY: 0,
      viewport: desktopViewport,
    });
    expect(midMorph.length).toBeGreaterThan(60);

    // Reduced motion renders a deterministic static frame regardless of timeSec
    const reducedA = projectDotMatrixFrame(bank, {
      timeSec: 1.0,
      fromFormation: "circle",
      toFormation: "circle",
      morphProgress: 1,
      pointerX: 0.5,
      pointerY: 0.5,
      viewport: desktopViewport,
      reducedMotion: true,
    });
    const reducedB = projectDotMatrixFrame(bank, {
      timeSec: 99.0,
      fromFormation: "circle",
      toFormation: "circle",
      morphProgress: 1,
      pointerX: 0.5,
      pointerY: 0.5,
      viewport: desktopViewport,
      reducedMotion: true,
    });
    expect(reducedA).toEqual(reducedB);
  });
});
