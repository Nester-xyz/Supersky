import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  ArrowLeftIcon,
  BellIcon,
  CheckCheckIcon,
  CheckIcon,
  LogOutIcon,
  SlidersIcon,
  UserRoundPlusIcon,
} from '@/components/icons';
import { LogoMark, Wordmark } from '@/components/Logo';
import { NotificationsPanel } from '@/components/NotificationsPanel';
import { Avatar, IconButton, cx } from '@/components/ui';
import { readAuthSnapshot, writeAuthCache } from '@/lib/auth-cache';
import { onAuthChanged, sendMessage } from '@/lib/messaging';
import {
  onPolledUnreadChanged,
  readPolledUnread,
  readUnreadSnapshot,
  writeUnreadCache,
} from '@/lib/unread-cache';
import { MAX_ACCOUNTS, type AccountSnapshot, type AuthState } from '@/lib/types';
import { Composer } from './Composer';

type ViewState = 'loading' | AuthState;
type Panel = 'compose' | 'notifications';

export default function App() {
  // Seed from the last-known account so the composer paints on the first frame
  // instead of flashing blank while the background session is queried.
  const [view, setView] = useState<ViewState>(() => readAuthSnapshot() ?? 'loading');
  const [panel, setPanel] = useState<Panel>('compose');
  /** Live unread count worn by the header bell. Seeded synchronously from the
   * last-known value so the dot paints on the first frame; the background's
   * polled count and then a fresh fetch reconcile it moments later. */
  const [unread, setUnreadState] = useState(() => readUnreadSnapshot());
  const setUnread = useCallback((count: number) => {
    setUnreadState(count);
    writeUnreadCache(count);
  }, []);
  /** What the panel walked in on; shown beside its title for the visit. */
  const [panelUnread, setPanelUnread] = useState(0);
  /** Whether the panel's current list is empty (tick then just goes home). */
  const [panelEmpty, setPanelEmpty] = useState(false);

  useEffect(() => {
    let mounted = true;
    sendMessage('auth:get-state', undefined)
      .then((state) => mounted && setView(state))
      .catch(() => mounted && setView({ status: 'signed-out' }));
    // The background poller's stored count is milliseconds away; adopt it
    // before the network answers so the dot never waits on a fetch.
    void readPolledUnread().then((count) => {
      if (mounted && typeof count === 'number') setUnread(count);
    });
    // Opening the popup is a natural moment to reconcile the toolbar badge.
    // Fire-and-forget so a slow network never delays the composer.
    sendMessage('notif:refresh', undefined)
      .then(({ count }) => {
        if (mounted && typeof count === 'number') setUnread(count);
      })
      .catch(() => undefined);
    // And while the popup sits open, ride along with the poller's updates.
    const unsubscribeUnread = onPolledUnreadChanged(setUnread);
    const unsubscribe = onAuthChanged((state) => setView(state));
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeUnread();
    };
  }, [setUnread]);

  // The panel needs a fixed stage so its list scrolls; popup.css keys off this.
  useEffect(() => {
    document.documentElement.classList.toggle('panel-notifs', panel === 'notifications');
  }, [panel]);

  // The panel reports the unread count it fetched, then marks it seen, so the
  // bell goes quiet while the panel chip keeps the number for this visit.
  const handleLoaded = useCallback(
    (info: { unread: number; empty: boolean }) => {
      setPanelUnread(info.unread);
      setPanelEmpty(info.empty);
      setUnread(0);
    },
    [setUnread],
  );

  function openPanel() {
    setPanelUnread(0);
    setPanelEmpty(false);
    setPanel('notifications');
  }

  function markAllRead() {
    setUnread(0);
    // Nothing left to acknowledge (empty inbox or all rows already read):
    // the tick doubles as "done here, back to writing".
    if (panelEmpty || panelUnread === 0) {
      setPanel('compose');
      return;
    }
    setPanelUnread(0);
    window.dispatchEvent(new Event('supersky:mark-all-read'));
  }

  // Mirror auth state to the synchronous cache the popup reads on next open,
  // and, if signed out, hand off to the settings page (which hosts sign-in)
  // and close the popup.
  useEffect(() => {
    if (view === 'loading') return;
    writeAuthCache(view);
    if (view.status === 'signed-out') {
      void browser.runtime.openOptionsPage().finally(() => window.close());
    }
  }, [view]);

  const signedIn = view !== 'loading' && view.status === 'signed-in' ? view : null;
  const account = signedIn?.account ?? null;
  const accounts = signedIn?.accounts ?? [];

  // Signed out (only reachable when the cache was stale), so render nothing
  // visible while the effect above opens settings and closes the popup.
  if (view !== 'loading' && view.status === 'signed-out') {
    return <div className="min-h-[100px]" aria-hidden="true" />;
  }

  const inNotifications = panel === 'notifications';

  return (
    <div className="app-shell relative flex min-h-[500px] flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        {inNotifications ? (
          <div className="flex min-w-0 items-center gap-1">
            <IconButton
              title="Back to composer"
              className="-ml-1.5"
              onClick={() => setPanel('compose')}
            >
              <ArrowLeftIcon size={17} />
            </IconButton>
            <span className="text-[15px] font-extrabold text-ink">Notifications</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <LogoMark size={26} />
            <Wordmark />
          </div>
        )}
        {account && (
          <div className="flex items-center gap-1.5">
            {inNotifications ? (
              <IconButton
                title={panelUnread > 0 ? 'Mark all as read' : 'Back to composer'}
                onClick={markAllRead}
              >
                <CheckCheckIcon size={17} />
              </IconButton>
            ) : (
              <>
                <button
                  type="button"
                  title="Open drafts"
                  // The composer owns the drafts sheet; the header just knocks.
                  onClick={() => window.dispatchEvent(new Event('supersky:open-drafts'))}
                  className="flex h-7 cursor-pointer items-center rounded-full px-2.5 text-[13px] font-semibold text-accent transition-colors hover:bg-accent-soft"
                >
                  Drafts
                </button>
                <IconButton
                  title={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
                  className="relative"
                  onClick={openPanel}
                >
                  <BellIcon size={18} strokeWidth={1.5} />
                  {unread > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-[5px] right-[6px] size-[7px] rounded-full bg-[var(--ss-primary)]"
                    />
                  )}
                </IconButton>
              </>
            )}
            <AccountSwitcher account={account} accounts={accounts} />
          </div>
        )}
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {account && (
          // The composer never unmounts: drafts, attachments, and the reply
          // listener survive trips into the notifications panel.
          <div className={cx('flex min-h-0 flex-1 flex-col', inNotifications && 'hidden')}>
            <Composer account={account} accounts={accounts} />
          </div>
        )}
        {account && inNotifications && (
          <NotificationsPanel key={account.did} onLoaded={handleLoaded} />
        )}
      </main>
    </div>
  );
}

function AccountSwitcher({
  account,
  accounts,
}: {
  account: AccountSnapshot;
  accounts: AccountSnapshot[];
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  function switchTo(did: string) {
    setOpen(false);
    if (did === account.did) return;
    // Storage-only swap; the auth broadcast repaints the whole popup.
    void sendMessage('auth:switch', { did }).catch(() => undefined);
  }

  function openOptions() {
    setOpen(false);
    void browser.runtime.openOptionsPage();
  }

  const canAdd = accounts.length < MAX_ACCOUNTS;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`@${account.handle}`}
        aria-label="Account menu"
        aria-expanded={open}
        className="block cursor-pointer rounded-full outline-none transition-transform focus-visible:shadow-[0_0_0_2px_var(--ss-accent)] active:scale-95"
      >
        <Avatar src={account.avatar} name={account.displayName ?? account.handle} size={28} />
      </button>

      {open && (
        <div className="menu-pop animate-slide-down absolute top-full right-0 z-50 mt-2 w-56">
          {accounts.map((item) => {
            const active = item.did === account.did;
            return (
              <button
                key={item.did}
                className="menu-item"
                aria-current={active}
                onClick={() => switchTo(item.did)}
              >
                <Avatar src={item.avatar} name={item.displayName ?? item.handle} size={26} />
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {item.displayName && (
                    <span className="font-medium text-ink">{item.displayName} </span>
                  )}
                  <span className="text-ink-muted">@{item.handle}</span>
                </span>
                {active && <CheckIcon size={15} className="shrink-0 text-accent" />}
              </button>
            );
          })}

          {canAdd && (
            <button className="menu-item" onClick={openOptions}>
              <span className="grid size-[26px] shrink-0 place-items-center text-ink-muted">
                <UserRoundPlusIcon size={16} />
              </span>
              <span className="flex-1 text-left text-[13px] text-ink-muted">Add account</span>
            </button>
          )}

          <div className="mx-1.5 my-1 border-t border-line" />

          <button className="menu-item" onClick={openOptions}>
            <span className="grid size-[26px] shrink-0 place-items-center text-ink-muted">
              <SlidersIcon size={16} />
            </span>
            <span className="flex-1 text-left text-[13px]">Settings</span>
          </button>
          <button
            className="menu-item text-danger hover:bg-danger-soft"
            onClick={() => {
              setOpen(false);
              void sendMessage('auth:logout', { did: account.did }).catch(() => undefined);
            }}
          >
            <span className="grid size-[26px] shrink-0 place-items-center">
              <LogOutIcon size={16} />
            </span>
            <span className="flex-1 text-left text-[13px]">Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
