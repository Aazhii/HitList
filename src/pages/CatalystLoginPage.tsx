/**
 * CatalystLoginPage — sign in and sign up.
 *
 * Sign-in is Catalyst's own form, rendered as an iframe into #login-container.
 * We deliberately do not build a password field: credentials never touch our
 * code, which is the point of moving off the previous localStorage auth. The
 * iframe's interior is styled through public/catalyst-login.css, passed as
 * `css_url` — it is served from Catalyst's domain, so page CSS cannot reach it.
 *
 * Sign-up is our own form, because the embedded widget renders a login form
 * only and has no signup path.
 *
 * Layout: a two-panel split on desktop — the product on the left, the task on
 * the right — collapsing to a single column on small screens. The left panel
 * shows the Eisenhower matrix the app is built around, so the first screen
 * says what this thing is rather than decorating the space.
 */
import { useEffect, useRef, useState } from 'react';
import { Leaf, Loader2, MailCheck, AlertCircle, ArrowLeft } from 'lucide-react';
import { renderLoginForm, signUp, describeAuthError } from '@/lib/catalystAuth';

/** The element Catalyst injects its iframe into. */
const LOGIN_CONTAINER_ID = 'login-container';

type Mode = 'signin' | 'signup';

export function CatalystLoginPage() {
  const [mode, setMode] = useState<Mode>('signin');

  return (
    <div className="min-h-svh bg-background text-foreground lg:grid lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      <main className="flex min-h-svh flex-col justify-center px-6 py-12 sm:px-10 lg:min-h-0 lg:px-14">
        <div className="mx-auto w-full max-w-[380px]">
          {/* Compact wordmark for small screens, where the brand panel is hidden. */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10">
              <Leaf className="size-4 text-primary" />
            </span>
            <span className="font-semibold tracking-tight">Kaizen</span>
          </div>

          {mode === 'signin'
            ? <SignInPanel onSignUp={() => setMode('signup')} />
            : <SignUpPanel onBack={() => setMode('signin')} />}
        </div>
      </main>
    </div>
  );
}

// ── Brand panel ───────────────────────────────────────────────────────────────

/** The four Eisenhower quadrants, in the app's own order and colouring. */
const QUADRANTS = [
  { label: 'Do first', hint: 'Urgent · Important', tone: 'text-rose-600 dark:text-rose-400' },
  { label: 'Schedule', hint: 'Important', tone: 'text-sky-600 dark:text-sky-400' },
  { label: 'Delegate', hint: 'Urgent', tone: 'text-amber-600 dark:text-amber-400' },
  { label: 'Eliminate', hint: 'Neither', tone: 'text-muted-foreground' },
];

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden border-r bg-muted/30 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
          <Leaf className="size-4.5 text-primary" />
        </span>
        <span className="font-semibold tracking-tight">Kaizen</span>
      </div>

      <div className="max-w-sm">
        <h2 className="text-[2rem] font-semibold leading-[1.15] tracking-tight">
          Decide what matters
          <span className="block text-muted-foreground">before you start.</span>
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Kaizen sorts everything you have to do into four quadrants, so the
          next thing to work on is never a judgement call.
        </p>

        <div className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border">
          {QUADRANTS.map((q) => (
            <div key={q.label} className="bg-background p-4">
              <p className={`text-sm font-medium ${q.tone}`}>{q.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{q.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Secured by Zoho Catalyst
      </p>
    </aside>
  );
}

// ── Sign in ───────────────────────────────────────────────────────────────────

function SignInPanel({ onSignUp }: { onSignUp: () => void }) {
  const [error, setError] = useState<string | null>(null);
  // The SDK writes into this node directly, so it must be rendered once and
  // then left alone — React re-rendering over it would destroy the iframe.
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
    <section>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Use the email address your account was created with.
        </p>
      </header>

      {error && <InlineError message={error} className="mb-4" />}

      {/*
        Catalyst renders its iframe here. The min-height is required: the iframe
        has no intrinsic size, so the container would otherwise collapse and the
        form would be invisible with nothing logged. Kept close to the form's
        real height so it does not leave a large empty well underneath.
      */}
      <div
        id={LOGIN_CONTAINER_ID}
        className="[&_iframe]:w-full [&_iframe]:border-0"
        style={{ minHeight: 220 }}
      />

      <p className="mt-7 border-t pt-5 text-sm text-muted-foreground">
        No account yet?{' '}
        <button
          type="button"
          onClick={onSignUp}
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          Create one
        </button>
      </p>
    </section>
  );
}

// ── Sign up ───────────────────────────────────────────────────────────────────

function SignUpPanel({ onBack }: { onBack: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const first = firstName.trim();
    const address = email.trim();
    if (!first) { setError('First name is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError('Enter a valid email address.'); return; }

    setBusy(true);
    const res = await signUp({ firstName: first, lastName: lastName.trim(), email: address });
    setBusy(false);

    if (res.ok) setSentTo(address);
    else setError(res.error ?? 'Sign up failed.');
  }

  if (sentTo) {
    return (
      <section>
        <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-primary/10">
          <MailCheck className="size-5 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          A confirmation link is on its way to{' '}
          <span className="font-medium text-foreground">{sentTo}</span>. The
          account cannot sign in until that link is opened.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to sign in
        </button>
      </section>
    );
  }

  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        <ArrowLeft className="size-3.5" />
        Sign in
      </button>

      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Catalyst emails a link to confirm it's you.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && <InlineError message={error} />}

        <div className="grid grid-cols-2 gap-3">
          <Field id="first-name" label="First name" value={firstName} onChange={setFirstName} autoComplete="given-name" />
          <Field id="last-name" label="Last name" value={lastName} onChange={setLastName} autoComplete="family-name" />
        </div>

        <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />

        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </section>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function Field({
  id, label, value, onChange, type = 'text', autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </div>
  );
}

function InlineError({ message, className = '' }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={`flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive ${className}`}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}
