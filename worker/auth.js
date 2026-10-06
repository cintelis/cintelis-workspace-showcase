// ============================================================
// Cintelis Workspace — Auth primitives
// PBKDF2 password hashing + RFC 6238 TOTP + base32 + backup codes.
// Lifted from adsoptimiser-tiktok/src/worker/src/db/user-identity.ts
// (Web Crypto only — no external dependencies, runs on Cloudflare Workers).
// ============================================================

// Cloudflare Workers caps PBKDF2 at 100,000 iterations.
export const PBKDF2_ITERATIONS = 100000;
export const PBKDF2_ALGORITHM = 'PBKDF2-SHA256';

const TOTP_SECRET_BYTES = 20;
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const TOTP_ISSUER = 'Cintelis Workspace';

// ── Hex / bytes helpers ──────────────────────────────────────
export function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  const s = String(hex || '').trim().toLowerCase();
  if (!s || s.length % 2 !== 0) throw new Error('Invalid hex input');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}

export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return r === 0;
}

// ── Base32 (TOTP secret encoding) ────────────────────────────
function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input) {
  const s = String(input || '').replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of s) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 input');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// ── PBKDF2 password hashing ──────────────────────────────────
async function derivePasswordBits(password, salt, iterations = PBKDF2_ITERATIONS) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

// Returns { hash (hex), salt (hex), iterations, algorithm }
export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashBytes = await derivePasswordBits(password, saltBytes);
  return {
    hash: toHex(hashBytes),
    salt: toHex(saltBytes),
    iterations: PBKDF2_ITERATIONS,
    algorithm: PBKDF2_ALGORITHM,
  };
}

export async function verifyPassword(password, hashHex, saltHex, iterations) {
  if (!hashHex || !saltHex) return false;
  try {
    const expected = fromHex(hashHex);
    const actual = await derivePasswordBits(
      password,
      fromHex(saltHex),
      Number(iterations || PBKDF2_ITERATIONS)
    );
    return equalBytes(expected, actual);
  } catch {
    return false;
  }
}

// ── TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30s step, ±1 window) ──
function counterBytes(counter) {
  const b = new Uint8Array(8);
  let v = Math.max(0, Math.floor(counter));
  for (let i = 7; i >= 0; i--) { b[i] = v & 0xff; v = Math.floor(v / 256); }
  return b;
}

async function generateTotpCode(secretBase32, timeStep) {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secretBase32),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(timeStep)));
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

// Returns { secret (base32), otpauthUri }
export function generateTotpSecret(accountLabel) {
  const secret = base32Encode(crypto.getRandomValues(new Uint8Array(TOTP_SECRET_BYTES)));
  const label = encodeURIComponent(`${TOTP_ISSUER}:${accountLabel || 'user'}`);
  const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
  return { secret, otpauthUri };
}

export async function verifyTotp(secretBase32, code) {
  const normalized = String(code || '').replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  if (!secretBase32) return false;
  const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  for (let off = -TOTP_WINDOW; off <= TOTP_WINDOW; off++) {
    try {
      const candidate = await generateTotpCode(secretBase32, step + off);
      if (candidate === normalized) return true;
    } catch {
      return false;
    }
  }
  return false;
}

// ── Backup codes ─────────────────────────────────────────────
// Format: 10 codes, 10 chars each, lowercase alnum (no ambiguous chars).
// Plain values are returned to caller ONCE; only hashes are stored.
const BACKUP_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const BACKUP_CODE_LENGTH = 10;
const BACKUP_CODE_COUNT = 10;

function generatePlainBackupCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(BACKUP_CODE_LENGTH));
  let out = '';
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    out += BACKUP_CODE_ALPHABET[bytes[i] % BACKUP_CODE_ALPHABET.length];
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

function normalizeBackupCode(code) {
  return String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Returns [{ plain, hash, salt, iterations, algorithm }]
// Caller stores the hash/salt rows and shows `plain` to the user ONCE.
export async function generateBackupCodes(count = BACKUP_CODE_COUNT) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const plain = generatePlainBackupCode();
    const normalized = normalizeBackupCode(plain);
    const { hash, salt, iterations, algorithm } = await hashPassword(normalized);
    out.push({ plain, hash, salt, iterations, algorithm });
  }
  return out;
}

// Verifies a candidate backup code against the stored unused rows.
// On match, returns the row id so caller can mark it used. Returns null on miss.
export async function findMatchingBackupCode(env, userId, candidate) {
  const normalized = normalizeBackupCode(candidate);
  if (!normalized) return null;
  const { results } = await env.DB.prepare(
    'SELECT id, code_hash, salt FROM user_backup_codes WHERE user_id=? AND used_at IS NULL'
  ).bind(userId).all();
  for (const row of (results || [])) {
    const ok = await verifyPassword(normalized, row.code_hash, row.salt, PBKDF2_ITERATIONS);
    if (ok) return row.id;
  }
  return null;
}

// ── ID helpers ───────────────────────────────────────────────
export function generateUserId() {
  return `usr_${toHex(crypto.getRandomValues(new Uint8Array(12)))}`;
}

export function generateSessionId() {
  // 32 hex chars; doubles as the Bearer token.
  return crypto.randomUUID().replace(/-/g, '');
}
