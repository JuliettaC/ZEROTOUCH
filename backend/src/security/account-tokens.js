import { createHash, randomBytes } from 'node:crypto';

// Single-use account tokens (email verification and password reset).
// 32 random bytes -> 43 base64url characters. Only the SHA-256 hash is stored.
export const VERIFICATION_TTL_SECONDS = 24 * 3600;
export const RESET_TTL_SECONDS = 30 * 60;
export const RESEND_COOLDOWN_SECONDS = 60;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const newAccountToken = () => randomBytes(32).toString('base64url');
export const accountTokenHash = raw => createHash('sha256').update(raw).digest('hex');
