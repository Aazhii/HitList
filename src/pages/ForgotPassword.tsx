import { useState } from 'react';
import { Leaf, ArrowLeft, Loader2, Mail, Copy, Check, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { requestPasswordReset, validateEmail } from '@/lib/localAuth';

interface ForgotPasswordProps {
  onNavigateLogin: () => void;
  onNavigateReset: (token: string) => void;
}

export function ForgotPassword({ onNavigateLogin, onNavigateReset }: ForgotPasswordProps) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ token: string; username: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function handleEmailChange(v: string) {
    setEmail(v);
    setEmailError(null);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateEmail(email.trim());
    if (err) { setEmailError(err); return; }
    setLoading(true);
    setError(null);
    // Simulate async
    setTimeout(() => {
      const res = requestPasswordReset(email.trim());
      setLoading(false);
      if (res.ok === false) {
        setError(res.error);
      } else if (res.ok === true) {
        setResult({ token: res.token, username: res.username });
      }
    }, 600);
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
            Forgot your<br />password?
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            No worries — enter your email and we'll generate a secure reset link for you instantly.
          </p>
          <div className="rounded-xl border border-border bg-background/60 p-4 space-y-2">
            <p className="text-xs font-semibold text-foreground">How it works</p>
            {[
              'Enter your registered email address',
              'Copy the reset token shown on screen',
              'Use it to set a new password',
            ].map((step, i) => (
              <div key={step} className="flex items-start gap-2.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-xs text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground/60">Kaizen Flow · Your data, your device</p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-10">
        {/* Mobile logo */}
        <div className="flex lg:hidden flex-col items-center gap-2 mb-10 animate-fade-in">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <Leaf className="size-6 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground">Kaizen Flow</span>
        </div>

        <div className="w-full max-w-sm animate-slide-up">
          <div className="space-y-1.5 mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Reset password</h1>
            <p className="text-sm text-muted-foreground">
              Enter your email to receive a reset token
            </p>
          </div>

          {!result ? (
            <>
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
                  <Label htmlFor="fp-email" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Email address
                  </Label>
                  <Input
                    id="fp-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    disabled={loading}
                    className={cn('h-11 rounded-xl text-sm', emailError && 'border-destructive focus-visible:ring-destructive/30')}
                    autoFocus
                  />
                  {emailError && (
                    <p className="text-[11px] text-destructive animate-fade-in">{emailError}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className={cn('w-full h-11 text-sm font-semibold rounded-xl gap-2.5 transition-all duration-200 mt-2', loading && 'opacity-80')}
                >
                  {loading ? (
                    <><Loader2 className="size-4 animate-spin" />Sending…</>
                  ) : (
                    <><Mail className="size-4" />Send reset token</>
                  )}
                </Button>
              </form>
            </>
          ) : (
            /* Success — show mock token */
            <div className="space-y-5 animate-fade-in">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15">
                    <Mail className="size-4 text-primary" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Reset token generated</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Hi <span className="font-medium text-foreground">{result.username}</span>! In a real app this would be emailed to you. For this local demo, copy the token below and use it to reset your password.
                </p>
                <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center gap-2">
                  <code className="flex-1 text-[11px] font-mono text-foreground break-all leading-relaxed">
                    {result.token}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex-shrink-0 flex size-7 items-center justify-center rounded-md hover:bg-muted transition-colors duration-150"
                    aria-label="Copy token"
                  >
                    {copied ? (
                      <Check className="size-3.5 text-primary" />
                    ) : (
                      <Copy className="size-3.5 text-muted-foreground" />
                    )}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  ⏱ This token expires in 15 minutes.
                </p>
              </div>

              <Button
                onClick={() => onNavigateReset(result.token)}
                className="w-full h-11 text-sm font-semibold rounded-xl gap-2"
              >
                <KeyRound className="size-4" />
                Continue to reset password
              </Button>
            </div>
          )}

          <div className="mt-6">
            <Button
              type="button"
              variant="ghost"
              onClick={onNavigateLogin}
              className="w-full h-10 text-sm rounded-xl gap-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back to sign in
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
