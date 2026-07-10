import { useEffect, useMemo, useRef, useState } from 'react';
import { SmileIcon, XIcon } from './icons';
import { IconButton, cx } from './ui';
import { EMOJI_BY_VALUE, EMOJI_CATEGORIES, searchEmojis, type EmojiEntry } from '@/lib/emojis';

const RECENTS_KEY = 'supersky:recent-emojis';
const MAX_RECENTS = 24;

function readRecents(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecents(values: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(values));
  } catch {
    // The picker still works when browser storage is unavailable.
  }
}

export function EmojiPicker({
  onOpen,
  onSelect,
}: {
  onOpen: () => void;
  onSelect: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState(EMOJI_CATEGORIES[0]?.id ?? 'smileys');
  const [recents, setRecents] = useState(readRecents);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectedCategory =
    EMOJI_CATEGORIES.find((category) => category.id === categoryId) ?? EMOJI_CATEGORIES[0];
  const visibleEmojis = useMemo(() => {
    if (query.trim()) return searchEmojis(query);
    if (categoryId === 'recent') {
      return recents
        .map((value) => EMOJI_BY_VALUE.get(value) ?? { emoji: value, label: 'Recently used emoji' })
        .filter((entry): entry is EmojiEntry => Boolean(entry));
    }
    return selectedCategory?.emojis ?? [];
  }, [categoryId, query, recents, selectedCategory]);

  function choose(entry: EmojiEntry) {
    const next = [entry.emoji, ...recents.filter((value) => value !== entry.emoji)].slice(
      0,
      MAX_RECENTS,
    );
    setRecents(next);
    writeRecents(next);
    onSelect(entry.emoji);
  }

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        title="Add emoji"
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(event) => {
          event.preventDefault();
          if (!open) onOpen();
        }}
        onClick={() => setOpen((value) => !value)}
        className={open ? 'bg-surface-2 text-ink' : undefined}
      >
        <SmileIcon />
      </IconButton>

      {open && (
        <div
          role="dialog"
          aria-label="Emoji picker"
          className="animate-slide-up absolute -left-9 bottom-full z-40 mb-2 w-[352px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--ss-shadow-pop)]"
        >
          <div className="flex items-center gap-2 border-b border-line p-2.5">
            <div className="relative flex-1">
              <SmileIcon
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search emoji"
                aria-label="Search emoji"
                className="input h-9 rounded-lg pr-3 pl-9 text-[13px]"
              />
            </div>
            <IconButton title="Close emoji picker" onClick={() => setOpen(false)}>
              <XIcon size={14} />
            </IconButton>
          </div>

          <div
            className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-2 py-1.5"
            aria-label="Emoji categories"
          >
            {recents.length > 0 && (
              <CategoryButton
                icon="🕘"
                label="Recently used"
                active={!query && categoryId === 'recent'}
                onClick={() => {
                  setQuery('');
                  setCategoryId('recent');
                }}
              />
            )}
            {EMOJI_CATEGORIES.map((category) => (
              <CategoryButton
                key={category.id}
                icon={category.icon}
                label={category.label}
                active={!query && categoryId === category.id}
                onClick={() => {
                  setQuery('');
                  setCategoryId(category.id);
                }}
              />
            ))}
          </div>

          <div className="px-2.5 pt-2 pb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
            {query.trim()
              ? `${visibleEmojis.length} result${visibleEmojis.length === 1 ? '' : 's'}`
              : categoryId === 'recent'
                ? 'Recently used'
                : selectedCategory?.label}
          </div>

          <div className="emoji-grid grid h-[214px] grid-cols-8 content-start gap-0.5 overflow-y-auto overscroll-contain px-2 pb-2">
            {visibleEmojis.map((entry) => (
              <button
                key={entry.emoji}
                type="button"
                title={entry.label}
                aria-label={entry.label}
                onClick={() => choose(entry)}
                className="emoji-glyph grid size-10 cursor-pointer place-items-center rounded-lg text-[23px] transition-colors outline-none hover:bg-surface-2 focus-visible:bg-accent-soft focus-visible:shadow-[inset_0_0_0_2px_var(--ss-accent)] active:scale-90"
              >
                {entry.emoji}
              </button>
            ))}
            {visibleEmojis.length === 0 && (
              <div className="col-span-8 flex h-36 flex-col items-center justify-center text-center">
                <span className="emoji-glyph text-3xl" aria-hidden="true">
                  🔭
                </span>
                <p className="mt-2 text-[13px] font-medium text-ink">No emoji found</p>
                <p className="mt-0.5 text-xs text-ink-faint">Try another word</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'emoji-glyph grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-[17px] transition-colors outline-none hover:bg-surface-2 focus-visible:shadow-[inset_0_0_0_2px_var(--ss-accent)]',
        active && 'bg-accent-soft',
      )}
    >
      {icon}
    </button>
  );
}
