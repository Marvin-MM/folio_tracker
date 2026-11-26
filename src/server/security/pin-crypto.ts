import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
} as const;

export interface HashedPin {
  hash: string;
  salt: string;
}

/**
 * Derives a per-user salted `scrypt` digest for 4–6 digit Accountability PINs.
 * Uses Node's built-in `crypto` with zero external dependencies.
 */
export function hashMonthLockPin(pin: string): HashedPin {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(pin, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return {
    hash: derived.toString("hex"),
    salt,
  };
}

/**
 * Constant-time PIN verification resistant to timing side-channels.
 */
export function verifyMonthLockPin(
  pin: string,
  expectedHash: string,
  salt: string
): boolean {
  if (!pin || !expectedHash || !salt) return false;
  try {
    const expectedBuf = Buffer.from(expectedHash, "hex");
    if (expectedBuf.length !== SCRYPT_KEY_LENGTH) return false;
    const candidateBuf = scryptSync(pin, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
    return timingSafeEqual(expectedBuf, candidateBuf);
  } catch {
    return false;
  }
}
