/**
 * localAuth.ts — App-owned authentication layer (v3)
 *
 * - Users table stored in localStorage under 'kaizen-users'
 * - Session stored in localStorage under 'kaizen-session'
 * - Passwords hashed with SHA-256 + per-user random salt via Web Crypto API
 * - Supports forgot/reset password flow with time-limited tokens
 * - Supports email-verification state (mock, client-only)
 * - Login attempt tracking with lockout after 5 failures (15-min window)
 * - Session expiry (7-day default, 30-day with "remember me")
 * - Detailed password rule feedback
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LocalUser {
  id: string;
  email: string;
  username: string;
  /** hex-encoded SHA-256(salt + password) */
  passwordHash: string;
  /** hex-encoded 16-byte random salt */
  salt: string;
  emailVerified: boolean;
  /** opaque token for password reset */
  resetToken: string | null;
  /** Unix ms expiry for resetToken */
  resetTokenExpiry: number | null;
  /** opaque token for email verification */
  verifyToken: string | null;
  createdAt: string;
  /** consecutive failed login attempts in current window */
  failedAttempts: number;
  /** Unix ms when the account lockout expires (null = not locked) */
  lockedUntil: number | null;
}

export interface LocalSession {
  userId: string;
  email: string;
  username: string;
  emailVerified: boolean;
  /** Unix ms when this session expires */
  expiresAt: number;
}

export type AuthResult =
  | { ok: true; user: LocalSession }
  | { ok: false; error: string };

/** Detailed password rule check result */
export interface PasswordRules {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const USERS_KEY = 'kaizen-users';
const SESSION_KEY = 'kaizen-session';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_DEFAULT = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_TTL_REMEMBER = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Crypto helpers ────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashWithSalt(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Legacy hash (no salt) — used only for migration detection */
async function legacyHash(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'kaizen-salt-v1');
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Users store ───────────────────────────────────────────────────────────────

function getUsers(): LocalUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LocalUser[];
  } catch {
    return [];
  }
}

function saveUsers(users: LocalUser[]): void {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch { /* ignore */ }
}

function updateUser(updated: LocalUser): void {
  const users = getUsers().map((u) => (u.id === updated.id ? updated : u));
  saveUsers(users);
}

function findUserByEmail(email: string): LocalUser | undefined {
  return getUsers().find((u) => u.email.toLowerCase() === email.toLowerCase());
}

function findUserByUsername(username: string): LocalUser | undefined {
  return getUsers().find(
    (u) => u.username.toLowerCase() === username.toLowerCase(),
  );
}

function findUserById(id: string): LocalUser | undefined {
  return getUsers().find((u) => u.id === id);
}

function findUserByResetToken(token: string): LocalUser | undefined {
  return getUsers().find((u) => u.resetToken === token);
}

// ── Session ───────────────────────────────────────────────────────────────────

export function getSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSession;
    // Check session expiry
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      clearSession();
      return null;
    }
    // Re-hydrate emailVerified from the live user record (may have changed)
    const user = findUserById(parsed.userId);
    if (!user) return null; // user deleted — invalidate session
    return { ...parsed, emailVerified: user.emailVerified };
  } catch {
    return null;
  }
}

function saveSession(session: LocalSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* ignore */ }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateEmail(email: string): string | null {
  if (!email.trim()) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return 'Enter a valid email address.';
  return null;
}

export function validateUsername(username: string): string | null {
  if (!username.trim()) return 'Username is required.';
  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (username.length > 30) return 'Username must be 30 characters or fewer.';
  if (!/^[a-zA-Z0-9_.-]+$/.test(username))
    return 'Username may only contain letters, numbers, _, ., and -.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

/** Returns detailed per-rule breakdown for password */
export function checkPasswordRules(password: string): PasswordRules {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSymbol: /[^A-Za-z0-9]/.test(password),
  };
}

/** Returns a score 0–4 for password strength */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

// ── Duplicate checks (synchronous, for onBlur) ────────────────────────────────

/** Returns true if the email is already registered */
export function isEmailTaken(email: string): boolean {
  return !!findUserByEmail(email.trim());
}

/** Returns true if the username is already registered */
export function isUsernameTaken(username: string): boolean {
  return !!findUserByUsername(username.trim());
}

// ── Migration guard ───────────────────────────────────────────────────────────

/**
 * Detects users stored without a salt field (legacy v1 schema).
 * Returns true if the given user record needs re-registration.
 */
export function isLegacyUser(user: LocalUser): boolean {
  return !user.salt;
}

/** Normalise legacy user records that are missing new fields */
function normaliseLegacyUser(user: Partial<LocalUser> & { id: string; email: string; username: string; passwordHash: string; salt: string; emailVerified: boolean; createdAt: string }): LocalUser {
  return {
    resetToken: null,
    resetTokenExpiry: null,
    verifyToken: null,
    failedAttempts: 0,
    lockedUntil: null,
    ...user,
  };
}

// ── Lockout helpers ───────────────────────────────────────────────────────────

function isLockedOut(user: LocalUser): boolean {
  if (!user.lockedUntil) return false;
  if (Date.now() > user.lockedUntil) {
    // Lockout expired — reset
    updateUser({ ...user, failedAttempts: 0, lockedUntil: null });
    return false;
  }
  return true;
}

function lockoutRemainingMs(user: LocalUser): number {
  if (!user.lockedUntil) return 0;
  return Math.max(0, user.lockedUntil - Date.now());
}

function recordFailedAttempt(user: LocalUser): LocalUser {
  const attempts = (user.failedAttempts ?? 0) + 1;
  const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS
    ? Date.now() + LOCKOUT_DURATION_MS
    : user.lockedUntil ?? null;
  const updated = { ...user, failedAttempts: attempts, lockedUntil };
  updateUser(updated);
  return updated;
}

function clearFailedAttempts(user: LocalUser): void {
  updateUser({ ...user, failedAttempts: 0, lockedUntil: null });
}

/** Returns how many attempts remain before lockout */
export function attemptsRemaining(user: LocalUser): number {
  return Math.max(0, MAX_FAILED_ATTEMPTS - (user.failedAttempts ?? 0));
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function registerUser(
  email: string,
  username: string,
  password: string,
): Promise<AuthResult> {
  const emailErr = validateEmail(email);
  if (emailErr) return { ok: false, error: emailErr };

  const usernameErr = validateUsername(username);
  if (usernameErr) return { ok: false, error: usernameErr };

  const passwordErr = validatePassword(password);
  if (passwordErr) return { ok: false, error: passwordErr };

  if (findUserByEmail(email)) {
    return { ok: false, error: 'An account with this email already exists.' };
  }
  if (findUserByUsername(username)) {
    return { ok: false, error: 'This username is already taken.' };
  }

  const salt = randomHex(16);
  const passwordHash = await hashWithSalt(password, salt);
  const verifyToken = crypto.randomUUID();

  const newUser: LocalUser = {
    id: crypto.randomUUID(),
    email: email.trim().toLowerCase(),
    username: username.trim(),
    passwordHash,
    salt,
    emailVerified: false,
    resetToken: null,
    resetTokenExpiry: null,
    verifyToken,
    createdAt: new Date().toISOString(),
    failedAttempts: 0,
    lockedUntil: null,
  };

  const users = getUsers();
  users.push(newUser);
  saveUsers(users);

  const session: LocalSession = {
    userId: newUser.id,
    email: newUser.email,
    username: newUser.username,
    emailVerified: false,
    expiresAt: Date.now() + SESSION_TTL_DEFAULT,
  };
  saveSession(session);

  return { ok: true, user: session };
}

/**
 * Returns the verifyToken for a user (to display inline after registration).
 * Returns null if user not found or already verified.
 */
export function getVerifyToken(userId: string): string | null {
  const user = findUserById(userId);
  if (!user || user.emailVerified) return null;
  return user.verifyToken;
}

export async function loginUser(
  emailOrUsername: string,
  password: string,
  rememberMe = false,
): Promise<AuthResult & { lockedUntil?: number; attemptsLeft?: number }> {
  if (!emailOrUsername.trim())
    return { ok: false, error: 'Email or username is required.' };
  if (!password) return { ok: false, error: 'Password is required.' };

  const rawUser =
    findUserByEmail(emailOrUsername) ?? findUserByUsername(emailOrUsername);

  if (!rawUser) {
    return { ok: false, error: 'No account found with that email or username.' };
  }

  // Normalise legacy records missing new fields
  const user = normaliseLegacyUser(rawUser as Parameters<typeof normaliseLegacyUser>[0]);

  // Check lockout
  if (isLockedOut(user)) {
    const remaining = lockoutRemainingMs(user);
    const mins = Math.ceil(remaining / 60000);
    return {
      ok: false,
      error: `Account temporarily locked. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`,
      lockedUntil: user.lockedUntil ?? undefined,
    };
  }

  // Migration guard: legacy users have no salt — try legacy hash, then migrate
  if (isLegacyUser(user)) {
    const legacyH = await legacyHash(password);
    if (legacyH === user.passwordHash) {
      const salt = randomHex(16);
      const newHash = await hashWithSalt(password, salt);
      const verifyToken = crypto.randomUUID();
      const migrated: LocalUser = {
        ...user,
        salt,
        passwordHash: newHash,
        emailVerified: user.emailVerified ?? false,
        resetToken: user.resetToken ?? null,
        resetTokenExpiry: user.resetTokenExpiry ?? null,
        verifyToken: user.verifyToken ?? verifyToken,
        failedAttempts: 0,
        lockedUntil: null,
      };
      updateUser(migrated);
      const session: LocalSession = {
        userId: migrated.id,
        email: migrated.email,
        username: migrated.username,
        emailVerified: migrated.emailVerified,
        expiresAt: Date.now() + (rememberMe ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT),
      };
      saveSession(session);
      return { ok: true, user: session };
    }
    const updated = recordFailedAttempt(user);
    const left = attemptsRemaining(updated);
    return {
      ok: false,
      error: left > 0
        ? `Incorrect password. ${left} attempt${left !== 1 ? 's' : ''} remaining.`
        : 'Account temporarily locked due to too many failed attempts.',
      attemptsLeft: left,
    };
  }

  const hash = await hashWithSalt(password, user.salt);
  if (hash !== user.passwordHash) {
    const updated = recordFailedAttempt(user);
    const left = attemptsRemaining(updated);
    if (left === 0) {
      return {
        ok: false,
        error: 'Account temporarily locked due to too many failed attempts. Try again in 15 minutes.',
        lockedUntil: updated.lockedUntil ?? undefined,
        attemptsLeft: 0,
      };
    }
    return {
      ok: false,
      error: `Incorrect password. ${left} attempt${left !== 1 ? 's' : ''} remaining before lockout.`,
      attemptsLeft: left,
    };
  }

  // Success — clear failed attempts
  clearFailedAttempts(user);

  const session: LocalSession = {
    userId: user.id,
    email: user.email,
    username: user.username,
    emailVerified: user.emailVerified,
    expiresAt: Date.now() + (rememberMe ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT),
  };
  saveSession(session);

  return { ok: true, user: session };
}

export function logoutUser(): void {
  clearSession();
}

/**
 * Generates a password-reset token for the given email.
 * Returns the token (to be shown inline as a mock "email link").
 * Token expires in 15 minutes.
 */
export function requestPasswordReset(
  email: string,
): { ok: true; token: string; username: string } | { ok: false; error: string } {
  const user = findUserByEmail(email);
  if (!user) {
    // Don't reveal whether the email exists
    return { ok: false, error: 'No account found with that email address.' };
  }
  const token = crypto.randomUUID();
  const expiry = Date.now() + 15 * 60 * 1000; // 15 min
  updateUser({ ...user, resetToken: token, resetTokenExpiry: expiry });
  return { ok: true, token, username: user.username };
}

/**
 * Validates a reset token and sets a new password.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<AuthResult> {
  const passwordErr = validatePassword(newPassword);
  if (passwordErr) return { ok: false, error: passwordErr };

  const user = findUserByResetToken(token);
  if (!user || !user.resetToken || !user.resetTokenExpiry) {
    return { ok: false, error: 'Invalid or expired reset link.' };
  }
  if (Date.now() > user.resetTokenExpiry) {
    return { ok: false, error: 'This reset link has expired. Please request a new one.' };
  }

  const salt = randomHex(16);
  const passwordHash = await hashWithSalt(newPassword, salt);
  const updated: LocalUser = {
    ...user,
    salt,
    passwordHash,
    resetToken: null,
    resetTokenExpiry: null,
    failedAttempts: 0,
    lockedUntil: null,
  };
  updateUser(updated);

  const session: LocalSession = {
    userId: updated.id,
    email: updated.email,
    username: updated.username,
    emailVerified: updated.emailVerified,
    expiresAt: Date.now() + SESSION_TTL_DEFAULT,
  };
  saveSession(session);
  return { ok: true, user: session };
}

/**
 * Marks the current session user's email as verified.
 */
export function markEmailVerified(userId: string): boolean {
  const user = findUserById(userId);
  if (!user) return false;
  updateUser({ ...user, emailVerified: true, verifyToken: null });
  // Update session
  const session = getSession();
  if (session && session.userId === userId) {
    saveSession({ ...session, emailVerified: true });
  }
  return true;
}

/**
 * Generates a new verification token for the user (mock resend).
 * Returns the token to display inline.
 */
export function resendVerification(
  userId: string,
): { ok: true; token: string } | { ok: false; error: string } {
  const user = findUserById(userId);
  if (!user) return { ok: false, error: 'User not found.' };
  if (user.emailVerified) return { ok: false, error: 'Email already verified.' };
  const token = crypto.randomUUID();
  updateUser({ ...user, verifyToken: token });
  return { ok: true, token };
}

/**
 * Verifies email using a verify token.
 */
export function verifyEmailWithToken(
  token: string,
): { ok: true } | { ok: false; error: string } {
  const users = getUsers();
  const user = users.find((u) => u.verifyToken === token);
  if (!user) return { ok: false, error: 'Invalid verification token.' };
  markEmailVerified(user.id);
  return { ok: true };
}

/** Returns the storage key for a given user's app data */
export function userStorageKey(userId: string): string {
  return `kaizen-app-v3-${userId}`;
}
