import type { ButtonHTMLAttributes, ReactNode } from 'react';

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
      className={cx('btn', BUTTON_VARIANTS[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      {children}
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

export function Avatar({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full bg-surface-2 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
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
