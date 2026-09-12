import { useState, useRef } from 'react';
import {
  Leaf, ArrowRight, Loader2, ShieldCheck, Zap, ListChecks,
  Eye, EyeOff, Lock, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { loginUser, validateEmail } from '@/lib/localAuth';
import type { LocalSession } from '@/lib/localAuth';

interface LoginPageProps {
  onNavigateRegister: () => void;
  onNavigateForgot: () => void;
  onAuthenticated: (session: LocalSession) => void;
  /** Optional success message shown after password reset */
  successMessage?: string;
}

const FEATURES = [
  { icon: ListChecks, label: 'Eisenhower Matrix', desc: 'Prioritise tasks by urgency & importance' },
  { icon: Zap, label: 'Smart Automations', desc: 'Scheduled reminders and rule-based actions' },
  { icon: ShieldCheck, label: 'Private & Secure', desc: 'Your data stays on your device, always yours' },
];

export function LoginPage({
  onNavigateRegister,
  onNavigateForgot,
  onAuthenticated,
  successMessage,
}: LoginPageProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const identifierRef = useRef<HTMLInputElement>(null);

  function clearErrors() {
    setGlobalError(null);
    setFieldErrors({});
  }

  function validateIdentifierField(value: string): string | undefined {
    if (!value.trim()) return 'Email or username is required.';
    if (value.includes('@')) {
      const emailErr = validateEmail(value.trim());
      if (emailErr) return emailErr;
    }
    return undefined;
  }

  function validatePasswordField(value: string): string | undefined {
    if (!value) return 'Password is required.';
    return undefined;
  }

  function handleIdentifierBlur() {
    const err = validateIdentifierField(identifier);
    if (err) setFieldErrors((p) => ({ ...p, identifier: err }));
  }

  function handlePasswordBlur() {
    const err = validatePasswordField(password);
    if (err) setFieldErrors((p) => ({ ...p, password: err }));
  }

  function validateFields(): boolean {
    const errs: { identifier?: string; password?: string } = {};
    const idErr = validateIdentifierField(identifier);
    if (idErr) errs.identifier = idErr;
    const pwErr = validatePasswordField(password);
    if (pwErr) errs.password = pwErr;
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearErrors();
    if (!validateFields()) return;
    setLoading(true);
    try {
      const result = await loginUser(identifier.trim(), password, rememberMe);
      if (result.ok === true) {
        setLockedUntil(null);
        setAttemptsLeft(null);
        onAuthenticated(result.user);
      } else {
        // Surface lockout info
        if ('lockedUntil' in result && result.lockedUntil) {
          setLockedUntil(result.lockedUntil);
          setNow(Date.now());
          setAttemptsLeft(0);
          setGlobalError(result.error);
        } else if ('attemptsLeft' in result && typeof result.attemptsLeft === 'number') {
          setAttemptsLeft(result.attemptsLeft);
          const msg = result.error;
          if (msg.toLowerCase().includes('password')) {
            setFieldErrors({ password: msg });
          } else {
            setGlobalError(msg);
          }
        } else {
          const msg = result.error;
          if (msg.toLowerCase().includes('password')) {
            setFieldErrors({ password: msg });
          } else if (
            msg.toLowerCase().includes('email') ||
            msg.toLowerCase().includes('username') ||
            msg.toLowerCase().includes('account')
          ) {
            setFieldErrors({ identifier: msg });
          } else {
            setGlobalError(msg);
          }
        }
        setLoading(false);
      }
    } catch {
      setGlobalError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  const isLocked = lockedUntil !== null && lockedUntil > now;
  const minutesLeft = lockedUntil ? Math.ceil((lockedUntil - now) / 60000) : 0;

  return (
    <div className="min-h-svh bg-background flex flex-col lg:flex-row">
      {/* ── Left panel — branding ── */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] flex-shrink-0 bg-primary/5 border-r border-border p-10">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15">
            <Leaf className="size-5 text-primary" />
          </div>
          <span className="text-base font-bold tracking-tight text-foreground">Kaizen Flow</span>
        </div>

        {/* Feature list */}
        <div className="space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight text-foreground leading-snug">
              Continuous improvement,<br />one task at a time.
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Kaizen Flow helps you focus on what matters using the Eisenhower Matrix — so you always work on the right things.
            </p>
          </div>

          <div className="space-y-4">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0 mt-0.5">
                  <Icon className="size-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground/60">
          Kaizen Flow · Your data, your device
        </p>
      </div>

      {/* ── Right panel — sign in form ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-10">
        {/* Mobile logo */}
        <div className="flex lg:hidden flex-col items-center gap-2 mb-10 animate-fade-in">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <Leaf className="size-6 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground">Kaizen Flow</span>
        </div>

        <div className="w-full max-w-sm animate-slide-up">
          {/* Heading */}
          <div className="space-y-1.5 mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome back</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your account to continue
            </p>
          </div>

          {/* Success message (e.g. after password reset) */}
          {successMessage && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/8 px-4 py-3 animate-fade-in">
              <ShieldCheck className="size-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-sm text-primary leading-snug">{successMessage}</p>
            </div>
          )}

          {/* Account locked banner */}
          {isLocked && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 animate-fade-in">
              <Lock className="size-4 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-destructive">Account temporarily locked</p>
                <p className="text-xs text-destructive/80">
                  Too many failed attempts. Try again in{' '}
                  {minutesLeft} minute{minutesLeft !== 1 ? 's' : ''}.
                </p>
              </div>
            </div>
          )}

          {/* Attempts warning */}
          {!isLocked && attemptsLeft !== null && attemptsLeft > 0 && attemptsLeft <= 3 && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/8 px-4 py-3 animate-fade-in">
              <AlertTriangle className="size-4 text-yellow-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-600 dark:text-yellow-400 leading-snug">
                {attemptsLeft} attempt{attemptsLeft !== 1 ? 's' : ''} remaining before your account is temporarily locked.
              </p>
            </div>
          )}

          {/* Global error */}
          {globalError && !isLocked && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 animate-fade-in">
              <div className="flex size-5 items-center justify-center rounded-full bg-destructive/15 flex-shrink-0 mt-0.5">
                <span className="text-destructive text-xs font-bold">!</span>
              </div>
              <p className="text-sm text-destructive leading-snug">{globalError}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="identifier" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Email or username
              </Label>
              <Input
                id="identifier"
                ref={identifierRef}
                type="text"
                autoComplete="username email"
                placeholder="you@example.com"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setFieldErrors((p) => ({ ...p, identifier: undefined }));
                  setGlobalError(null);
                }}
                onBlur={handleIdentifierBlur}
                disabled={loading || isLocked}
                className={cn(
                  'h-11 rounded-xl text-sm',
                  fieldErrors.identifier && 'border-destructive focus-visible:ring-destructive/30',
                )}
                autoFocus
                aria-describedby={fieldErrors.identifier ? 'identifier-error' : undefined}
              />
              {fieldErrors.identifier && (
                <p id="identifier-error" className="text-[11px] text-destructive animate-fade-in">
                  {fieldErrors.identifier}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={onNavigateForgot}
                  className="text-[11px] text-primary hover:text-primary/80 transition-colors duration-150 font-medium"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((p) => ({ ...p, password: undefined }));
                    setGlobalError(null);
                  }}
                  onBlur={handlePasswordBlur}
                  disabled={loading || isLocked}
                  className={cn(
                    'h-11 rounded-xl text-sm pr-10',
                    fieldErrors.password && 'border-destructive focus-visible:ring-destructive/30',
                  )}
                  aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-150"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {fieldErrors.password && (
                <p id="password-error" className="text-[11px] text-destructive animate-fade-in">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Remember me */}
            <label className="flex items-center gap-2.5 cursor-pointer group select-none">
              <div className="relative flex-shrink-0">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading || isLocked}
                  className="sr-only peer"
                />
                <div className={cn(
                  'size-4 rounded border border-border bg-background transition-all duration-150',
                  'peer-checked:bg-primary peer-checked:border-primary',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1',
                  'group-hover:border-primary/60',
                )} />
                {rememberMe && (
                  <svg
                    className="absolute inset-0 m-auto size-2.5 text-primary-foreground pointer-events-none"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="1.5,5 4,7.5 8.5,2.5" />
                  </svg>
                )}
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors duration-150">
                Remember me for 30 days
              </span>
            </label>

            <Button
              type="submit"
              disabled={loading || isLocked}
              className={cn(
                'w-full h-11 text-sm font-semibold rounded-xl gap-2.5 transition-all duration-200 mt-2',
                loading && 'opacity-80',
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Signing in…
                </>
              ) : isLocked ? (
                <>
                  <Lock className="size-4" />
                  Account locked
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-3 text-xs text-muted-foreground">New to Kaizen Flow?</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={onNavigateRegister}
            disabled={loading}
            className="w-full h-10 text-sm rounded-xl gap-2"
          >
            Create a free account
          </Button>
        </div>
      </div>
    </div>
  );
}
