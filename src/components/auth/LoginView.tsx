import { useEffect, useState, type FormEvent } from 'react';
import { ERROR_CODES, toErrorMessage } from '@/lib/errors';
import { normalizeIdentifier } from '@/lib/identifier';
import { MessagingError, sendMessage } from '@/lib/messaging';
import { DEFAULT_SERVICE, loadSettings, saveSettings } from '@/lib/settings';
import type { AccountSnapshot } from '@/lib/types';
import { Button, Field, cx } from '../ui';
import {
  AlertCircleIcon,
  AtSignIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  LockIcon,
} from '../icons';

export function LoginView({
  onSignedIn,
}: {
  onSignedIn?: (account: AccountSnapshot) => void;
}) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [service, setService] = useState(DEFAULT_SERVICE);
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [needsToken, setNeedsToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then((settings) => setService(settings.service));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!identifier.trim() || !password.trim()) {
      setError('Enter your handle and app password first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const cleanService = service.trim() || DEFAULT_SERVICE;
    try {
      const account = await sendMessage('auth:login', {
        identifier: normalizeIdentifier(identifier),
        password: password.trim(),
        authFactorToken: needsToken ? token.trim() || undefined : undefined,
        service: cleanService,
      });
      void saveSettings({ service: cleanService });
      onSignedIn?.(account);
    } catch (err) {
      if (err instanceof MessagingError && err.code === ERROR_CODES.authFactorRequired) {
        setNeedsToken(true);
        setError(token.trim() ? 'That code didn’t work. Check your email for a fresh one.' : null);
      } else {
        setError(toErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] leading-snug text-danger">
          <AlertCircleIcon size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {needsToken && (
        <>
          <div className="flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px] leading-snug text-ink">
            <InfoIcon size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>Bluesky emailed you a sign-in code. Enter it below to continue.</span>
          </div>
          <Field label="Confirmation code">
            <input
              className="input tracking-widest"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="XXXXX-XXXXX"
              autoFocus
              autoComplete="one-time-code"
              spellCheck={false}
            />
          </Field>
        </>
      )}

      <Field label="Handle">
        <div className="relative">
          <AtSignIcon
            size={16}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-faint"
          />
          <input
            className="input pl-10"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="yourname.bsky.social"
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="off"
          />
        </div>
      </Field>

      <Field
        label="App password"
        hint={
          <>
            Use an app password, never your main one.{' '}
            <a
              href="https://bsky.app/settings/app-passwords"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent hover:underline"
            >
              Create one ↗
            </a>
          </>
        }
      >
        <div className="relative">
          <LockIcon
            size={16}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-faint"
          />
          <input
            className="input pr-10 pl-10"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            autoComplete="current-password"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            title={showPassword ? 'Hide password' : 'Show password'}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-ink-faint transition-colors hover:text-ink"
          >
            {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </button>
        </div>
      </Field>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex cursor-pointer items-center gap-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ChevronDownIcon
            size={13}
            className={cx('transition-transform duration-150', showAdvanced && 'rotate-180')}
          />
          Advanced
        </button>
        {showAdvanced && (
          <div className="mt-2.5 animate-fade-in">
            <Field
              label="Service (PDS) URL"
              hint="Your personal data server. Leave as bsky.social unless you self-host."
            >
              <input
                className="input"
                value={service}
                onChange={(e) => setService(e.target.value)}
                placeholder={DEFAULT_SERVICE}
                spellCheck={false}
                autoCapitalize="off"
              />
            </Field>
          </div>
        )}
      </div>

      <Button type="submit" className="h-11 w-full text-[15px]" loading={submitting}>
        {needsToken ? 'Verify & sign in' : 'Sign in'}
      </Button>

      <p className="text-center text-xs text-ink-faint">
        New to Bluesky?{' '}
        <a
          href="https://bsky.app"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-accent hover:underline"
        >
          Create an account ↗
        </a>
      </p>
    </form>
  );
}
