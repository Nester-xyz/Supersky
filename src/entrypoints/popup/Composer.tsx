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
import { EmojiPicker } from '@/components/EmojiPicker';
import { useMentionAutocomplete } from '@/components/MentionAutocomplete';
import { Select } from '@/components/Select';
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
  replaceRange,
  truncateToGraphemes,
} from '@/lib/text';
import { domainOf, extractFirstUrl } from '@/lib/urls';
import type { AccountSnapshot, LinkCardData } from '@/lib/types';

interface ToastState {
  kind: 'success' | 'error';
  message: string;
  href?: string;
}

export function Composer({
  account,
  accounts,
}: {
  account: AccountSnapshot;
  accounts: AccountSnapshot[];
}) {
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
  // Which accounts this draft posts as; defaults to the active one, reset when
  // the active account changes from the header switcher.
  const [targets, setTargets] = useState<string[]>([account.did]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dismissedUrlRef = useRef<string | null>(null);
  const requestedUrlRef = useRef<string | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const imagesRef = useRef(images);
  imagesRef.current = images;

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
    const requested = targets.length || 1;
    try {
      const results = await sendMessage('post:publish', {
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
        dids: targets,
      });
      images.forEach(releaseImage);
      setImages([]);
      setText('');
      selectionRef.current = { start: 0, end: 0 };
      mentions.dismiss();
      setCard(null);
      dismissedUrlRef.current = null;
      requestedUrlRef.current = null;
      await clearDraft();
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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // The mention menu claims arrows/Enter/Tab/Escape while it is open.
    if (mentions.onKeyDown(event)) return;
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
        <PostTargets
          accounts={accounts}
          active={account}
          targets={targets}
          onChange={setTargets}
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
              placeholder={targets.length > 1 ? "What's on your mind?" : `What's up, ${firstName}?`}
              rows={5}
              className="relative z-10 max-h-[280px] min-h-[150px] w-full resize-none bg-transparent pt-1.5 text-[15px] leading-relaxed text-transparent caret-ink outline-none placeholder:text-ink-faint"
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
          onClick={() => void publish()}
          disabled={!canPost}
          title="Post (Ctrl+Enter)"
          className="btn btn-primary relative ml-1.5 h-8 gap-1.5 px-4"
        >
          {posting && (
            <span className="absolute inset-0 grid place-items-center">
              <Spinner size={14} />
            </span>
          )}
          <span className={cx(posting && 'invisible')}>Post</span>
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
 * selected accounts appear as an overlapping stack of bubbles.
 */
function PostTargets({
  accounts,
  active,
  targets,
  onChange,
}: {
  accounts: AccountSnapshot[];
  active: AccountSnapshot;
  targets: string[];
  onChange: (dids: string[]) => void;
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

  if (accounts.length < 2) {
    return <Avatar src={active.avatar} name={active.displayName ?? active.handle} size={38} />;
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

function ImageGrid({
  images,
  onRemove,
  onEditAlt,
}: {
  images: PreparedImage[];
  onRemove: (image: PreparedImage) => void;
  onEditAlt: (image: PreparedImage) => void;
}) {
  const single = images.length === 1;
  return (
    <div className={cx('mb-2 grid gap-1.5', single ? 'grid-cols-1' : 'grid-cols-2')}>
      {images.map((image) => (
        <div
          key={image.id}
          className={cx(
            'group relative overflow-hidden rounded-xl border border-line bg-surface-2',
            // Shrink-wrap a lone image so the ALT/remove buttons sit on its
            // corners instead of floating over letterbox padding.
            single && 'mx-auto w-fit max-w-full',
          )}
        >
          <img
            src={image.previewUrl}
            alt={image.alt || 'Attached image'}
            className={cx(
              single
                ? 'block max-h-44 min-h-[60px] w-auto max-w-full object-contain'
                : 'h-24 w-full object-cover',
            )}
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

/**
 * Link preview styled like the card Bluesky renders on the published post:
 * full-width image on top (when the site provides one), text block below.
 */
function CardPreview({ card, onDismiss }: { card: LinkCardData; onDismiss: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(card.imageUrl) && !imageFailed;
  return (
    <div className="animate-fade-in relative mt-1 mb-2 overflow-hidden rounded-xl border border-line bg-surface">
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
  useEffect(() => {
    if (toast.kind !== 'success') return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

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
          <IconButton
            title="Close"
            onClick={onClose}
            className="size-7 bg-surface-2 hover:bg-surface-3"
          >
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
