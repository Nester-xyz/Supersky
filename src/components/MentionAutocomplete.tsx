import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { getCaretCoordinates } from '@/lib/caret';
import { findMentionQuery } from '@/lib/mentions';
import { sendMessage } from '@/lib/messaging';
import type { ActorSuggestion } from '@/lib/types';
import { Avatar, Spinner, cx } from './ui';

const MENU_WIDTH = 268;
const SEARCH_DEBOUNCE_MS = 160;

interface MentionState {
  open: boolean;
  items: ActorSuggestion[];
  loading: boolean;
  activeIndex: number;
  anchor: { top: number; left: number } | null;
}

const CLOSED: MentionState = {
  open: false,
  items: [],
  loading: false,
  activeIndex: 0,
  anchor: null,
};

/**
 * Drives the composer's @-mention typeahead: watches the caret for a mention
 * being typed, fetches matching accounts (debounced), and owns keyboard
 * navigation. The caller wires `sync` to text/selection changes, forwards
 * `onKeyDown`, and renders `menu` inside a positioned wrapper around the
 * textarea. Selecting a person calls `onChoose` with the range to replace;
 * facets are still resolved at publish time, so this is purely a UX aid.
 */
export function useMentionAutocomplete({
  textareaRef,
  onChoose,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChoose: (range: { start: number; end: number }, handle: string) => void;
}): {
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  sync: () => void;
  dismiss: () => void;
  menu: ReactNode;
} {
  const [state, setState] = useState<MentionState>(CLOSED);
  const rangeRef = useRef<{ start: number; end: number } | null>(null);
  const queryRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestIdRef.current++; // invalidate any in-flight response
    rangeRef.current = null;
    queryRef.current = null;
    setState((prev) => (prev.open ? CLOSED : prev));
  }, []);

  const sync = useCallback(() => {
    const el = textareaRef.current;
    // Only track a collapsed caret, not a range selection.
    if (!el || el.selectionStart !== el.selectionEnd) {
      dismiss();
      return;
    }
    const found = findMentionQuery(el.value, el.selectionStart);
    if (!found || found.query.length < 1) {
      dismiss();
      return;
    }

    rangeRef.current = { start: found.start, end: found.start + found.query.length + 1 };
    const caret = getCaretCoordinates(el, found.start);
    const maxLeft = Math.max(0, el.clientWidth - MENU_WIDTH);
    const anchor = {
      top: caret.top + caret.height + 4,
      left: Math.min(Math.max(caret.left, 0), maxLeft),
    };

    // Caret moved but the handle text is unchanged: reposition, keep results.
    if (queryRef.current === found.query) {
      setState((prev) => (prev.open ? { ...prev, anchor } : prev));
      return;
    }
    queryRef.current = found.query;
    setState((prev) => ({ ...prev, open: true, loading: true, anchor, activeIndex: 0 }));

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const id = ++requestIdRef.current;
    const term = found.query;
    debounceRef.current = setTimeout(() => {
      sendMessage('actor:search-typeahead', { query: term })
        .then((items) => {
          if (id === requestIdRef.current) {
            setState((prev) => ({ ...prev, items, loading: false, activeIndex: 0 }));
          }
        })
        .catch(() => {
          if (id === requestIdRef.current) {
            setState((prev) => ({ ...prev, items: [], loading: false }));
          }
        });
    }, SEARCH_DEBOUNCE_MS);
  }, [dismiss, textareaRef]);

  const choose = useCallback(
    (item: ActorSuggestion) => {
      const range = rangeRef.current;
      if (range) onChoose(range, item.handle);
      dismiss();
    },
    [dismiss, onChoose],
  );

  const setActiveIndex = useCallback((index: number) => {
    setState((prev) => (prev.activeIndex === index ? prev : { ...prev, activeIndex: index }));
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!state.open) return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return true;
      }
      // Let Ctrl/Cmd+Enter fall through to publishing.
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      const count = state.items.length;
      if (count === 0) return false;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((state.activeIndex + 1) % count);
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((state.activeIndex - 1 + count) % count);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const item = state.items[state.activeIndex] ?? state.items[0];
        if (item) choose(item);
        return true;
      }
      return false;
    },
    [state, dismiss, choose, setActiveIndex],
  );

  const menu = (
    <MentionMenu state={state} onChoose={choose} onHover={setActiveIndex} />
  );

  return { onKeyDown, sync, dismiss, menu };
}

function MentionMenu({
  state,
  onChoose,
  onHover,
}: {
  state: MentionState;
  onChoose: (item: ActorSuggestion) => void;
  onHover: (index: number) => void;
}) {
  if (!state.open || !state.anchor) return null;
  const { items, loading, activeIndex, anchor } = state;

  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      className="animate-fade-in absolute z-40 max-h-[236px] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface shadow-[var(--ss-shadow-pop)]"
      style={{ top: anchor.top, left: anchor.left, width: MENU_WIDTH }}
    >
      {items.map((item, index) => (
        <button
          key={item.did}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          // Keep the textarea focused so the caret and selection survive the click.
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => onHover(index)}
          onClick={() => onChoose(item)}
          className={cx(
            'flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2 text-left transition-colors',
            index === activeIndex ? 'bg-accent-soft' : 'hover:bg-surface-2',
          )}
        >
          <Avatar
            src={item.avatar}
            name={item.displayName ?? item.handle}
            size={30}
            fallback="initial"
          />
          <div className="min-w-0 flex-1">
            {item.displayName && (
              <p className="truncate text-[13px] font-semibold text-ink">{item.displayName}</p>
            )}
            <p className="truncate text-xs text-ink-muted">@{item.handle}</p>
          </div>
        </button>
      ))}

      {loading && items.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-ink-faint">
          <Spinner size={13} />
          Searching people…
        </div>
      )}
      {!loading && items.length === 0 && (
        <div className="px-3 py-2.5 text-[13px] text-ink-faint">No matching accounts</div>
      )}
    </div>
  );
}
