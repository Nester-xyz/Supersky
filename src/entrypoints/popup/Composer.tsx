import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { browser } from 'wxt/browser';
import { DraftsSheet } from '@/components/DraftsSheet';
import { EmojiPicker } from '@/components/EmojiPicker';
import { GifPicker } from '@/components/GifPicker';
import { InteractionSheet } from '@/components/InteractionSheet';
import { useMentionAutocomplete } from '@/components/MentionAutocomplete';
import { Select } from '@/components/Select';
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  PlusIcon,
  ReplyBubbleIcon,
  UsersIcon,
  XIcon,
} from '@/components/icons';
import { Avatar, CharRing, IconButton, Spinner, cx } from '@/components/ui';
import { VideoUploadPill, type VideoJob } from '@/components/VideoUploadStatus';
import {
  addSavedDraft,
  clearDraft,
  deleteSavedDraft,
  loadAutosave,
  saveAutosaveImages,
  saveAutosaveMeta,
  type SavedDraft,
} from '@/lib/draft';
import { base64ToBytes } from '@/lib/encoding';
import { toErrorMessage } from '@/lib/errors';
import type { AttachedGif } from '@/lib/gifs';
import {
  IMAGE_INPUT_ACCEPT,
  MAX_IMAGES,
  prepareImage,
  releaseImage,
  type PreparedImage,
} from '@/lib/images';
import {
  defaultInteraction,
  isDefaultInteraction,
  summarizeInteraction,
  type InteractionSettings,
} from '@/lib/interaction';
import { LANGUAGES } from '@/lib/languages';
import { sendMessage } from '@/lib/messaging';
import { loadSettings } from '@/lib/settings';
import { takePendingShare } from '@/lib/share';
import {
  MAX_GRAPHEMES,
  buildShareText,
  graphemeLength,
  insertAtSelection,
  replaceRange,
  splitIntoThread,
  truncateToGraphemes,
} from '@/lib/text';
import { domainOf, extractFirstUrl } from '@/lib/urls';
import {
  VIDEO_INPUT_ACCEPT,
  isVideoFile,
  pollVideoJob,
  prepareVideo,
  releaseVideo,
  uploadVideoFile,
  type PreparedVideo,
} from '@/lib/video';
import {
  MAX_THREAD_POSTS,
  type AccountSnapshot,
  type ComposerImagePayload,
  type LinkCardData,
} from '@/lib/types';

interface ToastState {
  kind: 'success' | 'error';
  message: string;
  href?: string;
}

type AltTarget =
  | { kind: 'image'; image: PreparedImage; segmentId?: string }
  | { kind: 'gif' }
  | { kind: 'video' };

type SheetKind = 'none' | 'interaction' | 'drafts';

function toImagePayload({ base64, mime, alt, width, height }: PreparedImage): ComposerImagePayload {
  return { base64, mime, alt, width, height };
}

interface ThreadSegment {
  id: string;
  text: string;
  /** Each follow-up post can carry its own images. */
  images: PreparedImage[];
}

/** The notification post a reply composes under. */
interface ReplyContext {
  uri: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  snippet: string;
}

/**
 * A Bluesky post carries a single embed, so photos and a video can never share
 * one post. When both are chosen, the composer keeps the first and explains
 * the platform limit rather than silently dropping the rest.
 */
const PHOTOS_AND_VIDEO_MESSAGE =
  'Bluesky can’t put photos and a video in the same post. Post them separately.';

export function Composer({
  account,
  accounts,
}: {
  account: AccountSnapshot;
  accounts: AccountSnapshot[];
}) {
  const [booted, setBooted] = useState(false);
  const [text, setText] = useState('');
  const [extraPosts, setExtraPosts] = useState<ThreadSegment[]>([]);
  /** Which thread post the footer's media button feeds (null = root). */
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  /** A just-added thread post that should grab the cursor on mount. */
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null);
  const [replyCtx, setReplyCtx] = useState<ReplyContext | null>(null);
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [video, setVideo] = useState<PreparedVideo | null>(null);
  const [videoJob, setVideoJob] = useState<VideoJob | null>(null);
  const [gif, setGif] = useState<AttachedGif | null>(null);
  const [interaction, setInteraction] = useState<InteractionSettings>(defaultInteraction);
  const [card, setCard] = useState<LinkCardData | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [lang, setLang] = useState('en');
  const [autoCard, setAutoCard] = useState(true);
  const [posting, setPosting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [altTarget, setAltTarget] = useState<AltTarget | null>(null);
  const [sheet, setSheet] = useState<SheetKind>('none');
  const [dragOver, setDragOver] = useState(false);
  const [currentTab, setCurrentTab] = useState<{ url: string; title: string } | null>(null);
  // Which accounts this draft posts as; defaults to the active one, reset when
  // the active account changes from the header switcher.
  const [targets, setTargets] = useState<string[]>([account.did]);

  // Detached-window mode (the fallback when the toolbar popup can't open).
  const isWindowMode = useMemo(
    () => new URLSearchParams(window.location.search).get('mode') === 'window',
    [],
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dismissedUrlRef = useRef<string | null>(null);
  const requestedUrlRef = useRef<string | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const loadedDraftRef = useRef<string | null>(null);
  const videoAbortRef = useRef<AbortController | null>(null);
  /** DID whose upload session owns the attached video. */
  const videoOwnerRef = useRef<string | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const extraPostsRef = useRef(extraPosts);
  extraPostsRef.current = extraPosts;
  const videoRef = useRef(video);
  videoRef.current = video;
  const gifRef = useRef(gif);
  gifRef.current = gif;

  // Replace the "@partial" range with the chosen handle; facets are resolved
  // for real at publish time, so we only need the plain text here.
  const applyMention = useCallback((range: { start: number; end: number }, handle: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = replaceRange(textarea.value, range.start, range.end, `@${handle} `);
    selectionRef.current = { start: result.caret, end: result.caret };
    setText(result.text);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.caret, result.caret);
    });
  }, []);
  const mentions = useMentionAutocomplete({ textareaRef, onChoose: applyMention });

  // Follow the active account when it changes in the header.
  useEffect(() => {
    setTargets([account.did]);
  }, [account.did]);

  // Drop targets whose account signed out elsewhere while the popup was open.
  useEffect(() => {
    setTargets((prev) => {
      const valid = prev.filter((did) => accounts.some((item) => item.did === did));
      if (valid.length === prev.length && valid.length > 0) return prev;
      return valid.length > 0 ? valid : [account.did];
    });
  }, [accounts, account.did]);

  // -- boot: settings, pending share or restored autosave, current tab ------
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const settings = await loadSettings();
      const share = await takePendingShare();
      // A cross-post hand-off or a banner reply is a deliberate fresh draft
      // and takes the composer wholesale; otherwise everything from the last
      // session comes back, since outside clicks close the popup without
      // warning.
      const crosspost = share?.kind === 'crosspost' ? share : null;
      const reply = share?.kind === 'reply' && share.replyTo ? share : null;
      const restored = crosspost || reply ? null : await loadAutosave();
      if (!mounted) return;
      setLang(restored?.lang ?? settings.defaultLang);
      setAutoCard(settings.autoLinkCard);
      if (reply) {
        setReplyCtx({
          uri: reply.replyTo ?? '',
          handle: reply.replyToHandle ?? '',
          displayName: reply.replyToDisplayName,
          avatar: reply.replyToAvatar,
          snippet: reply.replyToText ?? '',
        });
      }
      if (crosspost?.images?.length) {
        setImages(
          crosspost.images.map((image) => ({
            id: crypto.randomUUID(),
            ...image,
            previewUrl: `data:${image.mime};base64,${image.base64}`,
          })),
        );
      }
      if (crosspost?.extraPosts?.length) {
        setExtraPosts(
          crosspost.extraPosts.map((post) => ({
            id: crypto.randomUUID(),
            text: post.text,
            images: (post.images ?? []).map((image) => ({
              id: crypto.randomUUID(),
              ...image,
              previewUrl: `data:${image.mime};base64,${image.base64}`,
            })),
          })),
        );
      }
      // A handed-off video was stashed in storage.local; reconstruct the file
      // and feed it through the normal attach path, then clear the stash.
      if (crosspost?.videoKey) {
        void (async () => {
          try {
            const stored = await browser.storage.local.get(crosspost.videoKey!);
            const entry = stored[crosspost.videoKey!] as
              | { base64: string; mime: string }
              | undefined;
            await browser.storage.local.remove(crosspost.videoKey!);
            if (!entry) return;
            const bytes = base64ToBytes(entry.base64);
            const file = new File([bytes.buffer as ArrayBuffer], 'handoff-video', {
              type: entry.mime,
            });
            await addFilesRef.current?.([file]);
          } catch {
            // The video just doesn't carry over; text and photos still did.
          }
        })();
      }
      if (!crosspost && restored) {
        if (restored.images.length > 0) {
          setImages(
            restored.images.map((image) => ({
              id: crypto.randomUUID(),
              ...image,
              previewUrl: `data:${image.mime};base64,${image.base64}`,
            })),
          );
        }
        if (restored.extraPosts.length > 0) {
          setExtraPosts(
            restored.extraPosts.map((value) => ({
              id: crypto.randomUUID(),
              text: value,
              images: [],
            })),
          );
        }
        setGif(restored.gif);
        if (restored.interaction) setInteraction(restored.interaction);
      }
      const initialText = share ? buildShareText(share) : (restored?.text ?? '');
      if (initialText) setText(initialText);
      setBooted(true);
    })();

    browser.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then((tabs) => {
        const tab = tabs[0];
        if (mounted && tab?.url && /^https?:/i.test(tab.url)) {
          setCurrentTab({ url: tab.url, title: tab.title ?? tab.url });
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  // Release preview object URLs and abort uploads when the popup closes.
  useEffect(() => {
    return () => {
      imagesRef.current.forEach(releaseImage);
      videoAbortRef.current?.abort();
      if (videoRef.current) releaseVideo(videoRef.current);
    };
  }, []);

  // -- focus caret at the end once booted -----------------------------------
  useEffect(() => {
    if (!booted) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    selectionRef.current = { start: el.value.length, end: el.value.length };
  }, [booted]);

  // -- autosize textarea -----------------------------------------------------
  // Re-measures when reply/thread mode flips too, since the min-height floor
  // changes with it and a stale inline height would leave dead space.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text, replyCtx, extraPosts.length]);

  // -- draft autosave ---------------------------------------------------------
  useEffect(() => {
    if (!booted) return;
    const timer = setTimeout(
      () =>
        void saveAutosaveMeta({
          text,
          extraPosts: extraPosts.map((segment) => segment.text).filter((t) => t.trim()),
          lang,
          gif,
          interaction: isDefaultInteraction(interaction) ? null : interaction,
        }),
      400,
    );
    return () => clearTimeout(timer);
  }, [text, extraPosts, lang, gif, interaction, booted]);

  // Attachments change discretely, so they persist immediately on change.
  useEffect(() => {
    if (!booted) return;
    void saveAutosaveImages(
      images.map(({ base64, mime, alt, width, height }) => ({ base64, mime, alt, width, height })),
    );
  }, [images, booted]);

  // The header's Drafts button lives outside this component; it knocks via a
  // window event.
  useEffect(() => {
    const open = () => setSheet('drafts');
    window.addEventListener('supersky:open-drafts', open);
    return () => window.removeEventListener('supersky:open-drafts', open);
  }, []);

  // Reply mode tells the page shell to hug its content instead of holding the
  // full composer height.
  useEffect(() => {
    document.documentElement.classList.toggle('mode-reply', Boolean(replyCtx));
    return () => document.documentElement.classList.remove('mode-reply');
  }, [replyCtx]);

  // A draft loaded from the shelf is only consumed when it's actually posted;
  // clearing the composer by hand breaks that link so an unrelated later post
  // never deletes it.
  useEffect(() => {
    if (!text && extraPosts.length === 0 && images.length === 0 && !gif && !video) {
      loadedDraftRef.current = null;
    }
  }, [text, extraPosts.length, images.length, gif, video]);

  // -- link card detection ----------------------------------------------------
  const detectedUrl = useMemo(() => extractFirstUrl(text), [text]);

  useEffect(() => {
    if (!booted || !autoCard || images.length > 0 || gif || video) return;
    if (!detectedUrl) {
      requestedUrlRef.current = null;
      setCard(null);
      setCardLoading(false);
      return;
    }
    if (detectedUrl === dismissedUrlRef.current) return;
    if (detectedUrl === requestedUrlRef.current) return;

    const timer = setTimeout(() => {
      requestedUrlRef.current = detectedUrl;
      setCardLoading(true);
      sendMessage('card:fetch', { url: detectedUrl })
        .then((data) => {
          if (requestedUrlRef.current !== detectedUrl) return;
          setCard(data);
          setCardLoading(false);
        })
        .catch(() => {
          if (requestedUrlRef.current === detectedUrl) setCardLoading(false);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [detectedUrl, autoCard, images.length, gif, video, booted]);

  // -- media: images + video --------------------------------------------------
  const addFilesRef = useRef<((files: Iterable<File>) => void) | null>(null);

  const addFiles = useCallback(async (files: Iterable<File>) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    let videoFiles = list.filter(isVideoFile);
    let imageFiles = list.filter((file) => !isVideoFile(file));

    // Whether this account may actually upload video is settled by the server
    // when the upload runs (it depends on the account's confirmed email), so we
    // always accept the pick here and surface any refusal on the attachment.

    // A single drop that mixes photos and a video can't all go on one post, so
    // keep whichever type came first in the selection and drop the other.
    const droppedMix = videoFiles.length > 0 && imageFiles.length > 0;
    if (droppedMix) {
      if (isVideoFile(list[0]!)) imageFiles = [];
      else videoFiles = [];
    }

    if (videoFiles.length > 0) {
      if (imagesRef.current.length > 0) {
        setToast({ kind: 'error', message: PHOTOS_AND_VIDEO_MESSAGE });
        return;
      }
      if (gifRef.current) {
        setToast({ kind: 'error', message: 'A post can have a GIF or a video, not both.' });
        return;
      }
      if (videoRef.current) {
        setToast({ kind: 'error', message: 'A post can have only one video.' });
        return;
      }
      const firstVideo = videoFiles[0];
      if (firstVideo) await attachVideo(firstVideo);
      if (droppedMix) {
        setToast({ kind: 'error', message: PHOTOS_AND_VIDEO_MESSAGE });
      } else if (videoFiles.length > 1) {
        setToast({ kind: 'error', message: 'A post can have only one video, so the first was used.' });
      }
      return;
    }

    if (videoRef.current) {
      setToast({ kind: 'error', message: PHOTOS_AND_VIDEO_MESSAGE });
      return;
    }
    if (gifRef.current) {
      setToast({ kind: 'error', message: 'A post can have a GIF or photos, not both.' });
      return;
    }
    const room = MAX_IMAGES - imagesRef.current.length;
    if (room <= 0) {
      setToast({ kind: 'error', message: `You can attach up to ${MAX_IMAGES} images.` });
      return;
    }
    for (const file of imageFiles.slice(0, room)) {
      try {
        const prepared = await prepareImage(file);
        setImages((prev) => (prev.length < MAX_IMAGES ? [...prev, prepared] : prev));
        // Images and link cards are mutually exclusive on Bluesky.
        setCard(null);
        setCardLoading(false);
      } catch (err) {
        setToast({ kind: 'error', message: toErrorMessage(err) });
      }
    }
    if (droppedMix) {
      setToast({ kind: 'error', message: PHOTOS_AND_VIDEO_MESSAGE });
    } else if (imageFiles.length > room) {
      setToast({ kind: 'error', message: `Only ${MAX_IMAGES} images fit on a post.` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  addFilesRef.current = addFiles;

  function removeImage(image: PreparedImage) {
    releaseImage(image);
    setImages((prev) => prev.filter((item) => item.id !== image.id));
  }

  async function attachVideo(file: File) {
    try {
      const prepared = await prepareVideo(file);
      // Video blobs belong to the uploading account's repo, so the post can
      // only go out as that account.
      setTargets([account.did]);
      videoOwnerRef.current = account.did;
      setVideo(prepared);
      setCard(null);
      setCardLoading(false);
      startVideoUpload(prepared, account.did);
    } catch (err) {
      setToast({ kind: 'error', message: toErrorMessage(err) });
    }
  }

  function startVideoUpload(prepared: PreparedVideo, did: string) {
    videoAbortRef.current?.abort();
    const controller = new AbortController();
    videoAbortRef.current = controller;
    setVideoJob({ phase: 'auth', pct: null });

    void (async () => {
      try {
        const { token } = await sendMessage('video:auth', { did });
        if (controller.signal.aborted) return;
        setVideoJob({ phase: 'uploading', pct: 0 });
        const status = await uploadVideoFile({
          video: prepared,
          did,
          token,
          signal: controller.signal,
          onProgress: (fraction) =>
            setVideoJob({ phase: 'uploading', pct: Math.min(100, Math.round(fraction * 100)) }),
        });
        // Re-uploads of a known file can come back already completed.
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
            did,
          },
        });
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        // The dismissible banner under the video carries the reason (e.g.
        // "confirm your email") and the retry/close controls.
        setVideoJob({ phase: 'error', pct: null, error: toErrorMessage(err) });
      }
    })();
  }

  const removeVideo = useCallback(() => {
    videoAbortRef.current?.abort();
    videoAbortRef.current = null;
    if (videoRef.current) releaseVideo(videoRef.current);
    videoOwnerRef.current = null;
    setVideo(null);
    setVideoJob(null);
  }, []);

  // Switching the signing account invalidates an in-flight/processed upload.
  useEffect(() => {
    if (videoRef.current && videoOwnerRef.current && videoOwnerRef.current !== account.did) {
      removeVideo();
      setToast({
        kind: 'error',
        message: 'Video removed. Uploads are tied to the account that started them.',
      });
    }
  }, [account.did, removeVideo]);

  function attachGif(next: AttachedGif) {
    if (imagesRef.current.length > 0 || videoRef.current) {
      setToast({
        kind: 'error',
        message: `A post can have one kind of media, so remove the ${videoRef.current ? 'video' : 'photos'} first to add a GIF.`,
      });
      return;
    }
    setGif(next);
    setCard(null);
    setCardLoading(false);
  }

  /**
   * The footer's one media button feeds whichever post was last focused:
   * the root gets the full treatment (photos or a video), follow-up posts
   * take photos only.
   */
  function handlePickedFiles(files: FileList) {
    const targetId = activeSegmentId;
    const target = targetId
      ? extraPostsRef.current.find((segment) => segment.id === targetId)
      : undefined;
    if (!target) {
      void addFiles(files);
      return;
    }
    const imageFiles = [...files].filter((file) => !isVideoFile(file));
    if (imageFiles.length < files.length) {
      setToast({ kind: 'error', message: 'Videos can only go on the first post.' });
    }
    if (imageFiles.length > 0) void addSegmentImages(target.id, imageFiles);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData?.files;
    if (files && files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer?.files?.length) void addFiles(event.dataTransfer.files);
  }

  // -- thread segments --------------------------------------------------------
  function addThreadPost() {
    if (extraPosts.length + 1 >= MAX_THREAD_POSTS) return;
    const segment: ThreadSegment = { id: crypto.randomUUID(), text: '', images: [] };
    setExtraPosts((prev) => [...prev, segment]);
    // Make the new post the active one and put the cursor in it.
    setActiveSegmentId(segment.id);
    setFocusSegmentId(segment.id);
  }

  function updateThreadPost(id: string, value: string) {
    setExtraPosts((prev) =>
      prev.map((segment) => (segment.id === id ? { ...segment, text: value } : segment)),
    );
  }

  function removeThreadPost(id: string) {
    setActiveSegmentId((prev) => (prev === id ? null : prev));
    setExtraPosts((prev) => {
      prev.find((segment) => segment.id === id)?.images.forEach(releaseImage);
      return prev.filter((segment) => segment.id !== id);
    });
  }

  async function addSegmentImages(id: string, files: Iterable<File>) {
    const segment = extraPostsRef.current.find((item) => item.id === id);
    if (!segment) return;
    const room = MAX_IMAGES - segment.images.length;
    if (room <= 0) {
      setToast({ kind: 'error', message: `Each post can carry up to ${MAX_IMAGES} images.` });
      return;
    }
    for (const file of [...files].slice(0, room)) {
      try {
        const prepared = await prepareImage(file);
        setExtraPosts((prev) =>
          prev.map((item) =>
            item.id === id && item.images.length < MAX_IMAGES
              ? { ...item, images: [...item.images, prepared] }
              : item,
          ),
        );
      } catch (err) {
        setToast({ kind: 'error', message: toErrorMessage(err) });
      }
    }
  }

  function removeSegmentImage(id: string, image: PreparedImage) {
    releaseImage(image);
    setExtraPosts((prev) =>
      prev.map((segment) =>
        segment.id === id
          ? { ...segment, images: segment.images.filter((item) => item.id !== image.id) }
          : segment,
      ),
    );
  }

  /** Split the over-limit root text into a thread at natural boundaries. */
  function splitRootIntoThread() {
    const parts = splitIntoThread(text);
    if (parts.length <= 1) return;
    const capped = parts.slice(0, MAX_THREAD_POSTS);
    if (parts.length > MAX_THREAD_POSTS) {
      // Nothing is thrown away: the tail rejoins the last post, whose counter
      // goes red until it's shortened.
      capped[MAX_THREAD_POSTS - 1] = parts.slice(MAX_THREAD_POSTS - 1).join('\n\n');
      setToast({
        kind: 'error',
        message: `Threads can have up to ${MAX_THREAD_POSTS} posts; trim the last one to fit.`,
      });
    }
    setText(capped[0] ?? '');
    setExtraPosts(
      capped.slice(1).map((value) => ({ id: crypto.randomUUID(), text: value, images: [] })),
    );
  }

  // -- publish ----------------------------------------------------------------
  const graphemes = useMemo(() => graphemeLength(text), [text]);
  const remaining = MAX_GRAPHEMES - graphemes;
  const hasContent = text.trim().length > 0 || images.length > 0 || Boolean(gif) || Boolean(video);
  const extrasValid = extraPosts.every(
    (segment) =>
      (segment.text.trim().length > 0 || segment.images.length > 0) &&
      graphemeLength(segment.text) <= MAX_GRAPHEMES,
  );
  // An attached video must finish uploading/processing before the post can go
  // out (its blob only exists once the job completes). Until then, Post is off.
  const videoNotReady = Boolean(video) && videoJob?.phase !== 'ready';
  const canPost = !posting && remaining >= 0 && hasContent && extrasValid && !videoNotReady;

  const composerDirty = hasContent || extraPosts.length > 0;

  function resetComposer() {
    imagesRef.current.forEach(releaseImage);
    extraPostsRef.current.forEach((segment) => segment.images.forEach(releaseImage));
    setImages([]);
    removeVideo();
    setGif(null);
    setInteraction(defaultInteraction());
    setText('');
    setExtraPosts([]);
    setActiveSegmentId(null);
    setReplyCtx(null);
    selectionRef.current = { start: 0, end: 0 };
    mentions.dismiss();
    setCard(null);
    dismissedUrlRef.current = null;
    requestedUrlRef.current = null;
    loadedDraftRef.current = null;
  }

  async function publish() {
    if (posting) return;
    setPosting(true);
    setToast(null);
    const requested = targets.length || 1;
    const loadedDraftId = loadedDraftRef.current;
    const wasReply = Boolean(replyCtx);
    const videoPayload =
      video && videoJob?.phase === 'ready' ? { ...videoJob.payload, alt: video.alt } : null;
    try {
      const results = await sendMessage('post:publish', {
        text,
        extraPosts: extraPosts
          .map((segment) => ({
            text: segment.text,
            images: segment.images.map(toImagePayload),
          }))
          .filter((post) => post.text.trim() || post.images.length > 0),
        replyTo: replyCtx?.uri ?? null,
        langs: lang ? [lang] : undefined,
        images: images.map(({ base64, mime, alt, width, height }) => ({
          base64,
          mime,
          alt,
          width,
          height,
        })),
        video: videoPayload,
        gif,
        card: images.length === 0 && !gif && !video ? card : null,
        // Threadgates belong to thread roots, so replies carry no settings.
        interaction: replyCtx || isDefaultInteraction(interaction) ? null : interaction,
        dids: targets,
      });
      resetComposer();
      await clearDraft();
      if (loadedDraftId) await deleteSavedDraft(loadedDraftId);
      // A reply opened in its own window has done its one job; close it
      // quietly instead of leaving an empty composer with a toast.
      if (wasReply && isWindowMode) {
        window.close();
        return;
      }
      const posted = results.length;
      const allOk = posted >= requested;
      setToast({
        kind: allOk ? 'success' : 'error',
        message:
          requested > 1
            ? allOk
              ? `Posted to all ${requested} accounts!`
              : `Posted to ${posted} of ${requested} accounts, some failed.`
            : 'Posted to Bluesky!',
        href: results[0]?.webUrl,
      });
      textareaRef.current?.focus();
    } catch (err) {
      setToast({ kind: 'error', message: toErrorMessage(err) });
    } finally {
      setPosting(false);
    }
  }

  function requestPublish() {
    // Post stays disabled until any attached video is ready, so this is a
    // straight publish.
    if (canPost) void publish();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // The mention menu claims arrows/Enter/Tab/Escape while it is open.
    if (mentions.onKeyDown(event)) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      requestPublish();
    }
  }

  function rememberSelection() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }

  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current;
    const result = insertAtSelection(
      text,
      emoji,
      selectionRef.current.start,
      selectionRef.current.end,
    );
    selectionRef.current = { start: result.caret, end: result.caret };
    setText(result.text);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(result.caret, result.caret);
    });
  }

  // -- drafts -----------------------------------------------------------------
  const canSaveDraft =
    text.trim().length > 0 || extraPosts.length > 0 || images.length > 0 || Boolean(gif);

  async function saveCurrentDraft() {
    await addSavedDraft({
      text,
      extraPosts: extraPosts
        .map((segment) => ({
          text: segment.text,
          images: segment.images.map(toImagePayload),
        }))
        .filter((post) => post.text.trim() || post.images.length > 0),
      lang,
      images: images.map(({ base64, mime, alt, width, height }) => ({
        base64,
        mime,
        alt,
        width,
        height,
      })),
      gif,
      interaction: isDefaultInteraction(interaction) ? null : interaction,
      hadVideo: Boolean(video),
    });
    resetComposer();
    await clearDraft();
  }

  function openSavedDraft(draft: SavedDraft) {
    imagesRef.current.forEach(releaseImage);
    removeVideo();
    setReplyCtx(null);
    setImages(
      draft.images.map((image) => ({
        id: crypto.randomUUID(),
        ...image,
        previewUrl: `data:${image.mime};base64,${image.base64}`,
      })),
    );
    setExtraPosts(
      (draft.extraPosts ?? []).map((post) => {
        // Dev-era drafts stored plain strings; both shapes restore cleanly.
        const payload = typeof post === 'string' ? { text: post, images: [] } : post;
        return {
          id: crypto.randomUUID(),
          text: payload.text,
          images: (payload.images ?? []).map((image) => ({
            id: crypto.randomUUID(),
            ...image,
            previewUrl: `data:${image.mime};base64,${image.base64}`,
          })),
        };
      }),
    );
    setGif(draft.gif ?? null);
    setInteraction(draft.interaction ?? defaultInteraction());
    setText(draft.text);
    if (draft.lang) setLang(draft.lang);
    setCard(null);
    setCardLoading(false);
    dismissedUrlRef.current = null;
    requestedUrlRef.current = null;
    loadedDraftRef.current = draft.id;
    setSheet('none');
    selectionRef.current = { start: draft.text.length, end: draft.text.length };
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      el?.focus();
      el?.setSelectionRange(draft.text.length, draft.text.length);
    });
  }

  const showShareChip =
    currentTab !== null && text === '' && images.length === 0 && !gif && !video && !replyCtx;
  const firstName = (account.displayName ?? account.handle).split(/\s+/)[0] ?? '';
  const interactionLimited = !isDefaultInteraction(interaction);
  const activeSegment = activeSegmentId
    ? extraPosts.find((segment) => segment.id === activeSegmentId)
    : undefined;
  const mediaButtonDisabled = activeSegment
    ? activeSegment.images.length >= MAX_IMAGES
    : images.length >= MAX_IMAGES || Boolean(video) || Boolean(gif);
  const showLinkPreview = images.length === 0 && !gif && !video && (cardLoading || Boolean(card));
  const hasPreview = images.length > 0 || Boolean(gif) || Boolean(video) || showLinkPreview;
  const isThread = extraPosts.length > 0;

  // The root post's media (images, GIF, video, or link card). In a thread it
  // renders inline under the root text so it's clearly that post's; on a lone
  // post it drops to the full-width row just above the interaction bar.
  const rootMedia = (
    <>
      {images.length > 0 &&
        // In a thread, the root's images shrink to the same compact tiles as
        // the follow-up posts once the root loses focus, so no one post's
        // media dominates; the focused root still gets the roomy strip.
        (isThread && activeSegmentId !== null ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="list" aria-label="Attached images">
            {images.map((image) => (
              <div
                key={image.id}
                role="listitem"
                className="group relative size-16 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2"
              >
                <img
                  src={image.previewUrl}
                  alt={image.alt || 'Attached image'}
                  className="h-full w-full object-cover"
                />
                <AltBadge
                  image={image}
                  onEditAlt={(img) => setAltTarget({ kind: 'image', image: img })}
                  compact
                />
                <RemoveBadge label="Remove image" onClick={() => removeImage(image)} compact />
              </div>
            ))}
          </div>
        ) : (
          <MediaStrip
            images={images}
            onRemove={removeImage}
            onEditAlt={(image) => setAltTarget({ kind: 'image', image })}
          />
        ))}
      {gif && (
        <GifAttachment
          gif={gif}
          onEditAlt={() => setAltTarget({ kind: 'gif' })}
          onRemove={() => setGif(null)}
        />
      )}
      {video && (
        <VideoAttachment
          video={video}
          onEditAlt={() => setAltTarget({ kind: 'video' })}
          onRemove={removeVideo}
        />
      )}
      {video && videoJob?.phase === 'error' && (
        <div className="animate-fade-in mb-2 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5">
          <AlertCircleIcon size={15} className="mt-px shrink-0 text-danger" />
          <p className="min-w-0 flex-1 text-xs leading-snug text-danger">{videoJob.error}</p>
          <button
            type="button"
            onClick={() => startVideoUpload(video, videoOwnerRef.current ?? account.did)}
            className="h-6 shrink-0 cursor-pointer rounded-md px-2 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={removeVideo}
            aria-label="Dismiss"
            title="Dismiss"
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-danger/70 transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <XIcon size={13} />
          </button>
        </div>
      )}
      {showLinkPreview && cardLoading && (
        <div className="flex h-[76px] items-center justify-center gap-2 rounded-xl border border-line text-xs text-ink-faint">
          <Spinner size={13} />
          Fetching link preview…
        </div>
      )}
      {showLinkPreview && !cardLoading && card && (
        <CardPreview
          card={card}
          onDismiss={() => {
            // Closing the preview resets the draft: card AND the typed text
            // (usually just the pasted URL). Nothing stays "dismissed":
            // pasting a URL again fetches a fresh preview.
            dismissedUrlRef.current = null;
            requestedUrlRef.current = null;
            setCard(null);
            setText('');
            selectionRef.current = { start: 0, end: 0 };
            mentions.dismiss();
            textareaRef.current?.focus();
          }}
        />
      )}
    </>
  );

  return (
    <div
      className="flex flex-1 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div
        className={cx(
          'flex flex-1 flex-col px-4 pt-4 pb-1 transition-colors',
          dragOver && 'bg-accent-soft',
        )}
      >
        {replyCtx && (
          <div className="relative flex gap-3 pb-4">
            {/* Thread line from the parent's avatar down to the reply row. */}
            <div
              aria-hidden="true"
              className="absolute top-[42px] bottom-0 left-[19px] w-px bg-line"
            />
            {replyCtx.avatar ? (
              <img
                src={replyCtx.avatar}
                alt=""
                className="size-[38px] shrink-0 rounded-full border border-line object-cover"
              />
            ) : (
              <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-accent text-[15px] font-semibold text-white">
                {(replyCtx.handle[0] ?? '?').toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-start gap-1">
                <p className="min-w-0 flex-1 truncate text-[13px] leading-snug">
                  {replyCtx.displayName && (
                    <span className="font-semibold text-ink">{replyCtx.displayName} </span>
                  )}
                  <span className="text-ink-muted">@{replyCtx.handle}</span>
                </p>
                <IconButton
                  title="Cancel reply (write a new post instead)"
                  onClick={() => setReplyCtx(null)}
                  className="-mt-1 size-6 shrink-0"
                >
                  <XIcon size={12} />
                </IconButton>
              </div>
              {replyCtx.snippet && (
                <p className="mt-0.5 line-clamp-4 text-[14px] leading-snug whitespace-pre-wrap text-ink">
                  {replyCtx.snippet}
                </p>
              )}
              <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-accent">
                <ReplyBubbleIcon size={11} className="shrink-0" />
                Replying to @{replyCtx.handle}
              </p>
            </div>
          </div>
        )}

        <div className={cx('flex gap-3', extraPosts.length > 0 && 'relative pb-3')}>
          {extraPosts.length > 0 && (
            <div
              aria-hidden="true"
              className="absolute top-[46px] bottom-0 left-[19px] w-px bg-line"
            />
          )}
          <PostTargets
            accounts={accounts}
            active={account}
            targets={targets}
            onChange={setTargets}
            locked={Boolean(video)}
          />
          <div className="min-w-0 flex-1">
            <div className="relative">
              <HighlightOverlay text={text} />
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  mentions.sync();
                }}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                onFocus={() => setActiveSegmentId(null)}
                onSelect={() => {
                  rememberSelection();
                  mentions.sync();
                }}
                onBlur={() => mentions.dismiss()}
                onScroll={() => {
                  const overlay = textareaRef.current?.parentElement?.querySelector('.highlight-overlay');
                  if (overlay && textareaRef.current) {
                    overlay.scrollTop = textareaRef.current.scrollTop;
                  }
                }}
                placeholder={
                  replyCtx
                    ? 'Write your reply'
                    : targets.length > 1
                      ? "What's on your mind?"
                      : `What's up, ${firstName}?`
                }
                rows={replyCtx || extraPosts.length > 0 ? 2 : 5}
                className={cx(
                  'relative z-10 max-h-[280px] w-full resize-none bg-transparent pt-1.5 text-[15px] leading-relaxed text-transparent caret-ink outline-none placeholder:text-ink-faint',
                  // Replies and threads hug their content; a lone post keeps
                  // the roomy canvas.
                  replyCtx || extraPosts.length > 0 ? 'min-h-[52px]' : 'min-h-[150px]',
                )}
              />
              {mentions.menu}
            </div>

            {showShareChip && (
              <button
                type="button"
                onClick={() => {
                  setText(currentTab.url);
                  selectionRef.current = {
                    start: currentTab.url.length,
                    end: currentTab.url.length,
                  };
                }}
                title={currentTab.url}
                className="mb-2 flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pr-3 pl-2 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                <LinkIcon size={12} className="shrink-0" />
                <span className="truncate">Share “{truncateToGraphemes(currentTab.title, 44)}”</span>
              </button>
            )}

            {isThread && hasPreview && <div className="mt-1.5">{rootMedia}</div>}
          </div>
        </div>

        {/* Follow-up posts render exactly like the root: an avatar row per
            post, chained by the thread line, each with its own images. */}
        {extraPosts.map((segment, index) => (
          <ThreadSegmentEditor
            key={segment.id}
            segment={segment}
            account={account}
            isLast={index === extraPosts.length - 1}
            active={segment.id === activeSegmentId}
            autoFocus={segment.id === focusSegmentId}
            onFocus={() => setActiveSegmentId(segment.id)}
            onChange={updateThreadPost}
            onRemove={removeThreadPost}
            onAddImages={addSegmentImages}
            onRemoveImage={removeSegmentImage}
            onEditAlt={(image) => setAltTarget({ kind: 'image', image, segmentId: segment.id })}
          />
        ))}
        {!replyCtx && composerDirty && extraPosts.length + 1 < MAX_THREAD_POSTS && (
          <button
            type="button"
            onClick={addThreadPost}
            className="mb-1 ml-[50px] inline-flex h-7 w-fit cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
          >
            <PlusIcon size={13} />
            {extraPosts.length > 0 ? 'Add another post' : 'Add to thread'}
          </button>
        )}

        {/* On a lone post the attachments drop to the bottom, just above the
            interaction bar; a thread keeps them inline under the root text. */}
        {!isThread && hasPreview && <div className="mt-auto pt-2">{rootMedia}</div>}
      </div>

      <div
        className={cx(
          'flex items-center gap-2 px-3 pb-2',
          replyCtx && !(video && videoJob) && 'hidden',
        )}
      >
        {!replyCtx && (
        <button
          type="button"
          onClick={() => setSheet('interaction')}
          aria-haspopup="dialog"
          title="Choose who can reply and quote"
          className={cx(
            'inline-flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
            interactionLimited
              ? 'border-transparent bg-accent-soft text-accent hover:brightness-105'
              : 'border-line text-accent hover:bg-accent-soft',
          )}
        >
          {interactionLimited ? (
            <UsersIcon size={13} className="shrink-0" />
          ) : (
            <GlobeIcon size={13} className="shrink-0" />
          )}
          <span className="truncate">{summarizeInteraction(interaction)}</span>
          <ChevronDownIcon size={12} className="shrink-0 text-ink-faint" />
        </button>
        )}

        <div className="flex-1" />

        {/* Video progress floats here, opposite the interaction pill; a failed
            upload is shown by the dismissible banner under the video instead. */}
        {video && videoJob && videoJob.phase !== 'error' && (
          <VideoUploadPill
            job={videoJob}
            onRetry={() => startVideoUpload(video, videoOwnerRef.current ?? account.did)}
          />
        )}
      </div>

      <footer className="flex items-center gap-1 border-t border-line px-3 py-2.5">
        <input
          ref={fileInputRef}
          type="file"
          // Follow-up posts take photos only; the root may also take a video.
          accept={
            activeSegment ? IMAGE_INPUT_ACCEPT : `${IMAGE_INPUT_ACCEPT},${VIDEO_INPUT_ACCEPT}`
          }
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handlePickedFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <IconButton
          title={activeSegment ? 'Add photos to the selected post' : 'Add photos or a video'}
          disabled={mediaButtonDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon />
        </IconButton>

        <GifPicker disabled={images.length > 0 || Boolean(video)} onSelect={attachGif} />

        <EmojiPicker onOpen={rememberSelection} onSelect={insertEmoji} />

        <LanguagePicker value={lang} onChange={setLang} />

        <div className="flex-1" />

        {remaining < 0 && extraPosts.length === 0 && (
          <button
            type="button"
            onClick={splitRootIntoThread}
            title="Split this text into a thread at natural breaks"
            className="h-7 shrink-0 cursor-pointer rounded-lg bg-accent-soft px-2 text-[11px] font-semibold text-accent transition-[filter] hover:brightness-105"
          >
            Split into thread
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
          onClick={requestPublish}
          disabled={!canPost}
          title={
            videoNotReady
              ? 'Post once the video finishes uploading'
              : `${replyCtx ? 'Reply' : 'Post'} (Ctrl+Enter)`
          }
          className="btn btn-primary relative ml-1.5 h-8 gap-1.5 px-4"
        >
          {posting && (
            <span className="absolute inset-0 grid place-items-center">
              <Spinner size={14} />
            </span>
          )}
          <span className={cx(posting && 'invisible')}>
            {replyCtx ? 'Reply' : extraPosts.length > 0 ? 'Post all' : 'Post'}
          </span>
        </button>
      </footer>

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}

      {sheet === 'interaction' && (
        <InteractionSheet
          settings={interaction}
          onChange={setInteraction}
          onClose={() => setSheet('none')}
        />
      )}

      {sheet === 'drafts' && (
        <DraftsSheet
          composerDirty={composerDirty}
          canSaveCurrent={canSaveDraft}
          onSaveCurrent={saveCurrentDraft}
          onLoad={openSavedDraft}
          onClose={() => setSheet('none')}
        />
      )}

      {altTarget && (
        <AltTextEditor
          previewUrl={
            altTarget.kind === 'image'
              ? altTarget.image.previewUrl
              : altTarget.kind === 'gif'
                ? (gif?.previewUrl ?? '')
                : (video?.previewUrl ?? '')
          }
          mediaKind={altTarget.kind}
          initial={
            altTarget.kind === 'image'
              ? altTarget.image.alt
              : altTarget.kind === 'gif'
                ? (gif?.alt ?? '')
                : (video?.alt ?? '')
          }
          onSave={(alt) => {
            if (altTarget.kind === 'image') {
              const target = altTarget.image;
              const segmentId = altTarget.segmentId;
              if (segmentId) {
                setExtraPosts((prev) =>
                  prev.map((segment) =>
                    segment.id === segmentId
                      ? {
                          ...segment,
                          images: segment.images.map((item) =>
                            item.id === target.id ? { ...item, alt } : item,
                          ),
                        }
                      : segment,
                  ),
                );
              } else {
                setImages((prev) =>
                  prev.map((item) => (item.id === target.id ? { ...item, alt } : item)),
                );
              }
            } else if (altTarget.kind === 'gif') {
              setGif((prev) => (prev ? { ...prev, alt } : prev));
            } else {
              setVideo((prev) => (prev ? { ...prev, alt } : prev));
            }
            setAltTarget(null);
          }}
          onClose={() => setAltTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LanguagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select
      value={value}
      options={LANGUAGES}
      onChange={onChange}
      variant="pill"
      placement="top"
      icon={<GlobeIcon size={16} className="shrink-0" />}
      ariaLabel="Post language"
      title="Post language"
    />
  );
}

// ---------------------------------------------------------------------------

/**
 * The composer avatar doubles as the cross-post picker: one account shows just
 * the avatar; with several signed in, clicking opens a toggle list and the
 * selected accounts appear as an overlapping stack of bubbles. While a video
 * is attached the picker locks, since video uploads are per-account.
 */
function PostTargets({
  accounts,
  active,
  targets,
  onChange,
  locked,
}: {
  accounts: AccountSnapshot[];
  active: AccountSnapshot;
  targets: string[];
  onChange: (dids: string[]) => void;
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  if (accounts.length < 2 || locked) {
    return (
      <span title={locked ? 'Video posts go out as one account' : undefined}>
        <Avatar src={active.avatar} name={active.displayName ?? active.handle} size={38} />
      </span>
    );
  }

  // Selected accounts in target order; the first is the primary poster.
  const chosen = targets
    .map((did) => accounts.find((item) => item.did === did))
    .filter((item): item is AccountSnapshot => Boolean(item));
  const stack = chosen.length > 0 ? chosen : [active];
  const avatarSize = stack.length >= 3 ? 27 : stack.length === 2 ? 31 : 38;

  function toggle(did: string) {
    const next = targets.includes(did)
      ? targets.filter((value) => value !== did)
      : accounts.filter((item) => item.did === did || targets.includes(item.did)).map((item) => item.did);
    if (next.length > 0) onChange(next); // never let the selection fall empty
  }

  return (
    // self-start keeps this wrapper avatar-height so the popover anchors right
    // under the bubbles instead of the full (stretched) composer row.
    <div className="relative shrink-0 self-start" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Choose accounts to post to"
        aria-label="Choose accounts to post to"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="relative flex cursor-pointer items-center rounded-full outline-none transition-transform focus-visible:shadow-[0_0_0_2px_var(--ss-accent)] active:scale-95"
      >
        {stack.map((item, index) => (
          <span
            key={item.did}
            className={cx('rounded-full', index > 0 && '-ml-2.5 ring-2 ring-canvas')}
            style={{ zIndex: stack.length - index }}
          >
            <Avatar src={item.avatar} name={item.displayName ?? item.handle} size={avatarSize} />
          </span>
        ))}
        <span
          aria-hidden="true"
          className="absolute -right-1 -bottom-1 z-10 flex size-[17px] items-center justify-center rounded-full border border-line bg-surface text-ink-muted shadow-[0_0_0_2px_var(--ss-canvas)]"
        >
          <ChevronDownIcon size={10} className="block" />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Post to"
          className="menu-pop animate-slide-down absolute top-full left-0 z-40 mt-2 w-60"
        >
          <p className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
            Post to
          </p>
          {accounts.map((item) => {
            const checked = targets.includes(item.did);
            return (
              <button
                key={item.did}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggle(item.did)}
                className="menu-item"
              >
                <Avatar src={item.avatar} name={item.displayName ?? item.handle} size={26} />
                <span
                  className={cx(
                    'min-w-0 flex-1 truncate text-[13px]',
                    checked ? 'font-medium text-ink' : 'text-ink-muted',
                  )}
                >
                  @{item.handle}
                </span>
                <span
                  className={cx(
                    'grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors',
                    checked
                      ? 'border-transparent bg-accent text-white'
                      : 'border-line-strong text-transparent',
                  )}
                >
                  <CheckIcon size={11} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * One follow-up post in the thread, laid out exactly like the root post (the
 * pattern X, Bluesky, and Threads share): your avatar on the thread line, a
 * borderless editor beside it, and the post's own images underneath.
 */
function ThreadSegmentEditor({
  segment,
  account,
  isLast,
  active,
  autoFocus,
  onFocus,
  onChange,
  onRemove,
  onAddImages,
  onRemoveImage,
  onEditAlt,
}: {
  segment: ThreadSegment;
  account: AccountSnapshot;
  isLast: boolean;
  /** This post is where the footer's media button currently lands. */
  active: boolean;
  /** Grab the cursor on mount (a just-added post). */
  autoFocus?: boolean;
  onFocus: () => void;
  onChange: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onAddImages: (id: string, files: Iterable<File>) => Promise<void>;
  onRemoveImage: (id: string, image: PreparedImage) => void;
  onEditAlt: (image: PreparedImage) => void;
}) {
  const graphemes = graphemeLength(segment.text);
  const remaining = MAX_GRAPHEMES - graphemes;
  const autosize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  return (
    <div className={cx('relative flex gap-3', !isLast ? 'pb-3' : 'pb-1')}>
      {!isLast && (
        <div aria-hidden="true" className="absolute top-[46px] bottom-0 left-[19px] w-px bg-line" />
      )}
      <span className={cx('h-fit rounded-full', active && 'ring-2 ring-accent/45')}>
        <Avatar src={account.avatar} name={account.displayName ?? account.handle} size={38} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1">
          <textarea
            ref={autosize}
            value={segment.text}
            autoFocus={autoFocus}
            onFocus={onFocus}
            onChange={(event) => {
              onChange(segment.id, event.target.value);
              autosize(event.currentTarget);
            }}
            onPaste={(event) => {
              const files = event.clipboardData?.files;
              if (files && files.length > 0) {
                event.preventDefault();
                void onAddImages(segment.id, files);
              }
            }}
            rows={1}
            placeholder="Write another post"
            className="min-h-[38px] w-full flex-1 resize-none bg-transparent pt-1.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
          />
          <IconButton
            title="Remove this post"
            onClick={() => onRemove(segment.id)}
            className="mt-1 size-6 shrink-0 text-ink-faint hover:text-ink"
          >
            <XIcon size={12} />
          </IconButton>
        </div>

        {segment.images.length > 0 && (
          <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
            {segment.images.map((image) => (
              <div
                key={image.id}
                className="group relative size-16 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2"
              >
                <img
                  src={image.previewUrl}
                  alt={image.alt || 'Attached image'}
                  className="h-full w-full object-cover"
                />
                <AltBadge image={image} onEditAlt={onEditAlt} compact />
                <RemoveBadge
                  label="Remove image"
                  onClick={() => onRemoveImage(segment.id, image)}
                  compact
                />
              </div>
            ))}
          </div>
        )}

        {remaining <= 60 && (
          <div className="flex justify-end">
            <span
              className={cx(
                'text-[10px] font-medium tabular-nums',
                remaining < 0 ? 'text-danger' : 'text-ink-faint',
              )}
            >
              {remaining}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Attached images. A single image gets a large shrink-wrapped preview; two or
 * more become a horizontally scrolling strip of square tiles (the pattern the
 * official composer uses, which keeps 10 images workable in a popup). More
 * images are added from the toolbar's photo button.
 */
function MediaStrip({
  images,
  onRemove,
  onEditAlt,
}: {
  images: PreparedImage[];
  onRemove: (image: PreparedImage) => void;
  onEditAlt: (image: PreparedImage) => void;
}) {
  const single = images.length === 1 ? images[0] : undefined;
  if (single) {
    const image = single;
    return (
      <div className="mb-2 grid grid-cols-1 gap-1.5">
        <div className="group relative mr-auto w-fit max-w-full overflow-hidden rounded-xl border border-line bg-surface-2">
          <img
            src={image.previewUrl}
            alt={image.alt || 'Attached image'}
            className="block max-h-52 min-h-[60px] w-auto max-w-full object-contain"
          />
          <AltBadge image={image} onEditAlt={onEditAlt} />
          <RemoveBadge label="Remove image" onClick={() => onRemove(image)} />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 flex snap-x gap-1.5 overflow-x-auto pb-1" role="list" aria-label="Attached images">
      {images.map((image) => (
        <div
          key={image.id}
          role="listitem"
          className="group relative size-[112px] shrink-0 snap-start overflow-hidden rounded-xl border border-line bg-surface-2"
        >
          <img
            src={image.previewUrl}
            alt={image.alt || 'Attached image'}
            className="h-full w-full object-cover"
          />
          <AltBadge image={image} onEditAlt={onEditAlt} compact />
          <RemoveBadge label="Remove image" onClick={() => onRemove(image)} compact />
        </div>
      ))}
    </div>
  );
}

function AltBadge({
  image,
  onEditAlt,
  compact,
}: {
  image: PreparedImage;
  onEditAlt: (image: PreparedImage) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={image.alt ? 'Edit alt text' : 'Add alt text'}
      onClick={() => onEditAlt(image)}
      className={cx(
        'absolute bottom-1.5 left-1.5 flex cursor-pointer items-center gap-0.5 rounded-md bg-black/65 font-bold tracking-wide text-white backdrop-blur-sm transition-colors hover:bg-black/85',
        compact ? 'h-[18px] px-1 text-[9px]' : 'h-5 px-1.5 text-[10px]',
      )}
    >
      {image.alt && <CheckIcon size={compact ? 9 : 10} />}
      ALT
    </button>
  );
}

function RemoveBadge({
  label,
  onClick,
  compact,
}: {
  label: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx(
        'absolute top-1.5 right-1.5 grid cursor-pointer place-items-center rounded-full bg-black/65 text-white backdrop-blur-sm transition-colors hover:bg-black/85',
        compact ? 'size-5' : 'size-6',
      )}
    >
      <XIcon size={compact ? 11 : 13} />
    </button>
  );
}

// ---------------------------------------------------------------------------

function GifAttachment({
  gif,
  onEditAlt,
  onRemove,
}: {
  gif: AttachedGif;
  onEditAlt: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="animate-fade-in relative mr-auto mb-2 w-fit max-w-full overflow-hidden rounded-xl border border-line bg-surface-2">
      <img
        src={gif.previewUrl}
        alt={gif.alt || gif.title}
        className="block max-h-44 min-h-[60px] w-auto max-w-full object-contain"
      />
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
        <span className="flex h-5 items-center rounded-md bg-black/65 px-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm">
          GIF
        </span>
        <button
          type="button"
          title={gif.alt ? 'Edit alt text' : 'Add alt text'}
          onClick={onEditAlt}
          className="flex h-5 cursor-pointer items-center gap-0.5 rounded-md bg-black/65 px-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm transition-colors hover:bg-black/85"
        >
          {gif.alt && <CheckIcon size={10} />}
          ALT
        </button>
      </div>
      <RemoveBadge label="Remove GIF" onClick={onRemove} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function VideoAttachment({
  video,
  onEditAlt,
  onRemove,
}: {
  video: PreparedVideo;
  onEditAlt: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="animate-fade-in relative mr-auto mb-2 w-fit max-w-full overflow-hidden rounded-xl border border-line bg-black">
      {/* No native player chrome: autoplays muted on a loop like the official
          composer. The remove button and the floating upload pill (in the
          interaction bar) are the only controls. */}
      <video
        src={video.previewUrl}
        autoPlay
        loop
        muted
        playsInline
        className="block max-h-52 min-h-[60px] w-auto max-w-full object-contain"
      />
      <button
        type="button"
        title={video.alt ? 'Edit alt text' : 'Add alt text'}
        onClick={onEditAlt}
        className="absolute bottom-1.5 left-1.5 flex h-5 cursor-pointer items-center gap-0.5 rounded-md bg-black/65 px-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm transition-colors hover:bg-black/85"
      >
        {video.alt && <CheckIcon size={10} />}
        ALT
      </button>
      <RemoveBadge label="Remove video" onClick={onRemove} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Link preview styled like the card Bluesky renders on the published post:
 * full-width image on top (when the site provides one), text block below.
 */
function CardPreview({ card, onDismiss }: { card: LinkCardData; onDismiss: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(card.imageUrl) && !imageFailed;
  return (
    <div className="animate-fade-in relative mb-2 overflow-hidden rounded-xl border border-line bg-surface">
      {showImage && (
        <img
          src={card.imageUrl}
          alt=""
          onError={() => setImageFailed(true)}
          className="aspect-[1.91/1] w-full border-b border-line bg-surface-2 object-cover"
        />
      )}
      <div className={cx('px-3.5 py-2.5', !showImage && 'pr-10')}>
        <p className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
          {domainOf(card.url)}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[13px] font-semibold text-ink">{card.title}</p>
        {card.description && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink-muted">
            {card.description}
          </p>
        )}
      </div>
      <button
        type="button"
        title="Remove link preview"
        onClick={onDismiss}
        className="absolute top-2 right-2 grid size-6 cursor-pointer place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/85"
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  // Keep the latest dismiss handler without making it a timer dependency, so
  // unrelated re-renders (e.g. typing) never restart the countdown.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    // Every toast closes itself after a short, uniform delay.
    const timer = setTimeout(() => dismissRef.current(), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const success = toast.kind === 'success';
  return (
    <div className="animate-slide-up fixed inset-x-3 bottom-3 z-50">
      <div className="flex items-center gap-2.5 rounded-[14px] border border-line bg-surface py-2.5 pr-2.5 pl-3.5 shadow-[var(--ss-shadow-pop)]">
        {success ? (
          <CheckIcon size={15} strokeWidth={2.5} className="shrink-0 text-success" />
        ) : (
          <AlertCircleIcon size={15} strokeWidth={2.2} className="shrink-0 text-danger" />
        )}
        <p className="min-w-0 flex-1 text-[13px] leading-snug font-medium text-ink">
          {toast.message}
        </p>
        {toast.href && (
          <a
            href={toast.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 shrink-0 items-center rounded-lg bg-surface-2 px-2.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-3"
          >
            View
          </a>
        )}
        <button
          type="button"
          title="Dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg bg-surface-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <XIcon size={13} />
        </button>
      </div>
    </div>
  );
}

const MAX_ALT_LENGTH = 2000;

function AltTextEditor({
  previewUrl,
  mediaKind,
  initial,
  onSave,
  onClose,
}: {
  previewUrl: string;
  mediaKind: 'image' | 'gif' | 'video';
  initial: string;
  onSave: (alt: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const noun = mediaKind === 'video' ? 'video' : mediaKind === 'gif' ? 'GIF' : 'image';
  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end bg-black/45"
      onClick={onClose}
      role="dialog"
      aria-label="Edit alt text"
    >
      <div className="card animate-slide-up m-2 w-full p-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Describe this {noun}</h3>
          <IconButton
            title="Close"
            onClick={onClose}
            className="size-7 bg-surface-2 hover:bg-surface-3"
          >
            <XIcon size={14} />
          </IconButton>
        </div>
        {mediaKind === 'video' ? (
          <video
            src={previewUrl}
            muted
            playsInline
            preload="metadata"
            className="mt-2.5 max-h-32 w-full rounded-lg bg-black object-contain"
          />
        ) : (
          <img
            src={previewUrl}
            alt=""
            className="mt-2.5 max-h-32 w-full rounded-lg bg-surface-2 object-contain"
          />
        )}
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_ALT_LENGTH))}
          placeholder={`Alt text helps people using screen readers see your ${noun}.`}
          rows={3}
          autoFocus
          className="input mt-2.5 h-auto resize-none py-2.5 leading-snug"
        />
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[11px] text-ink-faint">
            {value.length}/{MAX_ALT_LENGTH}
          </span>
          <button type="button" className="btn btn-primary h-8 px-4" onClick={() => onSave(value)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Regex to find @mentions and http(s) URLs for accent highlighting. */
const HIGHLIGHT_RE = /(@[\w.-]+(?:\.[\w.-]+)*)|https?:\/\/[^\s<>[\]{}'"]+/g;

function highlightText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(HIGHLIGHT_RE)) {
    const start = match.index;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    parts.push(
      <span key={start} className="text-accent">
        {match[0]}
      </span>,
    );
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  // Trailing newline: textarea always reserves a line for it, so the overlay
  // must too, otherwise scrollHeight drifts and the highlight misaligns.
  if (text.endsWith('\n') || text === '') parts.push('\n');
  return parts;
}

function HighlightOverlay({ text }: { text: string }) {
  return (
    <div
      aria-hidden="true"
      className="highlight-overlay pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pt-1.5 text-[15px] leading-relaxed text-ink"
      style={{ wordBreak: 'break-word' }}
    >
      {highlightText(text)}
    </div>
  );
}
