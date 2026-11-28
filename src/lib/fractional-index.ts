/**
 * Lexicographical fractional index generator for O(1) task reordering without
 * renumbering sibling rows. Uses ASCII lowercase + digits (base-36 alphabet).
 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length;
const FIRST_CHAR = ALPHABET[0]!;
const LAST_CHAR = ALPHABET[BASE - 1]!;
const MID_CHAR = ALPHABET[Math.floor(BASE / 2)]!;

/**
 * Threshold beyond which sibling task positions are transactionally rebalanced
 * back to compact 2–3 character keys.
 */
export const MAX_POSITION_KEY_LENGTH = 32;

function charIndex(ch: string | undefined): number {
  if (!ch) return 0;
  const idx = ALPHABET.indexOf(ch);
  return idx === -1 ? 0 : idx;
}

export function generatePositionBetween(
  prev: string | null | undefined,
  next: string | null | undefined
): string {
  const a = prev ?? "";
  const b = next ?? "";

  if (!a && !b) {
    return "n";
  }

  // Append after `a`
  if (a && !b) {
    const lastIdx = charIndex(a[a.length - 1]);
    if (lastIdx < BASE - 2) {
      return `${a.slice(0, -1)}${ALPHABET[lastIdx + 1]}`;
    }
    return `${a}${MID_CHAR}`;
  }

  // Prepend before `b` — strictly `< b` even when `b` starts with leading `0`s
  if (!a && b) {
    let zeroPrefixLen = 0;
    while (zeroPrefixLen < b.length && b[zeroPrefixLen] === FIRST_CHAR) {
      zeroPrefixLen += 1;
    }

    if (zeroPrefixLen === b.length) {
      // Degenerate all-zero string (e.g. "0" or "00"): shrink if possible,
      // otherwise force a key > MAX_POSITION_KEY_LENGTH to trigger rebalancing.
      return b.length > 1
        ? b.slice(0, -1)
        : FIRST_CHAR.repeat(MAX_POSITION_KEY_LENGTH + 1);
    }

    const prefix = b.slice(0, zeroPrefixLen);
    const nextIdx = charIndex(b[zeroPrefixLen]);
    if (nextIdx > 1) {
      return `${prefix}${ALPHABET[Math.floor(nextIdx / 2)]!}`;
    }
    return `${prefix}${FIRST_CHAR}${MID_CHAR}`;
  }

  // Find midpoint strictly between `a` and `b`
  if (a >= b) {
    return `${a}${MID_CHAR}`;
  }

  let prefix = "";
  const maxLen = Math.max(a.length, b.length) + 1;

  for (let i = 0; i < maxLen; i++) {
    const aIdx = i < a.length ? charIndex(a[i]) : 0;
    const bIdx = i < b.length ? charIndex(b[i]) : BASE;

    if (bIdx - aIdx > 1) {
      const mid = Math.floor((aIdx + bIdx) / 2);
      return `${prefix}${ALPHABET[mid]}`;
    }

    if (bIdx - aIdx === 1) {
      prefix += ALPHABET[aIdx];
      // Need a character strictly greater than the rest of `a`
      const restOfA = a.slice(i + 1);
      if (!restOfA) {
        return `${prefix}${MID_CHAR}`;
      }
      for (let j = 0; j < restOfA.length; j++) {
        const rIdx = charIndex(restOfA[j]);
        if (rIdx < BASE - 1) {
          const mid = Math.floor((rIdx + BASE) / 2);
          return `${prefix}${restOfA.slice(0, j)}${ALPHABET[mid]}`;
        }
      }
      return `${prefix}${restOfA}${MID_CHAR}`;
    }

    prefix += ALPHABET[aIdx] ?? FIRST_CHAR;
  }

  return `${a}${LAST_CHAR}`;
}

/**
 * Generates `count` strictly ascending, compact base-36 keys (`"a00"`, `"a01"`, ...)
 * used by transactional task-position rebalancing when any key exceeds
 * `MAX_POSITION_KEY_LENGTH`.
 */
export function generateEvenPositions(count: number): string[] {
  if (count <= 0) return [];
  const width = Math.max(2, Math.ceil(Math.log(count + 2) / Math.log(BASE)));
  const positions: string[] = [];

  for (let i = 0; i < count; i++) {
    // Spread across the keyspace leaving room before/after every row
    const value = (i + 1) * 4;
    const base36 = value.toString(BASE);
    const padded = base36.padStart(width + 1, "0");
    positions.push(`a${padded}`);
  }

  return positions;
}
