import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircleIcon, CheckIcon, PencilIcon, VideoIcon, XIcon } from '@/components/icons';
import { LogoMark } from '@/components/Logo';
import { CharRing, IconButton, Spinner, cx } from '@/components/ui';
import { VideoUploadPill, type VideoJob } from '@/components/VideoUploadStatus';
import { toErrorMessage } from '@/lib/errors';
import { prepareImage, releaseImage, type PreparedImage } from '@/lib/images';
import { sendMessage } from '@/lib/messaging';
import { loadSettings, watchSettings, type Settings } from '@/lib/settings';
import { MAX_GRAPHEMES, graphemeLength, truncateToGraphemes } from '@/lib/text';
import { resolveTheme } from '@/lib/theme';
import {
  pollVideoJob,
  prepareVideo,
  releaseVideo,
  uploadVideoFile,
  type PreparedVideo,
} from '@/lib/video';
import { watchForMainTweets, type CapturedTweet } from '@/lib/xdetect';
import type { AccountSnapshot, ComposerImagePayload } from '@/lib/types';

/** How long the collapsed toast lingers before withdrawing on its own. */
const TOAST_LIFETIME_MS = 12_000;

interface Offer {
  id: string;
  tweet: CapturedTweet;
  account: AccountSnapshot;
}

/**
 * Bottom-right suggester: a toast right after a main post goes out on X,
 * expanding into a lite Bluesky composer (text, images, and video). Publishing
 * reuses the extension's normal background pipeline; videos upload straight to
 * Bluesky's video service from here (its CORS is open) with a token minted by
 * the background.
 */
export function CrossPostApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [offer, setOffer] = useState<Offer | null>(null);
  /** toast = preview; edit = mini composer; auto = composer that posts itself. */
  const [mode, setMode] = useState<'toast' | 'edit' | 'auto'>('toast');

  useEffect(() => {
    let mounted = true;
    void loadSettings().then((value) => mounted && setSettings(value));
    const unwatch = watchSettings((value) => {
      setSettings(value);
      if (!value.suggestCrossPost) {
        setOffer(null);
        setMode('toast');
      }
    });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => setSystemDark(media.matches);
    media.addEventListener('change', onScheme);
    return () => {
      mounted = false;
      unwatch();
      media.removeEventListener('change', onScheme);
    };
  }, []);

  // Detection runs for the page's lifetime; each confirmed main post becomes
  // an offer, provided the feature is on and an account is signed in.
  useEffect(() => {
    return watchForMainTweets((tweet) => {
      void (async () => {
        const current = await loadSettings();
        if (!current.suggestCrossPost) return;
        const auth = await sendMessage('auth:get-state', undefined).catch(() => null);
        if (!auth || auth.status !== 'signed-in') return;
        setOffer({ id: crypto.randomUUID(), tweet, account: auth.account });
        setMode('toast');
      })();
    });
  }, []);

  // The collapsed toast withdraws by itself; the expanded card stays put.
  useEffect(() => {
    if (!offer || mode !== 'toast') return;
    const timer = setTimeout(() => setOffer(null), TOAST_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [offer, mode]);

  if (!offer || !settings) return null;

  const resolved = resolveTheme(settings.theme, systemDark);

  function dismiss() {
    setOffer(null);
    setMode('toast');
  }

  return (
    <div
      className={cx('font-sans', resolved !== 'light' && 'dark', resolved === 'slate' && 'slate')}
      data-accent={settings.accent}
    >
      <div className="fixed right-4 bottom-4 z-[2147483647] text-ink">
        {mode !== 'toast' ? (
          <CrossPostCard
            key={offer.id}
            offer={offer}
            defaultLang={settings.defaultLang}
            autoPost={mode === 'auto'}
            onClose={dismiss}
          />
        ) : (
          <Toast
            offer={offer}
            onPost={() => {
              // One-click only when the preview can post as-is; anything that
              // needs work (over the limit, video to upload) opens the editor.
              const needsEditor =
                graphemeLength(offer.tweet.text) > MAX_GRAPHEMES || Boolean(offer.tweet.video);
              setMode(needsEditor ? 'edit' : 'auto');
            }}
            onEdit={() => setMode('edit')}
            onDismiss={dismiss}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The suggestion, framed as a preview of the Bluesky post being approved:
 * account header, the post's text and media, and one confirm button.
 */
function Toast({
  offer,
  onPost,
  onEdit,
  onDismiss,
}: {
  offer: Offer;
  onPost: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  // Thumbnails come straight from the captured bytes.
  const thumbs = useMemo(
    () => offer.tweet.images.slice(0, 4).map((blob) => URL.createObjectURL(blob)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offer.id],
  );
  useEffect(() => {
    return () => thumbs.forEach((url) => URL.revokeObjectURL(url));
  }, [thumbs]);

  const text = offer.tweet.text
    ? truncateToGraphemes(offer.tweet.text.replace(/\s+/g, ' '), 160)
    : '';

  return (
    <div className="card animate-slide-up w-[372px] overflow-hidden rounded-[10px] shadow-[var(--ss-shadow-pop)]">
      <div className="flex items-center gap-2 border-b border-line py-2.5 pr-2 pl-3.5">
        <LogoMark size={22} className="shrink-0" />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
          Post this on Bluesky too?
        </p>
        <button
          type="button"
          title="Edit in the composer"
          aria-label="Edit in the composer"
          onClick={onEdit}
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <PencilIcon size={15} />
        </button>
        <button
          type="button"
          title="Dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <XIcon size={16} />
        </button>
      </div>

      <div className="flex gap-2.5 px-3.5 py-3">
        {offer.account.avatar ? (
          <img
            src={offer.account.avatar}
            alt=""
            className="size-8 shrink-0 rounded-full border border-line object-cover"
          />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-semibold text-white">
            {(offer.account.handle[0] ?? '?').toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-ink">
              @{offer.account.handle}
            </span>
            <span className="shrink-0 rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
              preview
            </span>
          </div>
          {text && (
            <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-ink-muted">{text}</p>
          )}
          {(thumbs.length > 0 || offer.tweet.video) && (
            <div className="mt-2 flex gap-1.5">
              {thumbs.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="size-11 rounded-md border border-line object-cover"
                />
              ))}
              {offer.tweet.video && (
                <span
                  title="Video (uploads when you continue)"
                  className="grid size-11 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-ink-faint"
                >
                  <VideoIcon size={15} />
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-3.5 pb-3.5">
        <button
          type="button"
          className="btn btn-primary h-9 w-full rounded-lg text-[13px]"
          onClick={onPost}
        >
          Post to Bluesky
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Phase = 'edit' | 'posting' | 'done';
type MediaChoice = 'photos' | 'video';

function CrossPostCard({
  offer,
  defaultLang,
  autoPost,
  onClose,
}: {
  offer: Offer;
  defaultLang: string;
  /** Confirmed from the preview toast: publish as soon as media is ready. */
  autoPost?: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState(offer.tweet.text);
  const [images, setImages] = useState<PreparedImage[] | null>(
    offer.tweet.images.length > 0 ? null : [],
  );
  const [phase, setPhase] = useState<Phase>('edit');
  const [error, setError] = useState('');
  const [doneUrl, setDoneUrl] = useState<string | undefined>(undefined);
  const imagesRef = useRef<PreparedImage[] | null>(images);
  imagesRef.current = images;

  // Bluesky requires a confirmed email for video uploads.
  const videoAllowed = offer.account.emailConfirmed !== false;
  const hasVideo = Boolean(offer.tweet.video) && videoAllowed;
  const hasPhotos = offer.tweet.images.length > 0;
  // Bluesky posts carry one media kind; with both captured, the user picks.
  const [mediaChoice, setMediaChoice] = useState<MediaChoice>(hasPhotos ? 'photos' : 'video');
  const photosActive = hasPhotos && (!hasVideo || mediaChoice === 'photos');
  const videoActive = hasVideo && (!hasPhotos || mediaChoice === 'video');

  const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoAttempt, setVideoAttempt] = useState(0);
  const preparedVideoRef = useRef<PreparedVideo | null>(null);

  // Compress the captured photos to Bluesky's limits in the background.
  useEffect(() => {
    let mounted = true;
    if (offer.tweet.images.length === 0) return;
    void (async () => {
      const prepared: PreparedImage[] = [];
      for (const blob of offer.tweet.images) {
        try {
          prepared.push(await prepareImage(blob));
        } catch {
          // An unconvertible image is dropped; the rest still cross-post.
        }
      }
      if (mounted) setImages(prepared);
      else prepared.forEach(releaseImage);
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.id]);

  // The video pipeline: validate + probe, mint an upload token via the
  // background, upload straight to video.bsky.app, poll until processed.
  // Runs while the video is the active attachment; switching away aborts.
  useEffect(() => {
    const source = offer.tweet.video;
    if (!videoActive || !source) {
      setVideoJob(null);
      return;
    }
    const controller = new AbortController();
    setVideoJob({ phase: 'auth', pct: null });
    void (async () => {
      try {
        const file = new File([source], 'x-video', { type: source.type || 'video/mp4' });
        const prepared = await prepareVideo(file);
        if (controller.signal.aborted) {
          releaseVideo(prepared);
          return;
        }
        preparedVideoRef.current = prepared;
        setVideoPreviewUrl(prepared.previewUrl);

        const { token } = await sendMessage('video:auth', { did: offer.account.did });
        if (controller.signal.aborted) return;
        setVideoJob({ phase: 'uploading', pct: 0 });
        const status = await uploadVideoFile({
          video: prepared,
          did: offer.account.did,
          token,
          signal: controller.signal,
          onProgress: (fraction) =>
            setVideoJob({ phase: 'uploading', pct: Math.min(100, Math.round(fraction * 100)) }),
        });
        let blob: unknown =
          status.state === 'JOB_STATE_COMPLETED' && status.blob ? status.blob : null;
        if (!blob) {
          setVideoJob({ phase: 'processing', pct: null });
          blob = await pollVideoJob({
            jobId: status.jobId as string,
            signal: controller.signal,
            onProgress: (progress) => setVideoJob({ phase: 'processing', pct: progress }),
          });
        }
        if (controller.signal.aborted) return;
        setVideoJob({
          phase: 'ready',
          pct: 100,
          payload: {
            blob,
            alt: '',
            width: prepared.width,
            height: prepared.height,
            did: offer.account.did,
          },
        });
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setVideoJob({ phase: 'error', pct: null, error: toErrorMessage(err) });
      }
    })();
    return () => {
      controller.abort();
      const prepared = preparedVideoRef.current;
      if (prepared) {
        releaseVideo(prepared);
        preparedVideoRef.current = null;
      }
      setVideoPreviewUrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.id, videoActive, videoAttempt]);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [phase, onClose]);


  const graphemes = useMemo(() => graphemeLength(text), [text]);
  const remaining = MAX_GRAPHEMES - graphemes;
  const imagesReady = !photosActive || images !== null;
  const videoBlocking = videoActive && videoJob?.phase !== 'ready';
  const readyVideoPayload = videoActive && videoJob?.phase === 'ready' ? videoJob.payload : null;
  const hasContent =
    text.trim().length > 0 ||
    (photosActive && (images?.length ?? 0) > 0) ||
    Boolean(readyVideoPayload);
  const canPost = phase === 'edit' && remaining >= 0 && imagesReady && hasContent && !videoBlocking;

  // A confirmed preview posts itself the moment everything is ready; one
  // attempt only, so a failure lands in the editor instead of retry-looping.
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (!autoPost || autoTriedRef.current || phase !== 'edit' || !canPost) return;
    autoTriedRef.current = true;
    void post();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPost, phase, canPost]);

  function imagePayloads(): ComposerImagePayload[] {
    if (!photosActive) return [];
    return (imagesRef.current ?? []).map(({ base64, mime, alt, width, height }) => ({
      base64,
      mime,
      alt,
      width,
      height,
    }));
  }

  async function post() {
    if (!canPost) return;
    setPhase('posting');
    setError('');
    try {
      const results = await sendMessage('post:publish', {
        text,
        langs: defaultLang ? [defaultLang] : undefined,
        images: imagePayloads(),
        video: readyVideoPayload,
        gif: null,
        card: null,
        interaction: null,
        dids: [offer.account.did],
      });
      setDoneUrl(results[0]?.webUrl);
      setPhase('done');
    } catch (err) {
      setError(toErrorMessage(err));
      setPhase('edit');
    }
  }

  function openFullComposer() {
    void sendMessage('composer:open', {
      kind: 'crosspost',
      text,
      images: imagePayloads(),
    }).catch(() => undefined);
    onClose();
  }

  if (phase === 'done') {
    return (
      <div className="card animate-slide-up flex w-[356px] items-center gap-3 rounded-[10px] p-4 shadow-[var(--ss-shadow-pop)]">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
          <CheckIcon size={16} strokeWidth={2.5} />
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium text-ink">Posted to Bluesky!</p>
        {doneUrl && (
          <a
            href={doneUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center rounded-lg bg-surface-2 px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-3"
          >
            View
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="card animate-slide-up w-[400px] rounded-[10px] shadow-[var(--ss-shadow-pop)]">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <LogoMark size={22} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-semibold text-ink">Post to Bluesky</p>
          <p className="truncate text-[11px] leading-tight text-ink-faint">
            as @{offer.account.handle}
          </p>
        </div>
        <IconButton title="Close" onClick={onClose} className="size-7">
          <XIcon size={14} />
        </IconButton>
      </div>

      <div className="px-4 pt-3">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          autoFocus
          placeholder="What's up?"
          className="min-h-[110px] w-full resize-none rounded-lg border border-line bg-surface-2/40 p-3 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
        />

        {hasPhotos && hasVideo && (
          <div className="mt-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-ink-faint">Include</span>
              <MediaChoiceChip
                label={`Photos (${offer.tweet.images.length})`}
                active={mediaChoice === 'photos'}
                onClick={() => setMediaChoice('photos')}
              />
              <MediaChoiceChip
                label="Video"
                active={mediaChoice === 'video'}
                onClick={() => setMediaChoice('video')}
              />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink-faint">
              Bluesky posts can have photos or a video, not both.
            </p>
          </div>
        )}

        {photosActive && images === null && (
          <div className="mt-2.5 flex gap-1.5">
            {offer.tweet.images.map((_, index) => (
              <div key={index} className="shimmer size-16 rounded-md" />
            ))}
          </div>
        )}
        {photosActive && images !== null && images.length > 0 && (
          <div className="mt-2.5 flex gap-1.5">
            {images.map((image) => (
              <div
                key={image.id}
                className="group relative size-16 shrink-0 overflow-hidden rounded-md border border-line bg-surface-2"
              >
                <img src={image.previewUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  title="Remove image"
                  onClick={() =>
                    setImages((prev) => (prev ?? []).filter((item) => item.id !== image.id))
                  }
                  className="absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-md bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <XIcon size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {videoActive && (
          <div className="mt-2.5">
            {videoPreviewUrl ? (
              <video
                src={videoPreviewUrl}
                autoPlay
                loop
                muted
                playsInline
                className="max-h-44 w-full rounded-md border border-line bg-black object-contain"
              />
            ) : (
              <div className="shimmer h-28 w-full rounded-md" />
            )}
            {videoJob && videoJob.phase !== 'ready' && (
              <div className="mt-2 flex justify-end">
                <VideoUploadPill
                  job={videoJob}
                  onRetry={() => setVideoAttempt((attempt) => attempt + 1)}
                />
              </div>
            )}
            {videoJob?.phase === 'error' && (
              <p className="mt-1.5 text-right text-[11px] leading-snug text-danger">
                {videoJob.error}
              </p>
            )}
          </div>
        )}

        {offer.tweet.video && !videoAllowed && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] leading-snug text-ink-faint">
            <VideoIcon size={12} className="shrink-0" /> Confirm your email on Bluesky to include
            videos; this posts without it.
          </p>
        )}
        {offer.tweet.unportableVideo && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] leading-snug text-ink-faint">
            <VideoIcon size={12} className="shrink-0" /> This video/GIF can’t be carried over.
          </p>
        )}

        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-danger">
            <AlertCircleIcon size={13} className="mt-px shrink-0" />
            {error}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={openFullComposer}
          title={
            videoActive
              ? 'Continue in the Supersky composer (the video stays here)'
              : 'Continue in the Supersky composer (drafts, GIFs, interaction settings)'
          }
          className="h-8 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          Full composer
        </button>
        <div className="flex-1" />
        {remaining < 0 && (
          <button
            type="button"
            onClick={() => setText(truncateToGraphemes(text, MAX_GRAPHEMES))}
            className="h-7 shrink-0 cursor-pointer rounded-md bg-danger-soft px-2 text-[11px] font-semibold text-danger transition-[filter] hover:brightness-105"
          >
            Trim
          </button>
        )}
        {graphemes > 0 && (
          <>
            {remaining <= 60 && (
              <span
                className={cx(
                  'text-xs font-medium tabular-nums',
                  remaining < 0 ? 'text-danger' : 'text-ink-muted',
                )}
              >
                {remaining}
              </span>
            )}
            <CharRing graphemes={graphemes} />
          </>
        )}
        <button
          type="button"
          onClick={() => void post()}
          disabled={!canPost}
          title={
            videoBlocking
              ? 'Posts once the video finishes uploading'
              : imagesReady
                ? 'Post to Bluesky'
                : 'Preparing images…'
          }
          className="btn btn-primary relative h-9 rounded-lg px-5 text-[13px]"
        >
          {phase === 'posting' && (
            <span className="absolute inset-0 grid place-items-center">
              <Spinner size={13} />
            </span>
          )}
          <span className={cx(phase === 'posting' && 'invisible')}>Post</span>
        </button>
      </div>
    </div>
  );
}

function MediaChoiceChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'h-7 cursor-pointer rounded-lg border px-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-transparent bg-accent-soft text-accent'
          : 'border-line text-ink-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}
