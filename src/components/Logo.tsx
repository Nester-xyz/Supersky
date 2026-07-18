import { useId } from 'react';
import { cx } from './ui';

/**
 * The Supersky mark: a single sparkle in the night sky. Deliberately minimal:
 * one clean four-point star on a deep gradient tile. Kept in sync with
 * brand/logo.svg (the source for the PNG toolbar icons).
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const uid = useId();
  const bg = `bg-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#242b66" />
          <stop offset="1" stopColor="#0c1030" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="30" fill={`url(#${bg})`} />
      <path
        d="M64 24 C 67.3 46 82 60.7 104 64 C 82 67.3 67.3 82 64 104 C 60.7 82 46 67.3 24 64 C 46 60.7 60.7 46 64 24 Z"
        fill="#ffffff"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('text-[15px] font-semibold tracking-tight text-ink', className)}>
      Super
      <span className="text-gradient">sky</span>
    </span>
  );
}
