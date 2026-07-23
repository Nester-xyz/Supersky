import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { browser } from 'wxt/browser';
import {
  AtSignIcon,
  BellIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HeartIcon,
  QuoteIcon,
  RepeatIcon,
  ReplyFillIcon,
  UserRoundPlusIcon,
} from '@/components/icons';
import { Avatar, Button, Spinner, cx } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { sendMessage } from '@/lib/messaging';
import type { NotificationItem } from '@/lib/types';

/** The same top-level split the official app uses: All | Mentions. */
type FilterId = 'all' | 'mentions';

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'mentions', label: 'Mentions' },
];

const REASON_PHRASES: Record<string, string> = {
  like: 'liked your post',
  repost: 'reposted your post',
  follow: 'followed you',
  mention: 'mentioned you',
  reply: 'replied to your post',
  quote: 'quoted your post',
  'starterpack-joined': 'joined your starter pack',
  'like-via-repost': 'liked your repost',
  'repost-via-repost': 'reposted your repost',
};

interface ReasonChip {
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  bg: string;
}

/** Corner badge per reason; colors are tuned to read on both themes. */
const REASON_CHIPS: Record<string, ReasonChip> = {
  like: { Icon: HeartIcon, bg: 'bg-[#ef3e5f]' },
  'like-via-repost': { Icon: HeartIcon, bg: 'bg-[#ef3e5f]' },
  repost: { Icon: RepeatIcon, bg: 'bg-[#10b981]' },
  'repost-via-repost': { Icon: RepeatIcon, bg: 'bg-[#10b981]' },
  reply: { Icon: ReplyFillIcon, bg: 'bg-[var(--ss-primary)]' },
  quote: { Icon: QuoteIcon, bg: 'bg-[var(--ss-primary)]' },
  mention: { Icon: AtSignIcon, bg: 'bg-[var(--ss-spark)]' },
  follow: { Icon: UserRoundPlusIcon, bg: 'bg-[#8b5cf6]' },
};
const DEFAULT_CHIP: ReasonChip = { Icon: BellIcon, bg: 'bg-[var(--ss-accent)]' };

function timeAgo(iso: string): string {
  const seconds = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The bell's flip side: a grouped, filterable inbox of the active account's
 * notifications. Opening it marks everything seen (badge clears); rows keep
 * their unread tint for the visit so what's new stays visible.
 */
export function NotificationsPanel({
  onLoaded,
}: {
  /** First page arrived: the unread count it walked in on, and emptiness. */
  onLoaded: (info: { unread: number; empty: boolean }) => void;
}) {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<FilterId>('all');
  /** DIDs followed back during this visit (chip flips to "Following"). */
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    setCursor(undefined);
    try {
      const page = await sendMessage('notif:list', { filter });
      setItems(page.items);
      setCursor(page.cursor);
      onLoaded({ unread: page.unread, empty: page.items.length === 0 });
      // Entering the inbox counts as reading it, so the toolbar badge clears
      // now; the fetched rows keep their unread flags for this visit.
      if (page.unread > 0) void sendMessage('notif:seen', undefined).catch(() => undefined);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [filter, onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  // The header's mark-all-read button knocks from outside the panel.
  useEffect(() => {
    const markAll = () => {
      setItems((prev) => prev?.map((item) => ({ ...item, isRead: true })) ?? prev);
      void sendMessage('notif:seen', undefined).catch(() => undefined);
    };
    window.addEventListener('supersky:mark-all-read', markAll);
    return () => window.removeEventListener('supersky:mark-all-read', markAll);
  }, []);

  // Filter pills scroll with side arrows instead of a scrollbar; the arrows
  // only materialize when the row actually overflows.
  const pillsRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState({ left: false, right: false });
  const updateArrows = useCallback(() => {
    const el = pillsRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setArrows({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  }, []);
  useEffect(() => {
    updateArrows();
    const el = pillsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateArrows);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateArrows]);

  function scrollPills(direction: -1 | 1) {
    pillsRef.current?.scrollBy({ left: direction * 140, behavior: 'smooth' });
  }

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await sendMessage('notif:list', { cursor, filter });
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.cursor);
    } catch {
      // The sentinel stays; scrolling it back into view retries this cursor.
    }
    setLoadingMore(false);
  }, [cursor, loadingMore, filter]);

  // Infinite scroll: a sentinel under the last row asks for the next page as
  // it nears the viewport. The observer is rebuilt whenever loadMore's inputs
  // change, and observe() re-fires on attach, so short pages chain until the
  // sentinel finally scrolls out of reach.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { root: scrollRef.current, rootMargin: '260px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, loadMore]);

  function openUrl(url: string) {
    void browser.tabs.create({ url });
    window.close();
  }

  function followBack(item: NotificationItem) {
    const target = item.authors[0];
    if (!target || followed.has(target.did)) return;
    setFollowed((prev) => new Set(prev).add(target.did));
    void sendMessage('graph:follow', { did: target.did }).catch(() => {
      // Roll the chip back so the failure is visible and retryable.
      setFollowed((prev) => {
        const next = new Set(prev);
        next.delete(target.did);
        return next;
      });
    });
  }

  return (
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0">
        <div
          ref={pillsRef}
          onScroll={updateArrows}
          role="tablist"
          aria-label="Filter notifications"
          className="flex gap-1.5 overflow-x-auto px-3.5 pt-2.5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={cx(
                'h-[26px] shrink-0 cursor-pointer rounded-full px-3 text-xs font-bold transition-colors',
                filter === id
                  ? 'bg-accent-soft text-accent'
                  : 'border border-line text-ink-muted hover:bg-surface-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {arrows.left && (
          <button
            type="button"
            aria-label="Scroll filters left"
            onClick={() => scrollPills(-1)}
            className="absolute top-1/2 left-1.5 z-10 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-line bg-surface text-ink-muted shadow-sm transition-colors hover:text-ink"
          >
            <ChevronLeftIcon size={13} />
          </button>
        )}
        {arrows.right && (
          <button
            type="button"
            aria-label="Scroll filters right"
            onClick={() => scrollPills(1)}
            className="absolute top-1/2 right-1.5 z-10 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-line bg-surface text-ink-muted shadow-sm transition-colors hover:text-ink"
          >
            <ChevronRightIcon size={13} />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {items === null && !error && <SkeletonRows />}

        {error && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-[13px] text-ink-muted">{error}</p>
            <Button variant="outline" className="h-8 px-4 text-xs" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}

        {items && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-ink-faint">
            <BellIcon size={26} />
            <p className="text-[13px] font-semibold">
              {filter === 'all' ? 'No notifications yet' : 'No mentions yet'}
            </p>
          </div>
        )}

        {items?.map((item) => (
          <NotificationRow
            key={item.id}
            item={item}
            onOpen={() => openUrl(item.url)}
            followedNow={Boolean(item.authors[0] && followed.has(item.authors[0].did))}
            onFollow={() => followBack(item)}
          />
        ))}

        {items && items.length > 0 && cursor && (
          <div ref={setSentinel} className="grid place-items-center py-3 text-ink-faint">
            <Spinner size={14} />
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationRow({
  item,
  onOpen,
  followedNow,
  onFollow,
}: {
  item: NotificationItem;
  onOpen: () => void;
  followedNow: boolean;
  onFollow: () => void;
}) {
  const chip = REASON_CHIPS[item.reason] ?? DEFAULT_CHIP;
  const first = item.authors[0];
  const second = item.authors[1];
  const name = first?.displayName ?? (first ? `@${first.handle}` : 'Someone');
  const extra = Math.max(0, item.authors.length - 1) + item.othersCount;
  const phrase = REASON_PHRASES[item.reason] ?? 'sent you a notification';
  const showFollow = item.reason === 'follow' && item.authors.length === 1;
  const alreadyFollowing = Boolean(item.followedByViewer) || followedNow;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      className={cx(
        'relative flex w-full cursor-pointer gap-3 border-b border-line px-4 py-3 text-left transition-colors',
        item.isRead ? 'hover:bg-surface-2' : 'bg-accent-soft/60 hover:bg-accent-soft',
      )}
    >
      <div className="relative h-10 w-11 shrink-0">
        <span className="absolute top-0 left-0">
          <Avatar src={first?.avatar} name={name} size={36} fallback="initial" />
        </span>
        {second && (
          <span className="ring-canvas absolute top-[8px] left-[14px] rounded-full ring-2">
            <Avatar
              src={second.avatar}
              name={second.displayName ?? second.handle}
              size={28}
              fallback="initial"
            />
          </span>
        )}
        <span
          className={cx(
            'ring-canvas absolute right-0 -bottom-0.5 z-10 grid size-[17px] place-items-center rounded-full text-white ring-2',
            chip.bg,
          )}
        >
          <chip.Icon size={9.5} strokeWidth={2.8} />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-snug text-ink-muted">
          <span className="font-bold text-ink">{name}</span>
          {extra > 0 && ` and ${extra} other${extra > 1 ? 's' : ''}`} {phrase}
        </p>
        {item.text && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug break-words text-ink">
            {item.text}
          </p>
        )}
        {item.subjectText && (
          <p className="mt-1 line-clamp-1 text-xs break-words text-ink-faint">{item.subjectText}</p>
        )}
        {showFollow && (
          <div className="mt-1.5 flex gap-1.5">
            {alreadyFollowing ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-full border border-line-strong px-2.5 text-[11.5px] font-bold text-ink-muted">
                <CheckIcon size={11} />
                Following
              </span>
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onFollow();
                }}
                className="inline-flex h-6 cursor-pointer items-center rounded-full bg-accent-soft px-2.5 text-[11.5px] font-bold text-accent transition-[filter] hover:brightness-105"
              >
                Follow back
              </button>
            )}
          </div>
        )}
      </div>

      <span className="flex shrink-0 items-center gap-1.5 self-start pt-0.5 text-[11px] font-semibold text-ink-faint tabular-nums">
        {!item.isRead && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />}
        {timeAgo(item.indexedAt)}
      </span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex gap-3 border-b border-line px-4 py-3.5">
          <span className="shimmer size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 py-1">
            <span className="shimmer block h-3 w-3/4 rounded-full" />
            <span className="shimmer block h-3 w-1/2 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
