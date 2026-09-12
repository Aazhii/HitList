import { useState } from 'react';
import { Leaf, ArrowLeft, Loader2, Eye, EyeOff, KeyRound, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { resetPassword, validatePassword, passwordStrength } from '@/lib/localAuth';
import type { LocalSession } from '@/lib/localAuth';

interface ResetPasswordProps {
  token: string;
  onNavigateLogin: (successMessage?: string) => void;
  onAuthenticated: (session: LocalSession) => void;
}

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLORS = ['', 'bg-destructive', 'bg-yellow-500', 'bg-blue-500', 'bg-primary'];

export function ResetPassword({ token, onNavigateLogin, onAuthenticated }: ResetPasswordProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [done, setDone] = useState(false);

  const strength = passwordStrength(password);

  function validate(): boolean {
    const errs: { password?: string; confirm?: string } = {};
    const pe = validatePassword(password);
    if (pe) errs.password = pe;
    if (!confirm) errs.confirm = 'Please confirm your password.';
    else if (password !== confirm) errs.confirm = 'Passwords do not match.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await resetPassword(token, password);
      if (result.ok === false) {
        setError(result.error);
      } else if (result.ok === true) {
        setDone(true);
        // Auto-sign-in after brief success animation
        setTimeout(() => {
          onAuthenticated(result.user);
        }, 1800);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-svh bg-background flex flex-col lg:flex-row">
      {/* Left branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] flex-shrink-0 bg-primary/5 border-r border-border p-10">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15">
            <Leaf className="size-5 text-primary" />
          </div>
          <span className="text-base font-bold tracking-tight text-foreground">Kaizen Flow</span>
        </div>
        <div className="space-y-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <KeyRound className="size-7 text-primary" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground leading-snug">
            Choose a strong<br />new password.
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Pick something memorable but hard to guess. At least 8 characters — mix letters, numbers, and symbols for best security.
          </p>
        </div>
        <p className="text-xs text-muted-foreground/60">Kaizen Flow · Your data, your device</p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-10">
        <div className="flex lg:hidden flex-col items-center gap-2 mb-10 animate-fade-in">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <Leaf className="size-6 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground">Kaizen Flow</span>
        </div>

        <div className="w-full max-w-sm animate-slide-up">
          {done ? (
            <div className="flex flex-col items-center gap-5 text-center animate-fade-in py-8">
              <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle2 className="size-8 text-primary" />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Password updated!</h1>
                <p className="text-sm text-muted-foreground">
                  You're being signed in automatically…
                </p>
              </div>
              <Loader2 className="size-5 text-muted-foreground animate-spin mt-2" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5 mb-8">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">New password</h1>
                <p className="text-sm text-muted-foreground">
                  Set a new password for your account
                </p>
              </div>

              {error && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 animate-fade-in">
                  <div className="flex size-5 items-center justify-center rounded-full bg-destructive/15 flex-shrink-0 mt-0.5">
                    <span className="text-destructive text-xs font-bold">!</span>
                  </div>
                  <p className="text-sm text-destructive leading-snug">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="rp-password" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    New password
                  </Label>
                  <div className="relative">
                    <Input
                      id="rp-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setFieldErrors((p) => ({ ...p, password: undefined })); }}
                      disabled={loading}
                      className={cn('h-11 rounded-xl text-sm pr-10', fieldErrors.password && 'border-destructive focus-visible:ring-destructive/30')}
                      autoFocus
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
                  {/* Strength bar */}
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
                        Strength: <span className="font-medium text-foreground">{STRENGTH_LABELS[strength] || 'Very weak'}</span>
                      </p>
                    </div>
                  )}
                  {fieldErrors.password && (
                    <p className="text-[11px] text-destructive animate-fade-in">{fieldErrors.password}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rp-confirm" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Confirm password
                  </Label>
                  <Input
                    id="rp-confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Repeat your password"
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); setFieldErrors((p) => ({ ...p, confirm: undefined })); }}
                    disabled={loading}
                    className={cn(
                      'h-11 rounded-xl text-sm',
                      fieldErrors.confirm && 'border-destructive focus-visible:ring-destructive/30',
                    )}
                  />
                  {fieldErrors.confirm && (
                    <p className="text-[11px] text-destructive animate-fade-in">{fieldErrors.confirm}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={loading || !password || !confirm}
                  className={cn('w-full h-11 text-sm font-semibold rounded-xl gap-2.5 transition-all duration-200 mt-2', loading && 'opacity-80')}
                >
                  {loading ? (
                    <><Loader2 className="size-4 animate-spin" />Updating…</>
                  ) : (
                    <><KeyRound className="size-4" />Set new password</>
                  )}
                </Button>
              </form>

              <div className="mt-6">
                <Button
                  type="button"
                  variant="ghost"
                   onClick={() => onNavigateLogin()}
                   className="w-full h-10 text-sm rounded-xl gap-2 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-4" />
                  Back to sign in
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
