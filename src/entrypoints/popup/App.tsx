import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { ExternalLinkIcon, LogOutIcon, SlidersIcon } from '@/components/icons';
import { LogoMark, Wordmark } from '@/components/Logo';
import { Avatar } from '@/components/ui';
import { writeAuthCache } from '@/lib/auth-cache';
import { onAuthChanged, sendMessage } from '@/lib/messaging';
import type { AccountSnapshot, AuthState } from '@/lib/types';
import { Composer } from './Composer';

type ViewState = 'loading' | AuthState;

export default function App() {
  const [view, setView] = useState<ViewState>('loading');

  useEffect(() => {
    let mounted = true;
    sendMessage('auth:get-state', undefined)
      .then((state) => mounted && setView(state))
      .catch(() => mounted && setView({ status: 'signed-out' }));
    const unsubscribe = onAuthChanged((state) => setView(state));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Mirror auth state to the synchronous cache the popup reads on next open,
  // and — if signed out — hand off to the settings page (which hosts sign-in)
  // and close the popup.
  useEffect(() => {
    if (view === 'loading') return;
    writeAuthCache(view.status === 'signed-in' ? 'in' : 'out');
    if (view.status === 'signed-out') {
      void browser.runtime.openOptionsPage().finally(() => window.close());
    }
  }, [view]);

  const account = view !== 'loading' && view.status === 'signed-in' ? view.account : null;

  // Signed out (only reachable when the cache was stale) — render nothing
  // visible while the effect above opens settings and closes the popup.
  if (view !== 'loading' && view.status === 'signed-out') {
    return <div className="min-h-[100px]" aria-hidden="true" />;
  }

  return (
    <div className="relative flex min-h-[500px] flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <LogoMark size={26} />
          <Wordmark />
        </div>
        {account && <AccountMenu account={account} />}
      </header>

      <main className="flex flex-1 flex-col">
        {view === 'loading' && <BootSkeleton />}
        {account && <Composer account={account} />}
      </main>
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      <div className="flex gap-3">
        <div className="size-9 shrink-0 rounded-full shimmer" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3.5 w-2/3 rounded-md shimmer" />
          <div className="h-3.5 w-1/2 rounded-md shimmer" />
        </div>
      </div>
      <div className="h-24 rounded-2xl shimmer" />
      <div className="ml-auto h-9 w-24 rounded-full shimmer" />
    </div>
  );
}

function AccountMenu({ account }: { account: AccountSnapshot }) {
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
        <div className="menu-pop animate-slide-down absolute top-full right-0 z-50 mt-2 w-60">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Avatar src={account.avatar} name={account.displayName ?? account.handle} size={34} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">
                {account.displayName ?? account.handle}
              </p>
              <p className="truncate text-xs text-ink-muted">@{account.handle}</p>
            </div>
          </div>
          <div className="mx-1.5 my-1 border-t border-line" />
          <a
            className="menu-item"
            href={`https://bsky.app/profile/${account.handle}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            <ExternalLinkIcon size={15} className="text-ink-muted" />
            Open Bluesky profile
          </a>
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              void browser.runtime.openOptionsPage();
            }}
          >
            <SlidersIcon size={15} className="text-ink-muted" />
            Settings
          </button>
          <div className="mx-1.5 my-1 border-t border-line" />
          <button
            className="menu-item text-danger hover:bg-danger-soft"
            onClick={() => {
              setOpen(false);
              void sendMessage('auth:logout', undefined).catch(() => undefined);
            }}
          >
            <LogOutIcon size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
