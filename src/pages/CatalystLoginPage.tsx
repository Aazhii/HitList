/**
 * CatalystLoginPage — sign in and sign up, backed by Catalyst.
 *
 * Sign-in is Catalyst's own form, rendered as an iframe into #login-container.
 * We deliberately do not build a password form: the credentials never touch our
 * code, which is the main reason for moving off the previous localStorage auth.
 *
 * Sign-up is our own form, because the embedded widget has no signup path —
 * catalyst.auth.signIn() renders a login iframe only.
 */
import { useEffect, useRef, useState } from 'react';
import { Leaf, Loader2, MailCheck, AlertCircle } from 'lucide-react';
import { renderLoginForm, signUp, describeAuthError } from '@/lib/catalystAuth';

/** The element Catalyst injects its iframe into. Must have a real height. */
const LOGIN_CONTAINER_ID = 'login-container';

type Mode = 'signin' | 'signup';

export function CatalystLoginPage() {
  const [mode, setMode] = useState<Mode>('signin');

  return (
    <div className="min-h-svh bg-background flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <header className="flex flex-col items-center gap-3 mb-8">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <Leaf className="size-6 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">Kaizen</h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'signin' ? 'Sign in to your tasks' : 'Create an account'}
            </p>
          </div>
        </header>

        {mode === 'signin' ? <SignInPanel /> : <SignUpPanel onDone={() => setMode('signin')} />}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === 'signin' ? (
            <>
              No account?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('signin')}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// ── Sign in ───────────────────────────────────────────────────────────────────

function SignInPanel() {
  const [error, setError] = useState<string | null>(null);
  // The SDK mutates the DOM directly, so React must not re-render over it.
  const rendered = useRef(false);

  useEffect(() => {
    if (rendered.current) return;
    rendered.current = true;
    try {
      renderLoginForm(LOGIN_CONTAINER_ID, `${window.location.origin}/`);
    } catch (e) {
      setError(describeAuthError(e));
    }
  }, []);

  return (
    <div className="rounded-2xl border bg-card p-1 shadow-sm">
      {error && <InlineError message={error} />}
      {/*
        Catalyst renders its iframe here. The explicit min-height matters: the
        iframe has no intrinsic size, so without it the container collapses and
        the form is invisible with nothing logged.
      */}
      <div id={LOGIN_CONTAINER_ID} style={{ minHeight: 420 }} />
    </div>
  );
}

// ── Sign up ───────────────────────────────────────────────────────────────────

function SignUpPanel({ onDone }: { onDone: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!firstName.trim()) { setError('First name is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address.'); return; }

    setBusy(true);
    const res = await signUp({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() });
    setBusy(false);

    if (res.ok) setSent(true);
    else setError(res.error ?? 'Sign up failed.');
  }

  if (sent) {
    return (
      <div className="rounded-2xl border bg-card p-6 shadow-sm text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary/10">
          <MailCheck className="size-5 text-primary" />
        </div>
        <h2 className="font-medium">Check your email</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>.
          You need to confirm before you can sign in.
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-5 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
      {error && <InlineError message={error} />}

      <div className="grid grid-cols-2 gap-3">
        <Field id="first-name" label="First name" value={firstName} onChange={setFirstName} autoComplete="given-name" required />
        <Field id="last-name" label="Last name" value={lastName} onChange={setLastName} autoComplete="family-name" />
      </div>

      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? 'Creating account…' : 'Create account'}
      </button>

      <p className="text-xs text-muted-foreground text-center">
        Catalyst will email you a link to confirm the account.
      </p>
    </form>
  );
}

// ── Small shared pieces ───────────────────────────────────────────────────────

function Field({
  id, label, value, onChange, type = 'text', autoComplete, required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}
