import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  AlertCircleIcon,
  CheckIcon,
  ImageIcon,
  PencilIcon,
  PlusIcon,
  VideoIcon,
  XIcon,
} from '@/components/icons';
import { LogoMark } from '@/components/Logo';
import { CharRing, IconButton, Spinner, cx } from '@/components/ui';
import { VideoUploadPill, type VideoJob } from '@/components/VideoUploadStatus';
import { toErrorMessage } from '@/lib/errors';
import {
  IMAGE_INPUT_ACCEPT,
  MAX_IMAGES,
  prepareImage,
  releaseImage,
  type PreparedImage,
} from '@/lib/images';
import { sendMessage } from '@/lib/messaging';
import { loadSettings, watchSettings, type Settings } from '@/lib/settings';
import { MAX_GRAPHEMES, graphemeLength, splitIntoThread, truncateToGraphemes } from '@/lib/text';
import { resolveTheme } from '@/lib/theme';
import {
  VIDEO_INPUT_ACCEPT,
  isVideoFile,
  pollVideoJob,
  prepareVideo,
  releaseVideo,
  uploadVideoFile,
  type PreparedVideo,
} from '@/lib/video';
import { watchForMainTweets, type CapturedTweet } from '@/lib/xdetect';
import {
  MAX_THREAD_POSTS,
  type AccountSnapshot,
  type ComposerImagePayload,
} from '@/lib/types';

/** Largest video (bytes) we hand off to the popup through storage. */
const HANDOFF_VIDEO_MAX = 40_000_000;

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

interface CardSegment {
  id: string;
  text: string;
  images: PreparedImage[];
}

function toImagePayload({ base64, mime, alt, width, height }: PreparedImage): ComposerImagePayload {
  return { base64, mime, alt, width, height };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the video.'));
    reader.readAsDataURL(file);
  });
}

/**
 * The editing card, built like the popup composer: a stack of avatar-row posts
 * on a thread line, each with its own text and photos, plus a footer that
 * uploads media to the focused post and adds more posts. A single video (on
 * whichever post you attach it to) uploads straight to Bluesky's video service.
 */
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
  const [rootId] = useState(() => crypto.randomUUID());
  const [segments, setSegments] = useState<CardSegment[]>(() => [
    { id: rootId, text: offer.tweet.text, images: [] },
  ]);
  const [activeId, setActiveId] = useState<string>(rootId);
  const [imagesLoading, setImagesLoading] = useState(offer.tweet.images.length > 0);
  const [phase, setPhase] = useState<Phase>('edit');
  const [error, setError] = useState('');
  const [doneUrl, setDoneUrl] = useState<string | undefined>(undefined);

  const [video, setVideo] = useState<PreparedVideo | null>(null);
  const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
  /** Which post the video belongs to (a thread can carry one video). */
  const [videoSegmentId, setVideoSegmentId] = useState<string | null>(null);
  const videoAbortRef = useRef<AbortController | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const videoRef = useRef(video);
  videoRef.current = video;

  const fileRef = useRef<HTMLInputElement>(null);

  // -- video pipeline ---------------------------------------------------------
  function startVideoUpload(prepared: PreparedVideo) {
    videoAbortRef.current?.abort();
    const controller = new AbortController();
    videoAbortRef.current = controller;
    setVideoJob({ phase: 'auth', pct: null });
    void (async () => {
      try {
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
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return;
        }
        setVideoJob({ phase: 'error', pct: null, error: toErrorMessage(err) });
      }
    })();
  }

  async function attachVideoFile(file: File, segmentId: string) {
    try {
      const prepared = await prepareVideo(file);
      if (videoRef.current) releaseVideo(videoRef.current);
      setVideo(prepared);
      setVideoSegmentId(segmentId);
      startVideoUpload(prepared);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }

  function removeVideo() {
    videoAbortRef.current?.abort();
    videoAbortRef.current = null;
    if (videoRef.current) releaseVideo(videoRef.current);
    setVideo(null);
    setVideoJob(null);
    setVideoSegmentId(null);
  }

  // -- captured media on mount ------------------------------------------------
  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (offer.tweet.images.length > 0) {
        const prepared: PreparedImage[] = [];
        for (const blob of offer.tweet.images) {
          try {
            prepared.push(await prepareImage(blob));
          } catch {
            // Drop an unconvertible image; the rest still carry over.
          }
        }
        if (!mounted) {
          prepared.forEach(releaseImage);
          return;
        }
        setSegments((prev) =>
          prev.map((seg) => (seg.id === rootId ? { ...seg, images: prepared } : seg)),
        );
        setImagesLoading(false);
      }
      // Auto-attach a captured video only when no photos claim the root. The
      // upload decides for itself whether this account may post it.
      if (mounted && offer.tweet.video && offer.tweet.images.length === 0) {
        await attachVideoFile(
          new File([offer.tweet.video], 'x-video', {
            type: offer.tweet.video.type || 'video/mp4',
          }),
          rootId,
        );
      }
    })();
    return () => {
      mounted = false;
      videoAbortRef.current?.abort();
      if (videoRef.current) releaseVideo(videoRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.id]);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [phase, onClose]);

  // -- segments ---------------------------------------------------------------
  function addSegment() {
    if (segmentsRef.current.length >= MAX_THREAD_POSTS) return;
    const seg: CardSegment = { id: crypto.randomUUID(), text: '', images: [] };
    setSegments((prev) => [...prev, seg]);
    setActiveId(seg.id);
  }

  function updateSegment(id: string, text: string) {
    setSegments((prev) => prev.map((seg) => (seg.id === id ? { ...seg, text } : seg)));
  }

  function removeSegment(id: string) {
    if (id === rootId) return;
    segmentsRef.current.find((seg) => seg.id === id)?.images.forEach(releaseImage);
    setSegments((prev) => prev.filter((seg) => seg.id !== id));
    setActiveId((current) => (current === id ? rootId : current));
  }

  async function addImages(id: string, files: Iterable<File>) {
    const seg = segmentsRef.current.find((item) => item.id === id);
    if (!seg) return;
    const room = MAX_IMAGES - seg.images.length;
    if (room <= 0) {
      setError(`Each post can have up to ${MAX_IMAGES} images.`);
      return;
    }
    for (const file of [...files].slice(0, room)) {
      try {
        const prepared = await prepareImage(file);
        setSegments((prev) =>
          prev.map((item) =>
            item.id === id && item.images.length < MAX_IMAGES
              ? { ...item, images: [...item.images, prepared] }
              : item,
          ),
        );
      } catch (err) {
        setError(toErrorMessage(err));
      }
    }
  }

  function removeImage(id: string, image: PreparedImage) {
    releaseImage(image);
    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === id ? { ...seg, images: seg.images.filter((i) => i.id !== image.id) } : seg,
      ),
    );
  }

  /** Route the footer picker to the focused post. */
  function handlePickedFiles(files: FileList) {
    const targetId = activeId;
    const target = segmentsRef.current.find((seg) => seg.id === targetId);
    if (!target) return;
    const videos = [...files].filter(isVideoFile);
    const photos = [...files].filter((file) => !isVideoFile(file));
    if (videos.length > 0) {
      // Whether this account may actually upload is decided by the server when
      // the upload runs, so we always accept the pick here.
      if (videoRef.current) {
        setError('A thread can carry one video. Remove it to add another.');
      } else if (target.images.length === 0) {
        void attachVideoFile(videos[0]!, targetId);
      } else if (segmentsRef.current.length >= MAX_THREAD_POSTS) {
        setError('This post has photos, and the thread is full, so remove a post first.');
      } else {
        // The focused post has photos; a post can't hold both, so the video
        // starts a new post right after it.
        const seg: CardSegment = { id: crypto.randomUUID(), text: '', images: [] };
        setSegments((prev) => {
          const index = prev.findIndex((item) => item.id === targetId);
          const next = [...prev];
          next.splice(index + 1, 0, seg);
          return next;
        });
        setActiveId(seg.id);
        void attachVideoFile(videos[0]!, seg.id);
      }
    }
    if (photos.length > 0) {
      if (videoRef.current && videoSegmentId === targetId) {
        setError('Remove the video to add photos to this post.');
      } else {
        void addImages(targetId, photos);
      }
    }
  }

  function swapToVideo() {
    if (!offer.tweet.video) return;
    setSegments((prev) =>
      prev.map((seg) => {
        if (seg.id !== rootId) return seg;
        seg.images.forEach(releaseImage);
        return { ...seg, images: [] };
      }),
    );
    void attachVideoFile(
      new File([offer.tweet.video], 'x-video', { type: offer.tweet.video.type || 'video/mp4' }),
      rootId,
    );
  }

  async function swapToPhotos() {
    removeVideo();
    const prepared: PreparedImage[] = [];
    for (const blob of offer.tweet.images) {
      try {
        prepared.push(await prepareImage(blob));
      } catch {
        // Skip an unconvertible image.
      }
    }
    setSegments((prev) =>
      prev.map((seg) => (seg.id === rootId ? { ...seg, images: prepared } : seg)),
    );
  }

  // -- derived ----------------------------------------------------------------
  const root = segments[0]!;
  const activeSegment = segments.find((seg) => seg.id === activeId) ?? root;
  const hasVideo = Boolean(video);
  const activeHasVideo = hasVideo && videoSegmentId === activeSegment.id;

  const activeGraphemes = graphemeLength(activeSegment.text);
  const activeRemaining = MAX_GRAPHEMES - activeGraphemes;

  const rootOverLimit = segments.length === 1 && graphemeLength(root.text) > MAX_GRAPHEMES;
  const splitPreview = useMemo(
    () => (rootOverLimit ? splitIntoThread(root.text).length : 0),
    [rootOverLimit, root.text],
  );

  const videoBlocking = hasVideo && videoJob?.phase !== 'ready';
  const readyVideoPayload = hasVideo && videoJob?.phase === 'ready' ? videoJob.payload : null;
  const videoPostIndex = videoSegmentId
    ? Math.max(0, segments.findIndex((seg) => seg.id === videoSegmentId))
    : 0;
  const segmentsValid = segments.every(
    (seg) =>
      (seg.text.trim().length > 0 || seg.images.length > 0 || seg.id === videoSegmentId) &&
      graphemeLength(seg.text) <= MAX_GRAPHEMES,
  );
  const canPost = phase === 'edit' && !imagesLoading && !videoBlocking && segmentsValid;

  // The picker always offers video while the thread has none yet (one per
  // thread); if the focused post has photos, the picked video starts a new
  // post, so we don't need to hide it here.
  const canOfferVideo = !hasVideo;
  const mediaAccept = canOfferVideo
    ? `${IMAGE_INPUT_ACCEPT},${VIDEO_INPUT_ACCEPT}`
    : IMAGE_INPUT_ACCEPT;
  const mediaDisabled = activeHasVideo ? true : activeSegment.images.length >= MAX_IMAGES;

  // Swap chips only make sense on the root when the captured tweet had both.
  const rootHasVideo = hasVideo && videoSegmentId === rootId;
  const showUseVideo =
    Boolean(offer.tweet.video) && !hasVideo && root.images.length > 0;
  const showUsePhotos = rootHasVideo && offer.tweet.images.length > 0;

  function splitCardIntoThread() {
    const parts = splitIntoThread(root.text);
    if (parts.length <= 1) return;
    const capped = parts.slice(0, MAX_THREAD_POSTS);
    if (parts.length > MAX_THREAD_POSTS) {
      capped[MAX_THREAD_POSTS - 1] = parts.slice(MAX_THREAD_POSTS - 1).join('\n\n');
    }
    setSegments((prev) => {
      const rootImages = prev[0]?.images ?? [];
      return capped.map((value, index) =>
        index === 0
          ? { id: rootId, text: value, images: rootImages }
          : { id: crypto.randomUUID(), text: value, images: [] },
      );
    });
  }

  // A confirmed preview posts itself the moment everything is ready; one
  // attempt only, so a failure lands in the editor instead of retry-looping.
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (!autoPost || autoTriedRef.current || phase !== 'edit' || !canPost) return;
    autoTriedRef.current = true;
    void post();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPost, phase, canPost]);

  async function post() {
    if (!canPost) return;
    setPhase('posting');
    setError('');
    try {
      const results = await sendMessage('post:publish', {
        text: root.text,
        extraPosts: segments
          .slice(1)
          .map((seg) => ({ text: seg.text, images: seg.images.map(toImagePayload) })),
        langs: defaultLang ? [defaultLang] : undefined,
        images: root.images.map(toImagePayload),
        video: readyVideoPayload,
        videoPostIndex,
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

  async function openFullComposer() {
    let videoKey: string | undefined;
    // The full composer keeps a video on the lead post, so only a root video
    // carries over cleanly.
    if (video && videoSegmentId === rootId && video.sizeBytes <= HANDOFF_VIDEO_MAX) {
      try {
        const base64 = await fileToBase64(video.file);
        videoKey = `supersky:handoff-video:${crypto.randomUUID()}`;
        await browser.storage.local.set({ [videoKey]: { base64, mime: video.mime } });
      } catch {
        videoKey = undefined;
      }
    }
    void sendMessage('composer:open', {
      kind: 'crosspost',
      text: root.text,
      images: root.images.map(toImagePayload),
      extraPosts: segments
        .slice(1)
        .map((seg) => ({ text: seg.text, images: seg.images.map(toImagePayload) })),
      videoKey,
    }).catch(() => undefined);
    onClose();
  }

  /** Borderless editors grow with their content, like the popup composer. */
  const autosizeArea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  };

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
    <div className="card animate-slide-up flex max-h-[86vh] w-[400px] flex-col rounded-[10px] shadow-[var(--ss-shadow-pop)]">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <LogoMark size={30} className="shrink-0" />
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3.5 pb-2">
        {segments.map((segment, index) => {
          const last = index === segments.length - 1;
          const isRoot = segment.id === rootId;
          const remainingSeg = MAX_GRAPHEMES - graphemeLength(segment.text);
          return (
            <div key={segment.id} className={cx('relative flex gap-3', last ? 'pb-1' : 'pb-3')}>
              {!last && (
                <div
                  aria-hidden="true"
                  className="absolute top-[46px] bottom-0 left-[19px] w-px bg-line"
                />
              )}
              <span className={cx('h-fit rounded-full', segment.id === activeId && 'ring-2 ring-accent/45')}>
                <AccountAvatar account={offer.account} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1">
                  <textarea
                    ref={autosizeArea}
                    value={segment.text}
                    autoFocus={isRoot}
                    onFocus={() => setActiveId(segment.id)}
                    onChange={(event) => {
                      updateSegment(segment.id, event.target.value);
                      autosizeArea(event.currentTarget);
                    }}
                    onPaste={(event) => {
                      const files = event.clipboardData?.files;
                      if (files && files.length > 0) {
                        const photos = [...files].filter((file) => !isVideoFile(file));
                        if (photos.length > 0) {
                          event.preventDefault();
                          void addImages(segment.id, photos);
                        }
                      }
                    }}
                    rows={isRoot ? 3 : 1}
                    placeholder={isRoot ? "What's up?" : 'Write another post'}
                    className={cx(
                      'w-full resize-none bg-transparent pt-1.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint',
                      isRoot ? 'min-h-[72px]' : 'min-h-[38px]',
                    )}
                  />
                  {!isRoot && (
                    <IconButton
                      title="Remove this post"
                      onClick={() => removeSegment(segment.id)}
                      className="mt-1 size-6 shrink-0 text-ink-faint hover:text-ink"
                    >
                      <XIcon size={12} />
                    </IconButton>
                  )}
                </div>

                {isRoot && imagesLoading && (
                  <div className="mt-2 flex gap-1.5">
                    {offer.tweet.images.map((_, i) => (
                      <div key={i} className="shimmer size-20 rounded-lg" />
                    ))}
                  </div>
                )}
                {segment.images.length > 0 && (
                  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                    {segment.images.map((image) => (
                      <div
                        key={image.id}
                        className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2"
                      >
                        <img src={image.previewUrl} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          title="Remove image"
                          aria-label="Remove image"
                          onClick={() => removeImage(segment.id, image)}
                          className="absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full bg-black/65 text-white backdrop-blur-sm transition-colors hover:bg-black/85"
                        >
                          <XIcon size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {video && videoSegmentId === segment.id && (
                  <div className="mt-2">
                    <div className="relative overflow-hidden rounded-xl border border-line bg-black">
                      <video
                        src={video.previewUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="block max-h-52 w-full object-contain"
                      />
                      {/* Floating close badge, matching the popup's video tile. */}
                      <button
                        type="button"
                        onClick={removeVideo}
                        title="Remove video"
                        aria-label="Remove video"
                        className="absolute top-1.5 right-1.5 grid size-6 cursor-pointer place-items-center rounded-full bg-black/65 text-white backdrop-blur-sm transition-colors hover:bg-black/85"
                      >
                        <XIcon size={13} />
                      </button>
                      {/* Upload progress floats over the clip while bytes move. */}
                      {videoJob && videoJob.phase !== 'ready' && videoJob.phase !== 'error' && (
                        <div className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)]">
                          <VideoUploadPill
                            job={videoJob}
                            onRetry={() => video && startVideoUpload(video)}
                          />
                        </div>
                      )}
                    </div>
                    {videoJob?.phase === 'error' && (
                      <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-2.5 py-2">
                        <AlertCircleIcon size={14} className="mt-px shrink-0 text-danger" />
                        <p className="min-w-0 flex-1 text-[11px] leading-snug text-danger">
                          {videoJob.error}
                        </p>
                        <button
                          type="button"
                          onClick={removeVideo}
                          aria-label="Dismiss"
                          title="Dismiss"
                          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-md text-danger/70 transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          <XIcon size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isRoot && (showUseVideo || showUsePhotos) && (
                  <button
                    type="button"
                    onClick={showUseVideo ? swapToVideo : () => void swapToPhotos()}
                    className="mt-2 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <VideoIcon size={12} />
                    {showUseVideo ? 'Use the video instead' : 'Use photos instead'}
                  </button>
                )}

                {remainingSeg <= 60 && (
                  <div className="mt-0.5 flex justify-end">
                    <span
                      className={cx(
                        'text-[10px] font-medium tabular-nums',
                        remainingSeg < 0 ? 'text-danger' : 'text-ink-faint',
                      )}
                    >
                      {remainingSeg}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {segments.length < MAX_THREAD_POSTS && (
          <button
            type="button"
            onClick={addSegment}
            className="ml-[50px] inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
          >
            <PlusIcon size={13} />
            {segments.length > 1 ? 'Add another post' : 'Add to thread'}
          </button>
        )}

        {offer.tweet.unportableVideo && (
          <p className="mt-2 ml-[50px] flex items-center gap-1.5 text-[11px] leading-snug text-ink-faint">
            <VideoIcon size={12} className="shrink-0" /> The captured video/GIF can’t be carried
            over; add one below.
          </p>
        )}
        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-danger">
            <AlertCircleIcon size={13} className="mt-px shrink-0" />
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-0.5 border-t border-line px-3 py-2.5">
        <input
          ref={fileRef}
          type="file"
          accept={mediaAccept}
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) handlePickedFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <IconButton
          title={
            activeHasVideo
              ? 'Remove the video to add photos'
              : canOfferVideo
                ? 'Add photos or a video to the selected post'
                : 'Add photos to the selected post'
          }
          disabled={mediaDisabled}
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon size={18} />
        </IconButton>
        <IconButton
          title="Add another post to the thread"
          disabled={segments.length >= MAX_THREAD_POSTS}
          onClick={addSegment}
        >
          <PlusIcon size={18} />
        </IconButton>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => void openFullComposer()}
          title="Continue in the full Supersky composer"
          className="h-8 cursor-pointer rounded-lg px-2 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          Full composer
        </button>
        {rootOverLimit && splitPreview > 1 && (
          <button
            type="button"
            onClick={splitCardIntoThread}
            title="Split this text into a thread"
            className="h-7 shrink-0 cursor-pointer rounded-md bg-accent-soft px-2 text-[11px] font-semibold text-accent transition-[filter] hover:brightness-105"
          >
            Thread ({Math.min(splitPreview, MAX_THREAD_POSTS)})
          </button>
        )}
        {rootOverLimit && (
          <button
            type="button"
            onClick={() => updateSegment(rootId, truncateToGraphemes(root.text, MAX_GRAPHEMES))}
            className="h-7 shrink-0 cursor-pointer rounded-md bg-danger-soft px-2 text-[11px] font-semibold text-danger transition-[filter] hover:brightness-105"
          >
            Trim
          </button>
        )}
        {activeGraphemes > 0 && (
          <>
            {activeRemaining <= 60 && (
              <span
                className={cx(
                  'text-xs font-medium tabular-nums',
                  activeRemaining < 0 ? 'text-danger' : 'text-ink-muted',
                )}
              >
                {activeRemaining}
              </span>
            )}
            <CharRing graphemes={activeGraphemes} />
          </>
        )}
        <button
          type="button"
          onClick={() => void post()}
          disabled={!canPost}
          title={
            videoBlocking
              ? 'Posts once the video finishes uploading'
              : imagesLoading
                ? 'Preparing images…'
                : 'Post to Bluesky'
          }
          className="btn btn-primary relative ml-1 h-9 rounded-lg px-4 text-[13px]"
        >
          {phase === 'posting' && (
            <span className="absolute inset-0 grid place-items-center">
              <Spinner size={13} />
            </span>
          )}
          <span className={cx(phase === 'posting' && 'invisible')}>
            {segments.length > 1 ? `Post all ${segments.length}` : 'Post'}
          </span>
        </button>
      </div>
    </div>
  );
}

/** The signing account's avatar, sized to sit on the thread line. */
function AccountAvatar({ account }: { account: AccountSnapshot }) {
  return account.avatar ? (
    <img
      src={account.avatar}
      alt=""
      className="size-[38px] shrink-0 rounded-full border border-line object-cover"
    />
  ) : (
    <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-accent text-[15px] font-semibold text-white">
      {(account.handle[0] ?? '?').toUpperCase()}
    </span>
  );
}

