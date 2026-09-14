/**
 * CatalystLoginPage — sign in and sign up, on the Organic theme.
 *
 * Sign-in is still Catalyst's own form, rendered as an iframe into
 * #login-container: credentials never touch our code, which is the point of
 * moving off the previous localStorage auth. The iframe's interior is styled
 * through public/catalyst-login.css (passed as `css_url`) so it reads as the
 * same pill-shaped form as the rest of this page — page CSS cannot cross the
 * iframe boundary.
 *
 * Sign-up is our own form, because the embedded widget renders a login form
 * only and has no signup path.
 *
 * Layout: one floating card on a sand ground, with the product pitch to its
 * left — the four Eisenhower quadrants as colour-coded pills, so the first
 * screen says what this thing is rather than decorating the space. Collapses
 * to a single column on small screens. Theme tokens live under
 * `.login-organic` in src/index.css; the accent is one trio of variables.
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
    <div className="login-organic relative min-h-svh overflow-hidden bg-[var(--o-surface)]">
      {/* Soft shapes — the system's decoration, never content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 -right-56 size-[720px] rounded-full"
        style={{ background: 'color-mix(in srgb, var(--o-accent) 16%, transparent)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-64 -left-36 size-[560px] rounded-full"
        style={{ background: 'color-mix(in srgb, #7a8a5e 22%, transparent)' }}
      />

      <div className="relative mx-auto flex min-h-svh w-full max-w-[1440px] flex-col gap-10 px-6 py-8 sm:px-10 lg:px-16 lg:py-11">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="flex size-10 items-center justify-center rounded-full"
              style={{ background: 'var(--o-accent)' }}
            >
              <Leaf className="size-5" strokeWidth={2.75} style={{ color: 'var(--o-bg)' }} />
            </span>
            <span className="o-display text-[22px]">Kaizen</span>
          </div>
          <span className="o-tag hidden sm:inline-flex">Secured by Zoho Catalyst</span>
        </header>

        <div className="grid flex-1 items-center gap-12 lg:grid-cols-[1fr_480px] lg:gap-20">
          <Pitch />

          <div className="o-card w-full max-w-[480px] justify-self-center p-8 sm:p-10">
            {mode === 'signin'
              ? <SignInPanel onSignUp={() => setMode('signup')} />
              : <SignUpPanel onBack={() => setMode('signin')} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pitch ─────────────────────────────────────────────────────────────────────

/** The four Eisenhower quadrants, in the app's own order. */
const QUADRANTS = [
  { label: 'Do first', ink: 'var(--o-q1)', bg: 'var(--o-q1-bg)' },
  { label: 'Schedule', ink: 'var(--o-q2)', bg: 'var(--o-q2-bg)' },
  { label: 'Delegate', ink: 'var(--o-q3)', bg: 'var(--o-q3-bg)' },
  { label: 'Eliminate', ink: 'var(--o-q4)', bg: 'var(--o-q4-bg)' },
];

function Pitch() {
  return (
    <section className="max-w-[620px]">
      <h1 className="o-display text-[clamp(38px,4.4vw,60px)]">
        Decide what matters
        <span className="block" style={{ color: 'var(--o-accent-700)' }}>before you start.</span>
      </h1>
      <p className="mt-6 max-w-[440px] text-[17px] leading-relaxed" style={{ color: 'var(--o-muted)' }}>
        Four quadrants, one list. Sign in and pick up where you left off.
      </p>

      <ul className="mt-10 flex list-none flex-wrap gap-3 p-0">
        {QUADRANTS.map((q) => (
          <li key={q.label} className="o-pill" style={{ background: q.bg, color: q.ink }}>
            <span />
            {q.label}
          </li>
        ))}
      </ul>
    </section>
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
      <header>
        <h2 className="o-display text-[32px]">Sign in</h2>
        <p className="mt-2.5 text-[15px]" style={{ color: 'var(--o-muted)' }}>
          Use the email your account was created with.
        </p>
      </header>

      {error && <InlineError message={error} className="mt-6" />}

      <div id={LOGIN_CONTAINER_ID} className="o-auth-well mt-7" />

      <p className="mt-6 text-center text-[15px]" style={{ color: 'var(--o-muted)' }}>
        No account yet?{' '}
        <button type="button" onClick={onSignUp} className="o-link">Create one</button>
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
        <span
          className="mb-6 flex size-16 items-center justify-center rounded-full"
          style={{ background: 'var(--o-sage-bg)' }}
        >
          <MailCheck className="size-7" strokeWidth={2.75} style={{ color: 'var(--o-sage-ink)' }} />
        </span>
        <h2 className="o-display text-[30px]">One link away</h2>
        <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--o-muted)' }}>
          A confirmation link is on its way to{' '}
          <span className="font-semibold" style={{ color: 'var(--o-text)' }}>{sentTo}</span>. The
          account can't sign in until that link is opened.
        </p>
        <button type="button" onClick={onBack} className="o-btn o-btn-secondary mt-7">
          Back to sign in
        </button>
      </section>
    );
  }

  return (
    <section>
      <button type="button" onClick={onBack} className="o-btn o-btn-ghost mb-3.5 -ml-3.5">
        <ArrowLeft className="size-4" strokeWidth={2.75} />
        Sign in
      </button>

      <header>
        <h2 className="o-display text-[30px]">Start your list</h2>
        <p className="mt-2 text-[15px]" style={{ color: 'var(--o-muted)' }}>
          Catalyst emails a link to confirm it's you.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="mt-6">
        {error && <InlineError message={error} className="mb-5" />}

        <div className="grid grid-cols-2 gap-3">
          <Field id="first-name" label="First name" value={firstName} onChange={setFirstName} autoComplete="given-name" />
          <Field id="last-name" label="Last name" value={lastName} onChange={setLastName} autoComplete="family-name" />
        </div>

        <div className="mt-4.5">
          <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        </div>

        <button type="submit" disabled={busy} className="o-btn o-btn-primary mt-7">
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
    <div>
      <label htmlFor={id} className="o-label">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="o-input"
      />
    </div>
  );
}

function InlineError({ message, className = '' }: { message: string; className?: string }) {
  return (
    <div role="alert" className={`o-alert ${className}`}>
      <AlertCircle className="mt-0.5 size-5 shrink-0" strokeWidth={2.75} />
      <span>{message}</span>
    </div>
  );
}
