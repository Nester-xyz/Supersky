import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger-outline';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  outline: 'btn-outline',
  ghost: 'btn-ghost',
  'danger-outline': 'btn-danger-outline',
};

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      type={type}
      className={cx('btn', BUTTON_VARIANTS[variant], loading && 'relative', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={16} />
        </span>
      )}
      {/* Kept mounted (just hidden) while loading so the button width doesn't jump. */}
      <span className={cx('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
    </button>
  );
}

export function IconButton({
  title,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={cx('icon-btn', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full outline-none transition-colors duration-150 focus-visible:shadow-[0_0_0_2px_var(--ss-canvas),0_0_0_4px_var(--ss-accent)]"
      style={
        checked
          ? { backgroundColor: 'var(--ss-primary)' }
          : { background: 'var(--ss-line-strong)' }
      }
    >
      <span
        className={cx(
          'absolute top-[3px] left-0 size-4 rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cx('animate-spin', className)}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
      {error && <span className="mt-1.5 block text-xs text-danger">{error}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------

const AVATAR_HUES = [230, 190, 260, 330, 160, 20];

export function Avatar({
  src,
  name,
  size = 36,
  fallback = 'skeleton',
}: {
  src?: string;
  name: string;
  size?: number;
  /**
   * What to render while there is no image URL: `skeleton` (default) treats a
   * missing src as still-loading account data and shimmers; `initial` renders
   * the letter tile; use it where "no avatar" is a real final state (e.g.
   * mention suggestions).
   */
  fallback?: 'skeleton' | 'initial';
}) {
  // `key` remounts (resetting the load state) whenever the source changes, e.g.
  // when switching accounts.
  if (src) return <AvatarImage key={src} src={src} name={name} size={size} />;
  if (fallback === 'skeleton') {
    return (
      <span
        aria-hidden="true"
        className="block shrink-0 rounded-full shimmer"
        style={{ width: size, height: size }}
      />
    );
  }
  return <AvatarFallback name={name} size={size} />;
}

/**
 * A remote avatar that shows a shimmer skeleton while the image loads, fades the
 * image in once ready, and falls back to the initial-on-gradient tile on error.
 */
function AvatarImage({ src, name, size }: { src: string; name: string; size: number }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  if (status === 'error') return <AvatarFallback name={name} size={size} />;

  return (
    <span
      className="relative block shrink-0 overflow-hidden rounded-full bg-surface-2"
      style={{ width: size, height: size }}
    >
      {status === 'loading' && <span className="absolute inset-0 shimmer" aria-hidden="true" />}
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        // Cached images can already be complete before onLoad attaches.
        ref={(node) => {
          if (node?.complete && node.naturalWidth > 0) setStatus('loaded');
        }}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        className={cx(
          'h-full w-full rounded-full object-cover transition-opacity duration-200',
          status === 'loaded' ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  );
}

function AvatarFallback({ name, size }: { name: string; size: number }) {
  const hue = AVATAR_HUES[(name.codePointAt(0) ?? 0) % AVATAR_HUES.length] ?? 230;
  return (
    <div
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${hue + 40} 75% 45%))`,
      }}
    >
      {(name[0] ?? '?').toUpperCase()}
    </div>
  );
}
