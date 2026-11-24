/**
 * Pure TypeScript 3D Dot-Matrix Sculpture Engine for Folio's Editorial Hero.
 *
 * Synthesizes a Kindred-inspired monochrome LED halftone aesthetic with real
 * 3D perspective geometry depicting Folio's three core workspace pillars:
 *   0 — "capture": Stacked 3D ledger sheets (Tasks, Quiet Notes & Timed Reminders)
 *   1 — "habits":  Curved 3D real-calendar monthly habit matrix wall
 *   2 — "circle":  Concentric 3D accountability orbit with scoped private core
 *
 * Zero external dependencies, zero DOM reads, 100% deterministic & unit-testable.
 */

export type HeroFormationId = "capture" | "habits" | "circle";

export type DotAccentTone = "ink" | "done" | "reminder" | "collab";

export interface Point3D {
  x: number;
  y: number;
  z: number;
  /** Semantic signal tone (95%+ remain monochrome Carbon Ink; subtle accents mark key nodes) */
  tone: DotAccentTone;
  /** Intrinsic visual prominence weight [0.45..1.0] */
  weight: number;
  /** Logical scanline row index used for Kindred-style row-streaked morph dissolve & glitch beats */
  rowIndex: number;
}

export interface ProjectedDot {
  screenX: number;
  screenY: number;
  depth: number;
  radius: number;
  alpha: number;
  tone: DotAccentTone;
  /** Quantized halftone level index 1..4 */
  level: number;
}

export interface ProjectionViewport {
  width: number;
  height: number;
  isPortrait: boolean;
}

export interface RenderFrameParams {
  timeSec: number;
  fromFormation: HeroFormationId;
  toFormation: HeroFormationId;
  /** Morph progress [0..1] between fromFormation and toFormation */
  morphProgress: number;
  /** Normalized pointer offset [-1..1] for gentle 3D camera parallax */
  pointerX: number;
  pointerY: number;
  viewport: ProjectionViewport;
  reducedMotion?: boolean;
}

const FORMATION_ORDER: readonly HeroFormationId[] = [
  "capture",
  "habits",
  "circle",
] as const;

export const HERO_FORMATIONS = FORMATION_ORDER;

/** Quantized Kindred-style halftone levels */
const HALFTONE_LEVELS = [0, 0.28, 0.54, 0.78, 1.0] as const;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Deterministic pseudo-random hash in [0, 1) */
export function hash2D(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Generates deterministic 3D point cloud for Formation 01 ("capture"):
 * Three layered architectural Warm Paper sheets spanning wide across the left
 * and right 3D flanks (framing the centered editorial headline), complete with
 * ledger lines, checkbox markers, and timed reminder beacons.
 */
function generateCaptureFormation(count: number): Point3D[] {
  const points: Point3D[] = [];
  const sheets = [
    { xOffset: -2.05, yOffset: 0.02, zOffset: 0.18, tiltY: 0.44, tiltX: -0.09 },
    { xOffset: 2.05, yOffset: -0.02, zOffset: 0.18, tiltY: -0.44, tiltX: 0.09 },
    { xOffset: -1.48, yOffset: 0.18, zOffset: -0.62, tiltY: 0.34, tiltX: 0.06 },
    { xOffset: 1.48, yOffset: -0.18, zOffset: -0.62, tiltY: -0.34, tiltX: -0.06 },
  ];

  const perSheet = Math.floor(count / sheets.length);
  const cols = Math.max(9, Math.round(Math.sqrt(perSheet * 1.35)));
  const rows = Math.max(7, Math.ceil(perSheet / cols));

  let index = 0;
  for (let s = 0; s < sheets.length; s++) {
    const sheet = sheets[s]!;
    const cosY = Math.cos(sheet.tiltY);
    const sinY = Math.sin(sheet.tiltY);
    const cosX = Math.cos(sheet.tiltX);
    const sinX = Math.sin(sheet.tiltX);

    const isFront = s < 2;
    const sheetWidth = isFront ? 1.56 : 1.24;
    const sheetHeight = isFront ? 1.42 : 1.12;

    for (let r = 0; r < rows && index < count; r++) {
      const v = rows > 1 ? r / (rows - 1) - 0.5 : 0;
      for (let c = 0; c < cols && index < count; c++) {
        const u = cols > 1 ? c / (cols - 1) - 0.5 : 0;

        // Emphasize outer frame, left check column, and clean horizontal ledger lines
        const isBorder =
          r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
        const isCheckCol = c === 2 && r % 2 === 1 && r < rows - 1;
        const isLedgerLine = r % 2 === 1 && c >= 3 && c <= cols - 2;
        const isReminderNode = s === 1 && (r === 2 || r === 5) && c === cols - 3;

        const lx = u * sheetWidth;
        const ly = v * sheetHeight;
        // Subtle tactile sheet curl along Z
        const lz = Math.sin(u * Math.PI) * 0.075;

        // Rotate locally in X then Y
        const y1 = ly * cosX - lz * sinX;
        const z1 = ly * sinX + lz * cosX;
        const x2 = lx * cosY + z1 * sinY;
        const z2 = -lx * sinY + z1 * cosY;

        let tone: DotAccentTone = "ink";
        let weight = isFront ? 0.58 : 0.44;

        if (isReminderNode) {
          tone = "reminder";
          weight = 1.0;
        } else if (isCheckCol) {
          tone = r <= 4 ? "done" : "ink";
          weight = 0.96;
        } else if (isBorder) {
          weight = isFront ? 0.92 : 0.72;
        } else if (isLedgerLine) {
          weight = isFront ? 0.78 : 0.58;
        }

        points.push({
          x: x2 + sheet.xOffset,
          y: y1 + sheet.yOffset,
          z: z2 + sheet.zOffset,
          tone,
          weight,
          rowIndex: r + s * 4,
        });
        index++;
      }
    }
  }

  // Pad any rounding remainder cleanly along the outer frame
  while (points.length < count) {
    const i = points.length;
    const side = i % 2 === 0 ? -1 : 1;
    const t = ((i / Math.max(1, count)) - 0.5) * 1.4;
    points.push({
      x: side * 2.25,
      y: t,
      z: -0.25,
      tone: "ink",
      weight: 0.64,
      rowIndex: i % 16,
    });
  }

  return points;
}

/**
 * Generates deterministic 3D point cloud for Formation 02 ("habits"):
 * Two symmetric sweeping curved 3D architectural calendar walls (Days 1–15 on
 * the left flank, Days 16–31 on the right flank) representing Folio's full
 * 31-day monthly habit matrix with raised streak ridges along Z.
 */
function generateHabitsFormation(count: number): Point3D[] {
  const points: Point3D[] = [];
  const rows = 14;
  const colsPerWing = Math.max(12, Math.ceil(count / (rows * 2)));

  const radius = 2.95;
  let index = 0;

  for (let wing = 0; wing < 2; wing++) {
    const sign = wing === 0 ? -1 : 1;
    for (let r = 0; r < rows && index < count; r++) {
      const v = rows > 1 ? r / (rows - 1) - 0.5 : 0;
      for (let c = 0; c < colsPerWing && index < count; c++) {
        const u = colsPerWing > 1 ? c / (colsPerWing - 1) : 0.5;
        // Sweep symmetrically outward along each curved amphitheater wing
        const theta = sign * (0.46 + u * 0.72);
        const wave =
          Math.sin((u * 8.5 + wing * 1.4) + r * 0.58) * 0.5 +
          Math.cos(v * 6.8 - u * 3.8) * 0.5;
        const isCompletedCell = wave > 0.2;
        const isRestPass = !isCompletedCell && wave > 0.02 && (c + r) % 4 === 0;
        const zRelief = isCompletedCell ? 0.18 : isRestPass ? 0.05 : -0.06;

        const rEff = radius + zRelief;
        const x = Math.sin(theta) * rEff;
        const z = Math.cos(theta) * rEff - radius * 0.78;
        const y = v * 1.62;

        let tone: DotAccentTone = "ink";
        let weight = 0.58;

        if (isCompletedCell && (r === 3 || r === 9) && c % 3 === 0) {
          tone = "done";
          weight = 1.0;
        } else if (isCompletedCell) {
          weight = 0.94;
        } else if (isRestPass) {
          weight = 0.7;
        }

        points.push({
          x,
          y,
          z,
          tone,
          weight,
          rowIndex: r,
        });
        index++;
      }
    }
  }

  while (points.length < count) {
    const i = points.length;
    const sign = i % 2 === 0 ? -1 : 1;
    const v = ((i % rows) / Math.max(1, rows - 1)) - 0.5;
    points.push({
      x: sign * 2.4,
      y: v * 1.5,
      z: -0.2,
      tone: "done",
      weight: 0.78,
      rowIndex: i % rows,
    });
  }

  return points;
}

/**
 * Generates deterministic 3D point cloud for Formation 03 ("circle"):
 * Wide concentric 3D architectural orbital rings and scoped monitor nodes
 * sweeping across both flanks around a calm private inner core.
 */
function generateCircleFormation(count: number): Point3D[] {
  const points: Point3D[] = [];

  const innerCount = Math.floor(count * 0.14);
  const ring1Count = Math.floor(count * 0.28);
  const ring2Count = Math.floor(count * 0.29);
  const ring3Count = count - innerCount - ring1Count - ring2Count;

  // Inner private Fibonacci lattice sphere
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < innerCount; i++) {
    const t = innerCount > 1 ? i / (innerCount - 1) : 0.5;
    const yNorm = 1 - t * 2;
    const radAtY = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
    const theta = goldenAngle * i;
    const coreR = 0.82;

    points.push({
      x: Math.cos(theta) * radAtY * coreR,
      y: yNorm * coreR,
      z: Math.sin(theta) * radAtY * coreR,
      tone: i % 9 === 0 ? "done" : "ink",
      weight: 0.74,
      rowIndex: Math.floor(((yNorm + 1) * 0.5) * 14),
    });
  }

  // Three wide inclined 3D orbital rings framing both sides of the hero copy
  const rings = [
    {
      n: ring1Count,
      r: 1.88,
      tiltX: 0.52,
      tiltZ: 0.22,
      accent: "collab" as const,
      bandOffset: 0.07,
    },
    {
      n: ring2Count,
      r: 2.42,
      tiltX: -0.48,
      tiltZ: -0.28,
      accent: "done" as const,
      bandOffset: 0.08,
    },
    {
      n: ring3Count,
      r: 2.94,
      tiltX: 0.2,
      tiltZ: -0.5,
      accent: "reminder" as const,
      bandOffset: 0.07,
    },
  ];

  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri]!;
    const cosX = Math.cos(ring.tiltX);
    const sinX = Math.sin(ring.tiltX);
    const cosZ = Math.cos(ring.tiltZ);
    const sinZ = Math.sin(ring.tiltZ);

    for (let i = 0; i < ring.n; i++) {
      const a = (i / Math.max(1, ring.n)) * Math.PI * 2;
      // Double-strand ribbon thickness for rich halftone depth
      const strand = (i % 3) - 1;
      const rEff = ring.r + strand * ring.bandOffset;
      const lx = Math.cos(a) * rEff;
      const ly = strand * 0.04;
      const lz = Math.sin(a) * rEff;

      // Tilt X then Z
      const y1 = ly * cosX - lz * sinX;
      const z1 = ly * sinX + lz * cosX;
      const x2 = lx * cosZ - y1 * sinZ;
      const y2 = lx * sinZ + y1 * cosZ;

      const isMilestoneNode = i % 18 === 0;
      points.push({
        x: x2,
        y: y2,
        z: z1,
        tone: isMilestoneNode ? ring.accent : "ink",
        weight: isMilestoneNode ? 1.0 : 0.82,
        rowIndex: (Math.floor((a / (Math.PI * 2)) * 16) + ri * 3) % 16,
      });
    }
  }

  return points;
}

export interface FormationBank {
  pointCount: number;
  formations: Record<HeroFormationId, Point3D[]>;
  /** Deterministic Kindred-style per-point row-streaked dissolve seed [0..1] */
  dissolveSeeds: Float32Array;
}

export function createFormationBank(pointCount: number): FormationBank {
  const safeCount = clamp(Math.floor(pointCount), 180, 1200);
  const capture = generateCaptureFormation(safeCount);
  const habits = generateHabitsFormation(safeCount);
  const circle = generateCircleFormation(safeCount);

  const dissolveSeeds = new Float32Array(safeCount);
  for (let i = 0; i < safeCount; i++) {
    const row = capture[i]?.rowIndex ?? i % 16;
    dissolveSeeds[i] =
      0.55 * hash2D(i * 1.13, row * 2.17) + 0.45 * hash2D(row * 3.1, 7.7);
  }

  return {
    pointCount: safeCount,
    formations: { capture, habits, circle },
    dissolveSeeds,
  };
}

/**
 * Computes the elliptical copy quiet-zone attenuation factor [0..1].
 * Directly inspired by Kindred's copy quiet zone so moving 3D dots frame
 * the centered headline, subline, and CTA without degrading WCAG AA contrast.
 *
 * Returns `0` directly behind the hero copy block, smoothly rising to `1`
 * across the peripheral flanks.
 */
export function computeCopyQuietZoneFactor(
  normX: number,
  normY: number,
  isPortrait: boolean
): number {
  const centerX = 0.5;
  const centerY = isPortrait ? 0.34 : 0.41;
  const radiusX = isPortrait ? 0.45 : 0.31;
  const radiusY = isPortrait ? 0.22 : 0.31;

  const ex = (normX - centerX) / radiusX;
  const ey = (normY - centerY) / radiusY;
  const dist = Math.hypot(ex, ey);

  return smoothstep(0.84, 1.24, dist);
}

/**
 * Projects one frame of the 3D dot-matrix sculpture into depth-sorted 2D screen dots.
 */
export function projectDotMatrixFrame(
  bank: FormationBank,
  params: RenderFrameParams
): ProjectedDot[] {
  const {
    timeSec,
    fromFormation,
    toFormation,
    morphProgress,
    pointerX,
    pointerY,
    viewport,
    reducedMotion = false,
  } = params;

  const { width, height, isPortrait } = viewport;
  if (width <= 0 || height <= 0) return [];

  const fromPts = bank.formations[fromFormation];
  const toPts = bank.formations[toFormation];
  const seeds = bank.dissolveSeeds;
  const isMorphing =
    fromFormation !== toFormation && morphProgress > 0.001 && morphProgress < 0.999;

  // Slow organic 3D drift + gentle pointer parallax
  const t = reducedMotion ? 0 : timeSec;
  const loopAngle = (t / 24) * Math.PI * 2;
  const yaw =
    Math.sin(loopAngle) * 0.24 +
    Math.sin(loopAngle * 2 + 1.1) * 0.06 +
    clamp(pointerX, -1, 1) * 0.22;
  const pitch =
    Math.sin(loopAngle + 1.4) * 0.12 + clamp(pointerY, -1, 1) * -0.15;
  const roll = Math.sin(loopAngle + 2.3) * 0.04;
  const breathe = 1 + Math.sin(loopAngle + 0.8) * 0.045;

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosX = Math.cos(pitch);
  const sinX = Math.sin(pitch);
  const cosZ = Math.cos(roll);
  const sinZ = Math.sin(roll);

  const cameraZ = 5.1;
  const focalLength = Math.min(width, height) * (isPortrait ? 0.88 : 1.12);
  const centerX = width * 0.5;
  const centerY = height * (isPortrait ? 0.49 : 0.43);
  const baseRadius = clamp(width / 235, 2.2, 4.4);

  // Subtle Kindred-inspired horizontal LED scanline row-glitch beat (7 ticks/sec)
  const glitchTick = reducedMotion ? 0 : Math.floor(t * 7);

  const projected: ProjectedDot[] = [];

  for (let i = 0; i < bank.pointCount; i++) {
    const a = fromPts[i]!;
    const b = toPts[i]!;
    const seed = seeds[i] ?? 0.5;

    // Staggered row-streaked morph interpolation per dot
    let localMorph = morphProgress;
    let morphFrontSparkle = 1.0;

    if (fromFormation === toFormation) {
      localMorph = 0;
    } else {
      const windowHalf = 0.22;
      const center = seed * (1 - windowHalf * 2) + windowHalf;
      localMorph = smoothstep(
        center - windowHalf,
        center + windowHalf,
        morphProgress
      );

      if (isMorphing) {
        const distToFront = Math.abs(seed - morphProgress);
        if (distToFront < 0.11) {
          const edge = distToFront / 0.11;
          const flicker = hash2D(i + glitchTick, a.rowIndex) <= 0.35 ? 0.42 : 1;
          morphFrontSparkle = clamp(edge * 0.65 + 0.35, 0.25, 1) * flicker;
        }
      }
    }

    // Smooth curved 3D arc lift during morph so dots travel through depth cleanly
    const arcLift = Math.sin(localMorph * Math.PI) * 0.24 * (seed - 0.5);
    const px = (a.x + (b.x - a.x) * localMorph) * breathe;
    const py = (a.y + (b.y - a.y) * localMorph) * breathe;
    const pz = (a.z + (b.z - a.z) * localMorph + arcLift) * breathe;

    // 3D Rotation: Yaw (Y) -> Pitch (X) -> Roll (Z)
    const x1 = px * cosY + pz * sinY;
    const z1 = -px * sinY + pz * cosY;

    const y2 = py * cosX - z1 * sinX;
    const z2 = py * sinX + z1 * cosX;

    const x3 = x1 * cosZ - y2 * sinZ;
    const y3 = x1 * sinZ + y2 * cosZ;

    const depth = cameraZ - z2;
    if (depth <= 0.6) continue;

    const perspective = focalLength / depth;
    let screenX = centerX + x3 * perspective;
    const screenY = centerY + y3 * perspective;

    // Subtle occasional scanline row glitch shift (only ~3% of rows per beat)
    const rowIdx = localMorph > 0.5 ? b.rowIndex : a.rowIndex;
    if (!reducedMotion && hash2D(rowIdx, glitchTick) > 0.968) {
      const shiftPx = (hash2D(glitchTick, rowIdx) - 0.5) * 18;
      screenX += shiftPx;
    }

    if (
      screenX < -16 ||
      screenX > width + 16 ||
      screenY < -16 ||
      screenY > height + 16
    ) {
      continue;
    }

    // Bottom sheet quiet fade so canvas dissolves softly into the anchored bottom info panel
    const normX = screenX / width;
    const normY = screenY / height;
    const quietZone = computeCopyQuietZoneFactor(normX, normY, isPortrait);
    const bottomFade = 1 - smoothstep(0.76, 0.94, normY);

    // Depth cue + gentle Kindred shimmer
    const depthNorm = clamp((z2 + 2.1) / 4.2, 0.15, 1.0);
    const shimmer = reducedMotion
      ? 1
      : 0.88 + 0.12 * Math.sin(t * 2.8 + seed * 36);
    const baseWeight = a.weight + (b.weight - a.weight) * localMorph;

    const intensity =
      baseWeight *
      (0.42 + 0.58 * depthNorm) *
      shimmer *
      morphFrontSparkle *
      quietZone *
      bottomFade;

    if (intensity < 0.14) continue;

    // Quantize into crisp 4 non-zero LED halftone sizes
    let levelIndex = 0;
    for (let li = HALFTONE_LEVELS.length - 1; li >= 1; li--) {
      if (intensity >= HALFTONE_LEVELS[li]! - 0.14) {
        levelIndex = li;
        break;
      }
    }
    if (levelIndex === 0) continue;

    const qLevel = HALFTONE_LEVELS[levelIndex]!;
    const depthScale = clamp(perspective / (focalLength / cameraZ), 0.72, 1.38);
    const radius =
      baseRadius *
      depthScale *
      (levelIndex === 1 ? 0.42 : qLevel);

    const tone = localMorph >= 0.5 ? b.tone : a.tone;
    const alpha = clamp(0.18 + intensity * 0.62, 0.14, 0.78);

    projected.push({
      screenX,
      screenY,
      depth,
      radius,
      alpha,
      tone,
      level: levelIndex,
    });
  }

  // Painter's algorithm: farthest first so near depth dots cleanly sit in front
  projected.sort((lhs, rhs) => rhs.depth - lhs.depth);
  return projected;
}
