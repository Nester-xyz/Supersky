import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import { GifIcon, SearchIcon, XIcon } from './icons';
import { IconButton, Spinner } from './ui';
import { toErrorMessage } from '@/lib/errors';
import {
  fetchGifs,
  proxiedGifUrl,
  toAttachedGif,
  type AttachedGif,
  type GifResult,
} from '@/lib/gifs';

/**
 * GIF search popover, powered by the same Bluesky GIF proxy (Klipy) the
 * official composer uses. Featured GIFs on open, live search while typing,
 * and infinite scroll through the cursor the proxy hands back.
 */
export function GifPicker({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (gif: AttachedGif) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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

  function choose(gif: GifResult) {
    try {
      onSelect(toAttachedGif(gif));
      setOpen(false);
      setQuery('');
    } catch (err) {
      // Malformed result; leave the picker open so another can be chosen.
      console.warn('Unusable GIF result', err);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        title="Add a GIF"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={open ? 'bg-surface-2 text-ink' : undefined}
      >
        <GifIcon />
      </IconButton>

      {open && (
        <div
          role="dialog"
          aria-label="GIF picker"
          className="animate-slide-up absolute -left-10 bottom-full z-40 mb-2 w-[352px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--ss-shadow-pop)]"
        >
          <div className="flex items-center gap-2 border-b border-line p-2.5">
            <div className="relative flex-1">
              <SearchIcon
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search GIFs"
                aria-label="Search GIFs"
                className="input h-9 rounded-lg pr-3 pl-9 text-[13px]"
              />
            </div>
            <IconButton
              title="Close GIF picker"
              onClick={() => setOpen(false)}
              className="bg-surface-2 hover:bg-surface-3"
            >
              <XIcon size={14} />
            </IconButton>
          </div>

          <GifResults query={query} onChoose={choose} />
        </div>
      )}
    </div>
  );
}

function GifResults({
  query,
  onChoose,
}: {
  query: string;
  onChoose: (gif: GifResult) => void;
}) {
  const [results, setResults] = useState<GifResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const loadingMoreRef = useRef(false);
  const requestIdRef = useRef(0);

  const runSearch = useCallback((term: string) => {
    const requestId = ++requestIdRef.current;
    setPhase('loading');
    fetchGifs(term)
      .then((page) => {
        if (requestIdRef.current !== requestId) return;
        setResults(page.results);
        setCursor(page.next);
        setPhase('ready');
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setError(toErrorMessage(err));
        setPhase('error');
      });
  }, []);

  // Featured on open; debounce keystrokes into searches.
  useEffect(() => {
    const timer = setTimeout(() => runSearch(query), query.trim() ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  function loadMore() {
    if (!cursor || loadingMoreRef.current || phase !== 'ready') return;
    loadingMoreRef.current = true;
    const requestId = requestIdRef.current;
    fetchGifs(query, cursor)
      .then((page) => {
        if (requestIdRef.current !== requestId) return;
        setResults((prev) => {
          const seen = new Set(prev.map((gif) => gif.id));
          return [...prev, ...page.results.filter((gif) => !seen.has(gif.id))];
        });
        setCursor(page.next);
      })
      .catch(() => undefined) // scrolling again retries
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) loadMore();
  }

  if (phase === 'error') {
    return (
      <div className="flex h-[264px] flex-col items-center justify-center px-6 text-center">
        <p className="text-[13px] font-medium text-ink">GIF search is unavailable</p>
        <p className="mt-1 text-xs leading-snug text-ink-faint">{error}</p>
        <button
          type="button"
          className="btn btn-outline mt-3 h-8 px-3 text-xs"
          onClick={() => runSearch(query)}
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="grid h-[264px] grid-cols-2 content-start gap-1 overflow-hidden p-1.5">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="shimmer h-[104px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex h-[264px] flex-col items-center justify-center text-center">
        <span className="emoji-glyph text-3xl" aria-hidden="true">
          🔭
        </span>
        <p className="mt-2 text-[13px] font-medium text-ink">No GIFs found</p>
        <p className="mt-0.5 text-xs text-ink-faint">Try another word</p>
      </div>
    );
  }

  return (
    <div
      className="grid h-[264px] grid-cols-2 content-start gap-1 overflow-y-auto overscroll-contain p-1.5"
      onScroll={handleScroll}
    >
      {results.map((gif) => (
        <GifTile key={gif.id} gif={gif} onChoose={onChoose} />
      ))}
      {cursor && (
        <div className="col-span-2 flex justify-center py-2">
          <Spinner size={14} className="text-ink-faint" />
        </div>
      )}
    </div>
  );
}

function GifTile({ gif, onChoose }: { gif: GifResult; onChoose: (gif: GifResult) => void }) {
  const preview = gif.media_formats.tinygif ?? gif.media_formats.preview ?? gif.media_formats.gif;
  if (!preview) return null;
  const label = gif.content_description || gif.title || 'GIF';
  return (
    <button
      type="button"
      title={label}
      aria-label={`Select GIF: ${label}`}
      onClick={() => onChoose(gif)}
      className="group relative h-[104px] cursor-pointer overflow-hidden rounded-lg bg-surface-2 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ss-accent)]"
    >
      <img
        src={proxiedGifUrl(preview.url)}
        alt={label}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.04]"
      />
    </button>
  );
}
