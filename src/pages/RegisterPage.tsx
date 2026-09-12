import { useState } from 'react';
import {
  Leaf, ArrowLeft, Loader2, Sparkles, Eye, EyeOff,
  Check, X as XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  registerUser,
  validateEmail,
  validateUsername,
  validatePassword,
  passwordStrength,
  checkPasswordRules,
  isEmailTaken,
  isUsernameTaken,
} from '@/lib/localAuth';
import type { LocalSession } from '@/lib/localAuth';

interface RegisterPageProps {
  onNavigateLogin: () => void;
  onAuthenticated: (session: LocalSession) => void;
}

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLORS = ['', 'bg-destructive', 'bg-yellow-500', 'bg-blue-500', 'bg-primary'];
const STRENGTH_TEXT_COLORS = ['', 'text-destructive', 'text-yellow-500', 'text-blue-500', 'text-primary'];

function RuleRow({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {met ? (
        <Check className="size-3 text-primary flex-shrink-0" />
      ) : (
        <XIcon className="size-3 text-muted-foreground/50 flex-shrink-0" />
      )}
      <span className={cn('text-[11px]', met ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </div>
  );
}

export function RegisterPage({ onNavigateLogin, onAuthenticated }: RegisterPageProps) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    username?: string;
    password?: string;
    confirm?: string;
  }>({});

  const strength = passwordStrength(password);
  const rules = checkPasswordRules(password);

  function clearFieldError(field: keyof typeof fieldErrors) {
    setFieldErrors((p) => ({ ...p, [field]: undefined }));
    setGlobalError(null);
  }

  // ── onBlur validators ──────────────────────────────────────────────────────

  function handleEmailBlur() {
    const trimmed = email.trim();
    const formatErr = validateEmail(trimmed);
    if (formatErr) {
      setFieldErrors((p) => ({ ...p, email: formatErr }));
      return;
    }
    if (trimmed && isEmailTaken(trimmed)) {
      setFieldErrors((p) => ({
        ...p,
        email: 'An account with this email already exists. Try signing in instead.',
      }));
    }
  }

  function handleUsernameBlur() {
    const trimmed = username.trim();
    const formatErr = validateUsername(trimmed);
    if (formatErr) {
      setFieldErrors((p) => ({ ...p, username: formatErr }));
      return;
    }
    if (trimmed && isUsernameTaken(trimmed)) {
      setFieldErrors((p) => ({
        ...p,
        username: 'This username is already taken. Please choose another.',
      }));
    }
  }

  function handlePasswordBlur() {
    const err = validatePassword(password);
    if (err) setFieldErrors((p) => ({ ...p, password: err }));
  }

  function handleConfirmBlur() {
    if (!confirmPassword) {
      setFieldErrors((p) => ({ ...p, confirm: 'Please confirm your password.' }));
    } else if (password !== confirmPassword) {
      setFieldErrors((p) => ({ ...p, confirm: 'Passwords do not match.' }));
    }
  }

  // ── Submit validation ──────────────────────────────────────────────────────

  function validateFields(): boolean {
    const errs: typeof fieldErrors = {};
    const emailErr = validateEmail(email.trim());
    if (emailErr) errs.email = emailErr;
    const usernameErr = validateUsername(username.trim());
    if (usernameErr) errs.username = usernameErr;
    const passwordErr = validatePassword(password);
    if (passwordErr) errs.password = passwordErr;
    if (!confirmPassword) errs.confirm = 'Please confirm your password.';
    else if (password !== confirmPassword) errs.confirm = 'Passwords do not match.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError(null);
    if (!validateFields()) return;

    setLoading(true);
    try {
      const result = await registerUser(email.trim(), username.trim(), password);
      if (result.ok === true) {
        onAuthenticated(result.user);
      } else {
        const msg = result.error;
        if (msg.toLowerCase().includes('email')) {
          setFieldErrors({ email: msg });
        } else if (msg.toLowerCase().includes('username')) {
          setFieldErrors({ username: msg });
        } else if (msg.toLowerCase().includes('password')) {
          setFieldErrors({ password: msg });
        } else {
          setGlobalError(msg);
        }
        setLoading(false);
      }
    } catch {
      setGlobalError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-svh bg-background flex flex-col lg:flex-row">
      {/* ── Left panel — branding ── */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] flex-shrink-0 bg-primary/5 border-r border-border p-10">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15">
            <Leaf className="size-5 text-primary" />
          </div>
          <span className="text-base font-bold tracking-tight text-foreground">Kaizen Flow</span>
        </div>

        <div className="space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight text-foreground leading-snug">
              Start your journey<br />toward better focus.
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Create your free account and start organising tasks with the Eisenhower Matrix — no credit card, no Zoho account required.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-background/60 p-5 space-y-3">
            {[
              'Free forever — no credit card required',
              'Your data stays on your device',
              'Eisenhower Matrix + smart automations',
              'Streak tracking & momentum insights',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5">
                <div className="size-1.5 rounded-full bg-primary flex-shrink-0" />
                <p className="text-xs text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground/60">
          Kaizen Flow · Your data, your device
        </p>
      </div>

      {/* ── Right panel — register form ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-10">
        {/* Mobile logo */}
        <div className="flex lg:hidden flex-col items-center gap-2 mb-8 animate-fade-in">
          <div className="relative">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
              <Leaf className="size-6 text-primary" />
            </div>
            <div className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary">
              <Sparkles className="size-3 text-primary-foreground" />
            </div>
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground">Kaizen Flow</span>
        </div>

        <div className="w-full max-w-sm animate-slide-up">
          {/* Heading */}
          <div className="space-y-1.5 mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Create account</h1>
            <p className="text-sm text-muted-foreground">
              Start your continuous improvement journey today
            </p>
          </div>

          {/* Global error */}
          {globalError && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 animate-fade-in">
              <div className="flex size-5 items-center justify-center rounded-full bg-destructive/15 flex-shrink-0 mt-0.5">
                <span className="text-destructive text-xs font-bold">!</span>
              </div>
              <p className="text-sm text-destructive leading-snug">{globalError}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="reg-email" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Email
              </Label>
              <Input
                id="reg-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearFieldError('email'); }}
                onBlur={handleEmailBlur}
                disabled={loading}
                className={cn(
                  'h-11 rounded-xl text-sm',
                  fieldErrors.email && 'border-destructive focus-visible:ring-destructive/30',
                )}
                autoFocus
                aria-describedby={fieldErrors.email ? 'reg-email-error' : undefined}
              />
              {fieldErrors.email && (
                <p id="reg-email-error" className="text-[11px] text-destructive animate-fade-in">
                  {fieldErrors.email}
                  {fieldErrors.email.includes('already exists') && (
                    <button
                      type="button"
                      onClick={onNavigateLogin}
                      className="ml-1 underline underline-offset-2 hover:no-underline"
                    >
                      Sign in instead
                    </button>
                  )}
                </p>
              )}
            </div>

            {/* Username */}
            <div className="space-y-1.5">
              <Label htmlFor="reg-username" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Username
              </Label>
              <Input
                id="reg-username"
                type="text"
                autoComplete="username"
                placeholder="yourname"
                value={username}
                onChange={(e) => { setUsername(e.target.value); clearFieldError('username'); }}
                onBlur={handleUsernameBlur}
                disabled={loading}
                className={cn(
                  'h-11 rounded-xl text-sm',
                  fieldErrors.username && 'border-destructive focus-visible:ring-destructive/30',
                )}
                aria-describedby={fieldErrors.username ? 'reg-username-error' : 'reg-username-hint'}
              />
              {fieldErrors.username ? (
                <p id="reg-username-error" className="text-[11px] text-destructive animate-fade-in">
                  {fieldErrors.username}
                </p>
              ) : (
                <p id="reg-username-hint" className="text-[11px] text-muted-foreground">
                  Letters, numbers, _, . and - only. Min 3 characters.
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="reg-password" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearFieldError('password');
                    if (!showRules && e.target.value) setShowRules(true);
                  }}
                  onBlur={handlePasswordBlur}
                  onFocus={() => { if (password) setShowRules(true); }}
                  disabled={loading}
                  className={cn(
                    'h-11 rounded-xl text-sm pr-10',
                    fieldErrors.password && 'border-destructive focus-visible:ring-destructive/30',
                  )}
                  aria-describedby={fieldErrors.password ? 'reg-password-error' : undefined}
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

              {/* Strength meter */}
              {password && (
                <div className="space-y-1 animate-fade-in">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={cn(
                          'h-1 flex-1 rounded-full transition-all duration-300',
                          strength >= i ? STRENGTH_COLORS[strength] : 'bg-muted',
                        )}
                      />
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Strength:{' '}
                    <span className={cn('font-medium', STRENGTH_TEXT_COLORS[strength] || 'text-muted-foreground')}>
                      {STRENGTH_LABELS[strength] || 'Very weak'}
                    </span>
                  </p>
                </div>
              )}

              {/* Password rules checklist */}
              {showRules && password && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 animate-fade-in">
                  <RuleRow met={rules.minLength} label="At least 8 characters" />
                  <RuleRow met={rules.hasUppercase} label="One uppercase letter (A–Z)" />
                  <RuleRow met={rules.hasLowercase} label="One lowercase letter (a–z)" />
                  <RuleRow met={rules.hasNumber} label="One number (0–9)" />
                  <RuleRow met={rules.hasSymbol} label="One symbol (!@#$…)" />
                </div>
              )}

              {fieldErrors.password && (
                <p id="reg-password-error" className="text-[11px] text-destructive animate-fade-in">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <Label htmlFor="reg-confirm" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Confirm password
              </Label>
              <div className="relative">
                <Input
                  id="reg-confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); clearFieldError('confirm'); }}
                  onBlur={handleConfirmBlur}
                  disabled={loading}
                  className={cn(
                    'h-11 rounded-xl text-sm pr-10',
                    fieldErrors.confirm && 'border-destructive focus-visible:ring-destructive/30',
                    !fieldErrors.confirm && confirmPassword && confirmPassword === password && 'border-primary/50',
                  )}
                  aria-describedby={fieldErrors.confirm ? 'reg-confirm-error' : undefined}
                />
                {/* Match indicator */}
                {confirmPassword && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {confirmPassword === password ? (
                      <Check className="size-4 text-primary" />
                    ) : (
                      <XIcon className="size-4 text-destructive/60" />
                    )}
                  </div>
                )}
              </div>
              {fieldErrors.confirm && (
                <p id="reg-confirm-error" className="text-[11px] text-destructive animate-fade-in">
                  {fieldErrors.confirm}
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={loading}
              className={cn(
                'w-full h-11 text-sm font-semibold rounded-xl gap-2.5 transition-all duration-200 mt-2',
                loading && 'opacity-80',
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating account…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Create account
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
              <span className="bg-background px-3 text-xs text-muted-foreground">Already have an account?</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={onNavigateLogin}
            disabled={loading}
            className="w-full h-10 text-sm rounded-xl gap-2"
          >
            <ArrowLeft className="size-4" />
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
