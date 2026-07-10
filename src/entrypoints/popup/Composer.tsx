import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { browser } from 'wxt/browser';
import { EmojiPicker } from '@/components/EmojiPicker';
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  XIcon,
} from '@/components/icons';
import { Avatar, IconButton, Spinner, cx } from '@/components/ui';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft';
import { toErrorMessage } from '@/lib/errors';
import {
  IMAGE_INPUT_ACCEPT,
  MAX_IMAGES,
  prepareImage,
  releaseImage,
  type PreparedImage,
} from '@/lib/images';
import { LANGUAGES } from '@/lib/languages';
import { sendMessage } from '@/lib/messaging';
import { loadSettings } from '@/lib/settings';
import { takePendingShare } from '@/lib/share';
import {
  MAX_GRAPHEMES,
  buildShareText,
  graphemeLength,
  insertAtSelection,
  truncateToGraphemes,
} from '@/lib/text';
import { domainOf, extractFirstUrl } from '@/lib/urls';
import type { AccountSnapshot, LinkCardData } from '@/lib/types';

interface ToastState {
  kind: 'success' | 'error';
  message: string;
  href?: string;
}

export function Composer({ account }: { account: AccountSnapshot }) {
  const [booted, setBooted] = useState(false);
  const [text, setText] = useState('');
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [card, setCard] = useState<LinkCardData | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [lang, setLang] = useState('en');
  const [autoCard, setAutoCard] = useState(true);
  const [posting, setPosting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [altTarget, setAltTarget] = useState<PreparedImage | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [currentTab, setCurrentTab] = useState<{ url: string; title: string } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dismissedUrlRef = useRef<string | null>(null);
  const requestedUrlRef = useRef<string | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // -- boot: settings, pending share or saved draft, current tab ------------
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const settings = await loadSettings();
      const share = await takePendingShare();
      const initialText = share ? buildShareText(share) : ((await loadDraft()) ?? '');
      if (!mounted) return;
      setLang(settings.defaultLang);
      setAutoCard(settings.autoLinkCard);
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

  // Release preview object URLs when the popup closes.
  useEffect(() => {
    return () => imagesRef.current.forEach(releaseImage);
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
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text]);

  // -- draft autosave ---------------------------------------------------------
  useEffect(() => {
    if (!booted) return;
    const timer = setTimeout(() => void saveDraft(text), 400);
    return () => clearTimeout(timer);
  }, [text, booted]);

  // -- link card detection ----------------------------------------------------
  const detectedUrl = useMemo(() => extractFirstUrl(text), [text]);

  useEffect(() => {
    if (!booted || !autoCard || images.length > 0) return;
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
  }, [detectedUrl, autoCard, images.length, booted]);

  // -- images -----------------------------------------------------------------
  const addFiles = useCallback(async (files: Iterable<File>) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const room = MAX_IMAGES - imagesRef.current.length;
    if (room <= 0) {
      setToast({ kind: 'error', message: `You can attach up to ${MAX_IMAGES} images.` });
      return;
    }
    for (const file of list.slice(0, room)) {
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
    if (list.length > room) {
      setToast({ kind: 'error', message: `Only ${MAX_IMAGES} images fit on a post.` });
    }
  }, []);

  function removeImage(image: PreparedImage) {
    releaseImage(image);
    setImages((prev) => prev.filter((item) => item.id !== image.id));
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

  // -- publish ----------------------------------------------------------------
  const graphemes = useMemo(() => graphemeLength(text), [text]);
  const remaining = MAX_GRAPHEMES - graphemes;
  const canPost = !posting && remaining >= 0 && (text.trim().length > 0 || images.length > 0);

  async function publish() {
    if (!canPost) return;
    setPosting(true);
    setToast(null);
    try {
      const result = await sendMessage('post:publish', {
        text,
        langs: lang ? [lang] : undefined,
        images: images.map(({ base64, mime, alt, width, height }) => ({
          base64,
          mime,
          alt,
          width,
          height,
        })),
        card: images.length === 0 ? card : null,
      });
      images.forEach(releaseImage);
      setImages([]);
      setText('');
      selectionRef.current = { start: 0, end: 0 };
      setCard(null);
      dismissedUrlRef.current = null;
      requestedUrlRef.current = null;
      await clearDraft();
      setToast({ kind: 'success', message: 'Posted to Bluesky!', href: result.webUrl });
      textareaRef.current?.focus();
    } catch (err) {
      setToast({ kind: 'error', message: toErrorMessage(err) });
    } finally {
      setPosting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void publish();
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

  const showShareChip = currentTab !== null && text === '' && images.length === 0;
  const firstName = (account.displayName ?? account.handle).split(/\s+/)[0] ?? '';

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
          'flex flex-1 gap-3 px-4 pt-4 pb-1 transition-colors',
          dragOver && 'bg-accent-soft',
        )}
      >
        <Avatar src={account.avatar} name={account.displayName ?? account.handle} size={38} />
        <div className="min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            onSelect={rememberSelection}
            placeholder={`What’s up, ${firstName}?`}
            rows={5}
            className="max-h-[280px] min-h-[150px] w-full resize-none bg-transparent pt-1.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
          />

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

          {images.length > 0 && (
            <ImageGrid images={images} onRemove={removeImage} onEditAlt={setAltTarget} />
          )}

          {images.length === 0 && cardLoading && (
            <div className="mt-1 mb-2 flex h-[76px] items-center justify-center gap-2 rounded-xl border border-line text-xs text-ink-faint">
              <Spinner size={13} />
              Fetching link preview…
            </div>
          )}

          {images.length === 0 && !cardLoading && card && (
            <CardPreview
              card={card}
              onDismiss={() => {
                dismissedUrlRef.current = requestedUrlRef.current;
                setCard(null);
              }}
            />
          )}
        </div>
      </div>

      <footer className="flex items-center gap-1 border-t border-line px-3 py-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_INPUT_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <IconButton
          title="Add images"
          disabled={images.length >= MAX_IMAGES}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon />
        </IconButton>

        <EmojiPicker onOpen={rememberSelection} onSelect={insertEmoji} />

        <LanguagePicker value={lang} onChange={setLang} />

        <div className="flex-1" />

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

        <button
          type="button"
          onClick={() => void publish()}
          disabled={!canPost}
          title="Post (Ctrl+Enter)"
          className="btn btn-primary ml-1.5 h-8 gap-1.5 px-4"
        >
          {posting && <Spinner size={13} />}
          Post
        </button>
      </footer>

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}

      {altTarget && (
        <AltTextEditor
          image={altTarget}
          onSave={(alt) => {
            setImages((prev) =>
              prev.map((item) => (item.id === altTarget.id ? { ...item, alt } : item)),
            );
            setAltTarget(null);
          }}
          onClose={() => setAltTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CharRing({ graphemes }: { graphemes: number }) {
  const radius = 8.5;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(graphemes / MAX_GRAPHEMES, 1);
  const color =
    graphemes > MAX_GRAPHEMES
      ? 'var(--ss-danger)'
      : graphemes > MAX_GRAPHEMES - 40
        ? 'var(--ss-warning)'
        : 'var(--ss-accent)';
  return (
    <svg width={22} height={22} viewBox="0 0 22 22" aria-hidden="true" className="mx-1 shrink-0">
      <circle cx="11" cy="11" r={radius} stroke="var(--ss-line)" strokeWidth="2.5" fill="none" />
      <circle
        cx="11"
        cy="11"
        r={radius}
        stroke={color}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference * ratio} ${circumference}`}
        transform="rotate(-90 11 11)"
        style={{ transition: 'stroke-dasharray 120ms linear, stroke 200ms' }}
      />
    </svg>
  );
}

function LanguagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative" title="Post language">
      <GlobeIcon
        size={14}
        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-muted"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Post language"
        className="h-8 max-w-[130px] cursor-pointer appearance-none truncate rounded-lg bg-transparent pr-6 pl-7 text-xs font-medium text-ink-muted transition-colors outline-none hover:bg-surface-2 hover:text-ink"
      >
        {LANGUAGES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon
        size={12}
        className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
}

function ImageGrid({
  images,
  onRemove,
  onEditAlt,
}: {
  images: PreparedImage[];
  onRemove: (image: PreparedImage) => void;
  onEditAlt: (image: PreparedImage) => void;
}) {
  return (
    <div className={cx('mb-2 grid gap-1.5', images.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
      {images.map((image) => (
        <div
          key={image.id}
          className="group relative overflow-hidden rounded-xl border border-line bg-surface-2"
        >
          <img
            src={image.previewUrl}
            alt={image.alt || 'Attached image'}
            className={cx('w-full object-cover', images.length === 1 ? 'max-h-44' : 'h-24')}
          />
          <button
            type="button"
            title={image.alt ? 'Edit alt text' : 'Add alt text'}
            onClick={() => onEditAlt(image)}
            className="absolute bottom-1.5 left-1.5 flex h-5 cursor-pointer items-center gap-0.5 rounded-md bg-black/65 px-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm transition-colors hover:bg-black/85"
          >
            {image.alt && <CheckIcon size={10} />}
            ALT
          </button>
          <button
            type="button"
            title="Remove image"
            onClick={() => onRemove(image)}
            className="absolute top-1.5 right-1.5 grid size-6 cursor-pointer place-items-center rounded-full bg-black/65 text-white backdrop-blur-sm transition-colors hover:bg-black/85"
          >
            <XIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function CardPreview({ card, onDismiss }: { card: LinkCardData; onDismiss: () => void }) {
  return (
    <div className="animate-fade-in relative mt-1 mb-2 flex overflow-hidden rounded-xl border border-line">
      {card.imageUrl && (
        <img
          src={card.imageUrl}
          alt=""
          className="h-[76px] w-[76px] shrink-0 bg-surface-2 object-cover"
        />
      )}
      <div className="min-w-0 flex-1 px-3 py-2">
        <p className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
          {domainOf(card.url)}
        </p>
        <p className="mt-0.5 truncate text-[13px] font-medium text-ink">{card.title}</p>
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
        className="absolute top-1.5 right-1.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    if (toast.kind !== 'success') return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div className="animate-slide-up fixed inset-x-3 bottom-3 z-50">
      <div className="card flex items-center gap-2.5 px-3.5 py-3">
        <span
          className={cx(
            'grid size-7 shrink-0 place-items-center rounded-full',
            toast.kind === 'success'
              ? 'bg-success-soft text-success'
              : 'bg-danger-soft text-danger',
          )}
        >
          {toast.kind === 'success' ? <CheckIcon size={14} /> : <AlertCircleIcon size={14} />}
        </span>
        <p className="flex-1 text-[13px] leading-snug text-ink">{toast.message}</p>
        {toast.href && (
          <a
            href={toast.href}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-semibold whitespace-nowrap text-accent hover:underline"
          >
            View ↗
          </a>
        )}
        <IconButton title="Dismiss" onClick={onDismiss} className="size-6">
          <XIcon size={13} />
        </IconButton>
      </div>
    </div>
  );
}

function AltTextEditor({
  image,
  onSave,
  onClose,
}: {
  image: PreparedImage;
  onSave: (alt: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(image.alt);
  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end bg-black/45"
      onClick={onClose}
      role="dialog"
      aria-label="Edit alt text"
    >
      <div className="card animate-slide-up m-2 w-full p-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Describe this image</h3>
          <IconButton title="Close" onClick={onClose} className="size-7">
            <XIcon size={14} />
          </IconButton>
        </div>
        <img
          src={image.previewUrl}
          alt=""
          className="mt-2.5 max-h-32 w-full rounded-lg bg-surface-2 object-contain"
        />
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 1000))}
          placeholder="Alt text helps people using screen readers see your image."
          rows={3}
          autoFocus
          className="input mt-2.5 h-auto resize-none py-2.5 leading-snug"
        />
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[11px] text-ink-faint">{value.length}/1000</span>
          <button type="button" className="btn btn-primary h-8 px-4" onClick={() => onSave(value)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
