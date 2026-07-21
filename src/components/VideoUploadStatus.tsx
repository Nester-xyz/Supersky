import { AlertCircleIcon } from './icons';
import { Spinner } from './ui';
import type { ComposerVideoPayload } from '@/lib/types';

/**
 * Lifecycle of the video pipeline (upload starts the moment a video becomes
 * the active attachment). Shared by the popup composer and the cross-post
 * card on x.com.
 */
export type VideoJob =
  | { phase: 'auth'; pct: null }
  | { phase: 'uploading'; pct: number }
  | { phase: 'processing'; pct: number | null }
  | { phase: 'ready'; pct: 100; payload: ComposerVideoPayload }
  | { phase: 'error'; pct: null; error: string };

/**
 * The video's upload/processing status as a compact pill, with an inline
 * progress bar while bytes move. Renders nothing once the job is ready: the
 * enabled Post button is the signal.
 */
export function VideoUploadPill({ job, onRetry }: { job: VideoJob; onRetry: () => void }) {
  if (job.phase === 'ready') return null;
  if (job.phase === 'error') {
    return (
      <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-danger-soft pr-1 pl-2.5 text-xs font-medium text-danger">
        <AlertCircleIcon size={13} className="shrink-0" />
        Upload failed
        <button
          type="button"
          onClick={onRetry}
          className="flex h-5 cursor-pointer items-center rounded-full bg-danger px-2 text-[11px] font-semibold text-white transition-[filter] hover:brightness-110"
        >
          Retry
        </button>
      </span>
    );
  }
  const label =
    job.phase === 'auth' ? 'Preparing' : job.phase === 'uploading' ? 'Uploading video' : 'Processing';
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-2 rounded-full border border-line bg-surface pr-2.5 pl-2.5 text-xs font-medium text-ink">
      <Spinner size={12} className="text-accent" />
      <span>{label}</span>
      {typeof job.pct === 'number' && (
        <>
          <span className="block h-1 w-10 overflow-hidden rounded-full bg-surface-3">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${job.pct}%` }}
            />
          </span>
          <span className="text-ink-muted tabular-nums">{job.pct}%</span>
        </>
      )}
    </span>
  );
}
